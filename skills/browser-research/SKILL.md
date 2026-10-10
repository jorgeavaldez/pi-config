---
name: browser-research
description: Run browser-heavy research in Jorge's Chrome, solo or with parallel worker agents. Covers the research folder, a one-time connection and login preflight, worker briefs, context-efficient extraction, NEEDS JORGE handoffs for logins and captchas, and follow-ups in fresh workers. Use before multi-step browser research or when orchestrating browser agents.
---

# Browser Research

`AGENTS.md` owns browser connection, session, and tab rules; follow them, do not restate them in briefs.
`herdr-manager` owns pane routing and context thresholds; `agent-prompt-drafting` owns prompt wording.
This skill owns the research workflow and browser cost discipline.
For flight or travel research, also read `references/flights.md`.

Every tool call resends the whole conversation. Browser work is many small steps, so cost grows with steps × context size. Keep both small.

## Orchestrator setup

1. **Research folder.** One folder per research task:
   - `brief.md`: goal, constraints, and Jorge's binding decisions. Mark "typically/likely/(verify)" claims as unverified.
   - `progress.md`: worker status and the shared findings format (table columns, units, verified-vs-assumed labeling).
   - `findings/<worker>.md`: one per worker, written only by that worker.
2. **Preflight once, before any dispatch.** Run `--session <task>-preflight --pin-tab tab new <first site>`, then `get url`, then close that tab. Then list every login the scope needs and ask Jorge for all of them in one message. Dispatch only after the connection works and the logins are done; workers must not discover setup problems one at a time.
3. **Split by site, not by category.** Give each worker a scope that fits about 128k tokens of context, e.g. one airline or points program rather than "all cash prices". One agent per site at a time.
4. **Mechanical extraction workers** may use a cheaper model or a lower thinking level when the harness allows; keep the stronger model for synthesis.

## Worker brief

Include, briefly:

- Role, scope, and the exact deliverable.
- Paths to `brief.md`, `progress.md`, and the worker's own findings file. Update the findings file after every meaningful search so progress survives interruption.
- Read-only boundaries: no booking, holding, paying, transferring, or account changes; no source control.
- Verification: label each fact verified (source URL or site plus time checked) or assumed.
- Browser session name, `<task>-w<N>`.
- "Load the `browser-research` skill and follow its Worker rules."
- Finish: stop when the findings file covers the scope, and reply with a summary of at most 5 lines.

## Worker rules

- **One call per known sequence.** For multi-step flows (open, wait, extract, or looping over dates/routes/fares), use a single `agent_browser_code` cell and `emit()` only the fields the findings need. Do not spend separate tool calls on open/wait/snapshot/click when the flow is predictable.
- **Extract, don't browse.** Prefer scoped `eval --stdin` or `get text` returning compact JSON. Use `snapshot -i --search <text>` or `--filter` only when you need refs. Take screenshots only when the image itself is evidence.
- **Setup is not yours to fix.** If the connection, a login, or a captcha blocks you, do not debug or retry in a loop. Add the exact site and need under `## NEEDS JORGE` at the top of your findings file, continue other sites if you can, and end your turn with one line starting `NEEDS JORGE:`. Wait for "retry".
- **Write findings to the file, not the chat.**
- **Close your own tabs** when done.

## Follow-ups and recovery

- **Gaps found after a worker finishes:** when `herdr-manager` calls for a fresh session, give it a new browser session name (`<task>-w<N>b`), the existing findings file, and the specific gaps.
- **Connection breaks mid-run** (Chrome restarted, debugging turned off): the orchestrator fixes and re-verifies it once, then sends "retry" to the blocked workers.
- **Logins:** collect every NEEDS JORGE item across workers and ask Jorge once.
- **Wrap-up:** confirm workers closed their tabs, reconcile findings into `progress.md`, and leave source control to Jorge unless asked.
