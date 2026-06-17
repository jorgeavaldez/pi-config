---
name: tmux-background
description: >
  Run servers, dev processes, background scripts, long-running commands, and
  commands that may not exit in tmux with explicit readiness/completion
  signaling. Use automatically for requests like "run the server", "start the
  dev server", "run this in the background", "start workers", "launch the app",
  "watch this process", or any command that may keep running or needs readiness
  before continuing. Avoids manual sleep/poll loops and keeps logs/sessions
  auditable.
---

# Tmux Background

Use this skill whenever a user asks you to run a command that may be long-running,
backgrounded, server-like, watch-mode, or otherwise likely to keep running while
you continue working.

Primary goals:

- Run these commands in detached `tmux` sessions.
- Avoid context-polluting `sleep`, manual screen checks, and repeated polling in
  the agent conversation.
- Continue as soon as a real completion/readiness signal fires.
- Keep everything auditable: tmux session, full output log, status files, exact
  command record, and clear attach/kill instructions.
- Prefer reusable helper scripts for repeated workflows.

## Critical Rules

1. **Do not run server/background/watch commands directly in the foreground**
   unless the user explicitly asks.
2. **Do not use manual `sleep && check && sleep && check` loops.** If waiting is
   needed, use `tmux wait-for`, native command wait flags, or a helper script
   that owns its own timeout/retry loop.
3. **Always choose the strongest practical signal** before continuing:
   completion, native wait flag, HTTP health endpoint, TCP port, log readiness
   line, or a bespoke reusable checker.
4. **Always report audit handles** after launch: session name, attach command,
   log file, status directory, and kill command.
5. **Do not auto-kill successful server sessions.** Leave them alive so the user
   can inspect output or stop them manually.
6. **For repeated workflows**, add or improve a small reusable script under this
   skill's `scripts/` directory, then update the script glossary below.

## Decision Flow

1. **The command naturally exits**
   - Use `scripts/tmux-background.sh --wait exit -- <command...>`.
   - The runner captures the process exit code, signals `tmux wait-for`, and
     leaves the pane open for inspection.

2. **The tool has a native wait/readiness flag**
   - Prefer native flags such as `--wait`, `--watch=false`, `docker compose up
     --wait`, deployment wait flags, migration status commands, or test runner
     completion modes.
   - Usually combine this with `--wait exit` because the native wait command
     exits at the semantically correct time.
   - Verify the flag behavior from local docs/help when uncertain.

3. **A web app exposes a health/page endpoint**
   - Use `--wait http --url <url>`.
   - Prefer this over raw port checks because it validates application-level
     readiness.
   - Add `--expect-regex <regex>` if a specific response matters.

4. **Readiness means a TCP listener is accepting connections**
   - Use `--wait port --host 127.0.0.1 --port <port>`.
   - This is weaker than HTTP health but broadly useful.

5. **Readiness appears only in logs**
   - Use `--wait log --pattern <regex>`.
   - The helper attaches `tmux pipe-pane` before starting the command, streams
     pane output into a log, strips ANSI for matching, and signals readiness on
     the first match.

6. **Readiness is multi-step or likely to repeat**
   - Create a dedicated helper in `scripts/` that accepts parameters, has a
     timeout, prints diagnostics, and exits non-zero on failure.
   - Then run it via `tmux-background.sh` or from a project-specific wrapper.
   - Update the glossary in this file with its location and purpose.

## Primary Launcher

Use the launcher from the skill directory:

```bash
/Users/jorge/.pi/agent/skills/tmux-background/scripts/tmux-background.sh \
  --session <descriptive-kebab-name> \
  --cwd <working-directory> \
  --wait <exit|http|port|log|none> \
  [wait options...] \
  -- <command...>
```

For complex shell commands, environment assignments, aliases/functions, pipes, or
multiple commands, wrap the command explicitly:

```bash
... -- bash -lc 'source /path/to/helpers && ENV=local some-command --flag'
```

### Examples

Batch command that should finish:

```bash
scripts/tmux-background.sh \
  --session tests-api \
  --cwd /path/to/repo \
  --wait exit \
  -- bash -lc 'bun test tests/api.test.ts'
```

Server with HTTP readiness:

```bash
scripts/tmux-background.sh \
  --session dev-server \
  --cwd /path/to/repo \
  --wait http \
  --url http://127.0.0.1:3000/health \
  --timeout 90 \
  -- bash -lc 'npm run dev'
```

Server with only a known port:

```bash
scripts/tmux-background.sh \
  --session api-server \
  --cwd /path/to/repo \
  --wait port \
  --port 8000 \
  -- bash -lc 'python -m app'
```

Server with log readiness:

```bash
scripts/tmux-background.sh \
  --session vite-dev \
  --cwd /path/to/repo \
  --wait log \
  --pattern 'Local:|ready in|listening on' \
  -- bash -lc 'npm run dev'
```

Start without waiting when no useful signal exists:

```bash
scripts/tmux-background.sh \
  --session worker \
  --cwd /path/to/repo \
  --wait none \
  -- bash -lc 'npm run worker'
```

## Reusability Guidance

Before choosing an approach, infer or ask only what is needed:

- Is this a one-off command or a repeated workflow?
- Is there already a project script for startup, health checks, or waiting?
- What is the strongest available signal: process exit, native wait flag, HTTP,
  port, log line, file, queue state, or combined checks?
- What timeout and diagnostics will be useful if readiness fails?

For repeated workflows, create a reusable script under:

```text
/Users/jorge/.pi/agent/skills/tmux-background/scripts/
```

Reusable scripts should:

- Accept host/port/url/channel/status paths as arguments where practical.
- Set a timeout.
- Print useful diagnostics on failure.
- Return non-zero on failure.
- Integrate with `tmux wait-for` through `tmux-background.sh` when appropriate.
- Be documented in the glossary below.

## Script Glossary

| Script | Use | Notes |
|---|---|---|
| `scripts/tmux-background.sh` | Main launcher for tmux-backed background/server/batch commands. | Creates a detached session, attaches logging before command start, records metadata, waits via explicit readiness/completion signal, and leaves the session alive. |
| `scripts/wait-for-http.sh` | Wait until an HTTP endpoint succeeds, optionally matching response content. | Used by launcher `--wait http`; can also be run standalone. Polling is contained inside the script with timeout diagnostics. |
| `scripts/wait-for-port.sh` | Wait until a TCP host/port accepts connections. | Used by launcher `--wait port`; can also be run standalone. |
| `scripts/pipe-pane-watch.sh` | `tmux pipe-pane` consumer that logs pane output and signals when a regex appears. | Used by launcher `--wait log`; strips ANSI before matching and keeps logging after readiness. |

Update this table whenever adding a reusable script.

## Reporting Checklist

After launching, tell the user:

- `tmux attach -t <session>`
- log path, usually `~/.cache/pi/tmux-background/<session>-<timestamp>/pane.log`
- status directory path
- kill command: `tmux kill-session -t <session>`
- readiness/completion result and signal used
- if readiness failed but the process is still running, say so clearly

## Inspecting Later

```bash
tmux has-session -t <session> 2>/dev/null && echo alive
tail -f ~/.cache/pi/tmux-background/<session>-<timestamp>/pane.log
tmux capture-pane -t <session> -p | tail -80
tmux kill-session -t <session>
```
