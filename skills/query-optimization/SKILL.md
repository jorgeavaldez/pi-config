---
name: query-optimization
description: Repeatable workflow for "is this query or aggregate efficient, and can we prove an optimization helps?" in any codebase. Captures the exact SQL and params an ORM emits, then compares old vs new with read-only EXPLAIN (ANALYZE, BUFFERS) and behavior tests. jj-first, ORM-agnostic (Drizzle, Prisma, Kysely, Knex, TypeORM, SQLAlchemy, Django, Rails, raw SQL). Use for "is this query efficient", "optimize this aggregate/dashboard query", "reduce round trips", "prove this is faster", or "EXPLAIN this".
---

# Query Optimization Skill

Analyze first, change second, prove with measurements. Treat every performance claim as **source-derived** until EXPLAIN or a measurement backs it up.

Scripts are in `scripts/` next to this file:
- `capture_postgresjs.ts`: an example capture for Drizzle + postgres.js.
- `build_explain.py`: turns captured JSON into a read-only psql EXPLAIN script.
- `summarize_explain.py`: turns the psql output into Markdown tables.

## Fill these in per org

| Placeholder | Meaning |
|---|---|
| `<DB_CONNECT_CMD env=<ENV>>` | Command that opens `psql` (or prints a URL) for an environment |
| `<LOCAL_TEST_DB_URL>` | Disposable local test DB, migrated to head |
| `<READ_ONLY_REPLICA_OR_ENV>` | Large, prod-like target that is safe for read-only EXPLAIN |
| `<ENV_WRAPPER>` | Secret/env-injecting wrapper, if any (e.g. `<tool> run --`) |
| `<TEST_CMD>` / `<MIGRATE_CMD>` / `<MIGRATION_STATUS_CMD>` | Repo commands for DB-backed tests and migrations |
| `<SCRATCH_DIR>` | Per-task scratch dir for logs, captures, and EXPLAIN output |

Never hard-code real hostnames, env names, or credentials into this skill or into a PR.

## 1. Read-only analysis

For each request path, write down:
- **Statement count** per request, and whether calls are serial `await`s or concurrent.
- **Driver and pool**: driver (postgres.js, pg, psycopg, ...), pool `max`, and the prepared-statement setting. After 5 executions, a reused prepared statement can switch to a generic plan.
- **Indexes** on each table it touches:
  `SELECT indexrelid::regclass, pg_get_indexdef(indexrelid) FROM pg_index WHERE indrelid = '<table>'::regclass;`
- **Savings type**: round-trip savings (fewer statements) versus scan or work savings (fewer rows or buffers touched). They are different claims.
- **Correlated subqueries and per-row lookups**: name them explicitly. Examples are `(select ... where c.x = t.id)` in a select list, an N+1 loop, or a SubPlan with `loops = N`. They often dominate, and consolidating statements does **not** reduce them. Fix those with a pre-aggregated join or `LATERAL`.

## 2. Consolidation patterns

- **Filtered aggregates**: one scan per table, with each window as a `FILTER`. Keep an outer `WHERE` that covers the union of the windows, so the index range still applies:
  ```sql
  SELECT count(*) FILTER (WHERE created_at >= $2 AND created_at < $3) AS d7,
         count(*) FILTER (WHERE created_at >= $1 AND created_at < $3) AS d30
  FROM events WHERE org_id = $4 AND created_at >= $1 AND created_at < $3;
  ```
  Drizzle: ``sql<number>`count(*) filter (where ${t.createdAt} >= ${d7})`.mapWith(Number)``. `count` returns a bigint, which arrives as a string.
- **Source-dependent clocks**: `FILTER (WHERE CASE WHEN source = 'x' THEN resolved_at ELSE created_at END >= $1)`. Postgres does **not** guarantee `AND` evaluation order. `CASE` evaluates only the branch it takes, so use it when one branch would error or would be wrong for some rows.
- **`unionAll` vs single scan**: `UNION ALL` of N aggregates cuts round trips but still does N scans. Filtered aggregates do one scan.
- **CTEs don't guarantee materialization**: Postgres 12+ inlines a non-recursive, side-effect-free CTE that is referenced once. Use `AS MATERIALIZED` / `NOT MATERIALIZED` only deliberately.
- **Preserve semantics exactly**:
  - Keep half-open windows (`>= start AND < end`).
  - Without `GROUP BY` you get a zero row; with `GROUP BY`, empty groups vanish, so zero-fill in the app or via `generate_series`.
  - `sum()` over no rows is `NULL`, so use `coalesce`.
  - `count(col)` skips NULLs, while `count(*)` does not.
  - Make sure access/tenant predicates survive the rewrite.
- **Keep independent endpoints independent**. Don't merge queries that are cached, paginated, or rendered separately.
- **No `Promise.all` fan-out against a tiny pool without thought**: N concurrent queries on a `max: 1-3` pool just queue up, and they can starve other requests.

## 3. Tests

- Assert **behavior** with DB-backed result tests:
  - window boundaries (exactly at start and end)
  - NULLs
  - excluded rows
  - access/tenant predicates
  - zero-filling and empty tenants
- Do **not** assert internal builder or mock call counts. For example, `vi.spyOn(db, 'select')` call-count tests get flagged in review as implementation tests.
- Prove a statement-count reduction with a **one-off measurement** reported in the PR (the capture script prints counts per label). Don't commit a spy test for it.
- Run the new tests against the **old code** in a throwaway jj change:
  - For a pure refactor they should pass (proves equivalence).
  - Where you intentionally changed behavior they should fail.
  - Also flip one boundary (`<` to `<=`) in the throwaway change to confirm the tests catch it.

## 4. jj commands (Git may be unavailable)

```bash
jj diff --name-only --from 'heads(::main@origin & ::@)'   # files changed vs trunk
jj diff -r <rev> --git                                    # diff one revision
jj log -r 'heads(::main@origin & ::@)::@'                 # this stack

# Run new tests / capture SQL against OLD code, then come back
NEW=$(jj log -r @ --no-graph -T change_id)                # remember the current change
jj new                                                    # throwaway child of @
jj restore --from 'heads(::main@origin & ::@)' <src paths> # old prod code, keep the new tests
#   ... run tests, capture old SQL to <SCRATCH_DIR>/old.json ...
jj abandon @                                              # drop the throwaway
jj edit "$NEW"                                            # back to the real change
```

For parallel code work, use `jj workspace add <SCRATCH_DIR>/ws-old`. Never run parallel writes in one working copy.

## 5. Capture the exact SQL at the driver boundary

Explain the SQL the app **actually emits**, with its real params. Never explain hand-rewritten SQL. Capture locally against an empty `<LOCAL_TEST_DB_URL>`, then save `[{label, sql, params}]` JSON for old and new.

All of these are established APIs. **Verify each against the installed version's docs before relying on it.** Signatures drift.

| Stack | Capture hook |
|---|---|
| postgres.js | `postgres(url, { debug: (conn, query, params, types) => ... })` (see `scripts/capture_postgresjs.ts`) |
| node-postgres | Wrap `client.query` / `pool.query`. Args can be `(text, values)` or `{ text, values }`. Use `pool.on('connect', c => ...)` to wrap pooled clients |
| Drizzle | `drizzle(client, { logger: { logQuery(query, params) {} } })`, or `.toSQL()` on a builder, which returns `{ sql, params }` |
| Prisma | `new PrismaClient({ log: [{ emit: 'event', level: 'query' }] })` + `$on('query', e => e.query, e.params)`. `e.params` is a JSON string. One call may emit several statements |
| Kysely | `new Kysely({ dialect, log(e) { if (e.level === 'query') e.query.sql, e.query.parameters } })`, or `.compile()` |
| Knex | `knex.on('query', q => q.sql, q.bindings)`, or `.toSQL().toNative()` |
| TypeORM | Custom `logger.logQuery(query, parameters)` with `logging: ['query']`, or `qb.getQueryAndParameters()` |
| SQLAlchemy | `event.listens_for(engine, 'before_cursor_execute')` gives `(conn, cursor, statement, parameters, context, executemany)`; `create_engine(..., echo=True)` |
| Django | `connection.execute_wrapper(fn)` gives the raw sql + params; `CaptureQueriesContext(connection)` / `connection.queries` (DEBUG) give interpolated SQL |
| Rails | `ActiveSupport::Notifications.subscribe('sql.active_record') { \|*, p\| p[:sql], p[:type_casted_binds] }`; `relation.to_sql` |
| Raw SQL | You already have the text. Record the params the code passes |
| DB-side fallback | `pg_stat_statements` (normalized `$n` text, counts, mean time, no params). On a local DB, `log_min_duration_statement = 0` logs each statement with `DETAIL: parameters: ...`. Also `auto_explain` |

`build_explain.py` needs `$1..$n` placeholders. Convert DBAPI `%s` / `%(name)s` or `?` first, or inline the params (e.g. psycopg `mogrify`) and pass `params: []`. If PREPARE can't infer a type (e.g. `$1 IS NULL`), add `"types": ["uuid", ...]` to that entry.

Drizzle + postgres.js example (run from the app dir; it is an example to adapt):
```bash
cd <APP_DIR> && DATABASE_URL=<LOCAL_TEST_DB_URL> npx tsx ~/.pi/agent/skills/query-optimization/scripts/capture_postgresjs.ts \
  --app ./package.json --module ./src/<path>/stats.ts --out <SCRATCH_DIR>/new.json \
  --args '{"getStats": ["<tenant_id>", {"$date": "2026-09-01T00:00:00Z"}]}' getStats getTrend
```

## 6. Prove it with EXPLAIN

1. **Pick a target with real data.** Tiny datasets can't show scan savings. Check sizes cheaply first:
   `SELECT relname, n_live_tup FROM pg_stat_user_tables WHERE relname IN (...);`
   For per-tenant counts, choose a large tenant and keep a `statement_timeout`.
2. **Get explicit user approval for each production or prod-like environment** before connecting. Prefer `<READ_ONLY_REPLICA_OR_ENV>`.
3. Build the script. It wraps everything in `BEGIN READ ONLY; SET LOCAL statement_timeout ...; ROLLBACK;` with `ON_ERROR_STOP`. It aborts unless `current_setting('transaction_read_only')` is `on`. It runs `PREPARE qN AS <sql>; EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) EXECUTE qN(<literals>); DEALLOCATE qN;` and alternates old/new order across passes:
   ```bash
   python3 ~/.pi/agent/skills/query-optimization/scripts/build_explain.py \
     --old <SCRATCH_DIR>/old.json --new <SCRATCH_DIR>/new.json --passes 3 \
     [--plan-cache-mode force_generic_plan] -o <SCRATCH_DIR>/explain.sql
   ```
   Pass `--plan-cache-mode force_generic_plan` when the driver reuses prepared statements.
4. Run it (`-X` skips psqlrc):
   ```bash
   <DB_CONNECT_CMD env=<ENV>> -X -v ON_ERROR_STOP=1 -f <SCRATCH_DIR>/explain.sql > <SCRATCH_DIR>/explain.<ENV>.out 2>&1
   ```
5. Summarize. The first pass is discarded as cold by default:
   ```bash
   python3 ~/.pi/agent/skills/query-optimization/scripts/summarize_explain.py <SCRATCH_DIR>/explain.<ENV>.out --by-label [--detail new:getStats:0]
   ```
   The output covers planning ms, execution ms, shared hit/read buffers, seq and index scans, and the hottest exclusive-time nodes. A high `loops` count means a per-row lookup.
6. **Show how cost grows with synthetic data** when one real environment is too small, or it is the only one you have approval for. Seed `<LOCAL_TEST_DB_URL>` inside the same transaction as the EXPLAINs, `ANALYZE` the seeded tables, run the passes, then `ROLLBACK`. Run 3–4 scales (e.g. 10k → 500k rows) serially, never in parallel, so they do not distort each other's timings.
   - Copy the real shape from a cheap read-only profile: row width (`pg_column_size`, `pg_relation_size`), child-to-parent ratios, time spread and config coverage.
   - Use `SELECT setseed(0.42)` so each scale seeds the same data.
   - **`VACUUM (ANALYZE)` the seeded tables after every scale.** A rolled-back insert leaves dead tuples in the heap. They bloat later runs and change plans. Check that the tables are back to 0 pages.
   - Make the synthetic history longer than the widest window you test. If a window covers the whole history, the result shows the worst case and not steady state. Say so if you cannot avoid it.

**State these caveats in the write-up:**
- EXPLAIN excludes network round-trip time. Statement-count savings show up as round trips, not in EXPLAIN.
- Differences under about 1 ms are noise.
- An empty local DB proves the SQL is valid, not that it is faster.
- `ANALYZE` really executes the query. The read-only transaction is what keeps writes out.
- A rewrite can win at one scale and lose at another. The planner can switch plans on its own as tables grow, so report every scale, not only the best one.
- Postgres folds constant expressions at plan time, even inside `CASE`. So `CASE WHEN ... ELSE 1/0 END` fails every time and does not work as a guard. Use psql `\if`.

## 7. Parallelism

- Run independent read-only steps concurrently:
  - schema and index inspection
  - capture of old and of new (in separate jj workspaces, or one after the other in a single workspace)
  - migration-status checks on the test DB
  - row counts across environments
- Run EXPLAIN against several environments as parallel processes. Each one opens its own read-only transaction:
  ```bash
  for env in <ENV_A> <ENV_B>; do
    (<DB_CONNECT_CMD env=$env> -X -f <SCRATCH_DIR>/explain.sql > <SCRATCH_DIR>/explain.$env.out 2>&1) &
  done; wait
  ```
- Delegate skill/docs work and review-comment fixes to subagents. Copy the explicit environment constraints into each prompt: allowed DBs, read-only, scratch dir, jj-only, no Git hooks.
- Parallel code changes need separate jj workspaces. Never run parallel writes in one working copy.

## 8. Hygiene

- All logs, captures, and temp files go in `<SCRATCH_DIR>`. Set `TMPDIR` **inside** any env-injecting wrapper, because the wrapper may reset the environment.
- Guard the DB target inside the wrapper, before running tests:
  ```bash
  <ENV_WRAPPER> sh -c 'case "$DATABASE_URL" in
    *@localhost[:/]*|*@127.0.0.1[:/]*|*://localhost[:/]*|*://127.0.0.1[:/]*) ;;
    *) echo "refusing: non-local DATABASE_URL" >&2; exit 1 ;;
  esac; export TMPDIR=<SCRATCH_DIR>/tmp; <MIGRATION_STATUS_CMD> && <TEST_CMD>'
  ```
- Make sure the test DB is migrated to head (`<MIGRATE_CMD>`) before you trust any failure.
- Don't run Git-dependent hooks or linters in jj-only workspaces. CI owns repo gates.
- Label every performance claim **source-derived** until it is measured, and **measured on `<ENV>`** after.

## 9. Report template

```markdown
### Query efficiency: <endpoint or function>
Target: <ENV>, tenant size <N rows in table>, Postgres <version>, passes kept <2..N>

| | statements | planning ms | execution ms | shared hit | shared read |
|---|---|---|---|---|---|
| old | | | | | |
| new | | | | | |

- **Dominates:** <hottest exclusive-time node, e.g. SubPlan on comments, loops=12k>
- **Saved:** <round trips N to M; scans N to M; buffers ...>. Measured / source-derived.
- **Unchanged:** <correlated subquery X, index usage on Y, network time not in EXPLAIN>
- **Caveats:** sub-1 ms deltas are noise; <dataset caveat>
- **Next target:** <e.g. replace per-row lookup with pre-aggregated join; add index on (...)>
```

## Rules

- **NEVER** explain hand-rewritten SQL. Capture what the code emits.
- **NEVER** run anything but read-only transactions against shared or prod-like DBs. Get explicit approval for each production environment.
- **NEVER** commit call-count/spy tests to prove statement reductions. Measure once and report it in the PR.
- **NEVER** run parallel writes in one jj working copy.
- **ALWAYS** discard the cold first pass, and report sub-1 ms deltas as noise.
- **ALWAYS** verify ORM/driver hook APIs against the installed version.
