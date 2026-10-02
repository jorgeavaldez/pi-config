/**
 * EXAMPLE: capture the exact SQL and params a Drizzle + postgres.js code path emits.
 *
 * The script lives outside the repo. `createRequire` is anchored at the app's
 * package.json, so `postgres` and `drizzle-orm` resolve from the app's
 * node_modules. Contract: each named export is called as `fn(db, ...args)`.
 * Adapt that line if the app uses a db singleton or a factory.
 *
 * Run it from the app dir so tsx picks up the app's tsconfig paths:
 *   DATABASE_URL=<LOCAL_TEST_DB_URL> npx tsx <skill>/scripts/capture_postgresjs.ts \
 *     --app ./package.json --module ./src/server/stats.ts \
 *     --args '{"getStats": ["org_1", {"$date": "2026-09-01T00:00:00Z"}]}' \
 *     --out <SCRATCH_DIR>/new.json getStats getTrend
 *
 * Output: [{label, sql, params}] for build_explain.py. Statement counts per
 * label go to stderr; that is the one-off measurement to quote in the PR.
 *
 * Verify against the installed versions: postgres.js `debug(connection, query,
 * parameters, paramTypes)` option, and `drizzle(client, { schema })`. Newer
 * Drizzle also accepts `drizzle({ client, schema })`.
 * Note: `import()` of the CJS entry that createRequire resolves can give a
 * second drizzle instance next to the app's ESM one. If query building breaks,
 * build `db` with the app's own factory and pass it the same `debug` hook.
 */
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

const { values: opt, positionals: fns } = parseArgs({
  allowPositionals: true,
  options: {
    app: { type: 'string', default: './package.json' },
    module: { type: 'string' },
    schema: { type: 'string' },
    args: { type: 'string', default: '{}' },
    out: { type: 'string' },
    'allow-remote': { type: 'boolean', default: false },
  },
});
if (!opt.module || !opt.out || fns.length === 0) {
  console.error('usage: capture_postgresjs.ts --module <file> --out <json> [--app pkg.json] [--schema <file>] [--args JSON] fn...');
  process.exit(2);
}

const url = process.env.DATABASE_URL ?? '';
const host = url ? new URL(url).hostname : '';
if (!['localhost', '127.0.0.1', '::1', '[::1]'].includes(host) && !opt['allow-remote']) {
  console.error(`refusing: DATABASE_URL host "${host}" is not local (pass --allow-remote deliberately)`);
  process.exit(2);
}

const appRequire = createRequire(resolve(opt.app!));
const load = async (spec: string) => {
  const m = await import(pathToFileURL(appRequire.resolve(spec)).href);
  return m.default?.default ?? m.default ?? m;
};
const fileImport = (p: string) => import(pathToFileURL(resolve(p)).href);

const toJson = (v: unknown): unknown => {
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'bigint') return v.toString();
  if (v instanceof Uint8Array) return '\\x' + Buffer.from(v).toString('hex');
  if (Array.isArray(v)) return v.map(toJson);
  return v;
};
// {"$date": "..."} in --args becomes a Date
const revive = (v: any): any =>
  v && typeof v === 'object' && !Array.isArray(v) && '$date' in v ? new Date(v.$date)
  : Array.isArray(v) ? v.map(revive) : v;

type Captured = { label: string; sql: string; params: unknown[] };
const captured: Captured[] = [];
let label = '__setup__';

// wrapped in main(): tsx may compile this file as CJS, where top-level await fails
async function main() {
  const postgres = await load('postgres');
  const { drizzle } = await import(pathToFileURL(appRequire.resolve('drizzle-orm/postgres-js')).href);
  const client = postgres(url, {
    max: 1, // serial and deterministic; the app may use a bigger pool
    debug: (_conn: unknown, query: string, params: unknown[]) =>
      captured.push({ label, sql: query, params: (params ?? []).map(toJson) }),
  });
  const schema = opt.schema ? await fileImport(opt.schema) : undefined;
  const db = drizzle(client, schema ? { schema } : {});
  await client`select 1`; // absorb connection-setup queries under __setup__

  const mod = await fileImport(opt.module!);
  const argMap: Record<string, unknown[]> = JSON.parse(opt.args!);
  try {
    for (const name of fns) {
      if (typeof mod[name] !== 'function') throw new Error(`${opt.module} has no export ${name}`);
      label = name;
      await mod[name](db, ...revive(argMap[name] ?? []));
    }
  } finally {
    await client.end();
  }

  const out = captured.filter((c) => c.label !== '__setup__');
  writeFileSync(opt.out!, JSON.stringify(out, null, 2));
  for (const name of fns) console.error(`${name}: ${out.filter((c) => c.label === name).length} statements`);
  console.error(`wrote ${out.length} statements to ${opt.out}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
