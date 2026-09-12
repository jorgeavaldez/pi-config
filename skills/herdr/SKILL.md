---
name: herdr
description: "Control Herdr from a managed pane or, when explicitly requested, control an exact named Herdr session on an SSH host. Manage workspaces, tabs, panes, agents, output, and state changes without confusing local and remote sessions."
---

# Herdr

This skill owns command mechanics.
`herdr-manager` owns routing, task/session continuity, and watcher safety.
`agent-prompt-drafting` owns delegated prompt wording and permissions.

## Choose the control route

Choose the control mode before issuing any Herdr command:

- **Local:** require `HERDR_ENV=1`. Otherwise do not inspect or control the local or focused Herdr session from outside Herdr.
- **Remote:** use only when the user explicitly requested an SSH-accessible remote Herdr and the exact SSH target and named Herdr session are known. The dispatching shell does not need `HERDR_ENV=1`; every control command runs on that host against that named session. Ask if the target or session is missing or ambiguous.

Remote mode is not permission to control a local focused session from outside Herdr.
Never fall back from a failed remote route to local Herdr, a default remote session, or another live session.

Run remote commands through an SSH login shell.
First verify that the named session already exists without attaching to or creating it:

```bash
ssh <ssh-target> 'zsh -ic '\''herdr session list --json'\'''
```

Then scope every session-specific command with `--session`:

```bash
ssh <ssh-target> 'zsh -ic '\''herdr --session <session-name> workspace list'\'''
```

`herdr --remote <ssh-target>` attaches an interactive TUI; it is not the noninteractive command transport.
Transport multiline prompts through standard input rather than interpolating them into remote shell source.
In remote mode no pane in the target session is the coordinator's current pane.
Use explicit live IDs from that named session, never remote focus or implicit caller context, and keep focus unchanged.

All examples below are inner commands: run them directly in local mode or through the verified SSH and named-session route in remote mode.

## Discover the installed contract

The installed binary on the selected host is the authority for command syntax.
Inspect it before relying on lifecycle commands:

```bash
herdr --help
herdr agent --help
herdr agent start --help
herdr agent prompt --help
herdr agent wait --help
herdr pane wait-output --help
herdr status server
```

These mechanics were checked against Herdr 0.9.0.
Client and server versions can differ; check compatibility before relying on server features.
For investigation, use `https://herdr.dev/llms.txt` and open only the relevant versioned documentation.
`herdr --skill` prints the installed upstream mechanics; preserve this skill's local/remote restrictions when consulting it.

Do not run bare `herdr` for discovery; it launches or attaches the TUI.
Do not probe mutating commands by omitting arguments: commands such as `workspace create` execute with defaults.
A missing method is not permission to stop, upgrade, or replace the server.

## Layout, identity, and state

- Workspaces and tabs organize terminal locations; creating either also creates its root pane.
- Panes are raw terminals containing shells, agents, servers, or other processes.
- Agent commands address the recognized coding agent currently occupying a pane.

Public IDs are opaque stable handles, such as workspace `w1`, tab `w1:t1`, and pane `w1:p1`.
Closed tab and pane IDs are not reused.
Moving a pane between workspaces changes its workspace-qualified ID; continue with the returned `.result.move_result.pane.pane_id`.
Parse IDs from responses instead of deriving them from sidebar order or examples.
Stable pane identity does not prove the same agent still occupies it: verify the task, cwd, and agent session before acting.

Agent commands accept a current pane ID or a unique live agent name, not a Pi session UUID, terminal ID, or bare agent kind.
Names match `[a-z][a-z0-9_-]{0,31}` and identify the current occupant, not a durable conversation.
IDs and names are scoped to one server; identical names or IDs on different hosts are unrelated.

In local mode use the inherited caller identity, not the UI-focused pane:

```bash
printf '%s\n' "$HERDR_WORKSPACE_ID" "$HERDR_TAB_ID" "$HERDR_PANE_ID"
herdr pane current --current
herdr tab list --workspace "$HERDR_WORKSPACE_ID"
herdr pane list --workspace "$HERDR_WORKSPACE_ID"
```

For another task, use its verified explicit workspace ID instead.
Use `workspace list` only when needed to locate that workspace; keep inventories task-scoped.
Selecting a machine or focusing a pane in the TUI does not retarget commands running in your pane.

`agent_status` is one of `idle`, `working`, `blocked`, `done`, or `unknown`:

- `idle` and `done` both mean ready for input. A newly launched, never-prompted agent is also idle.
- The CLI/API distinguishes `done` from `idle` using server seen state. Explicit focus commands mark the target seen; reads do not. Each TUI client tracks viewed completions independently, so its Done badge can differ from CLI state.
- `blocked` means a recognized approval/question UI, not successful task completion.
- `unknown` does not prove readiness or completion.

A settled state alone never proves the assigned task ran or succeeded.
Read the actual result before reporting completion or dispatching dependent work.

## Create authorized layout

Create only the layout allowed by the user and the task's routing rules.
Use `--no-focus` unless a focus change was requested, and preserve the intended cwd explicitly.

```bash
herdr tab create --workspace <workspace-id> --label <label> --no-focus
herdr pane split <pane-id> --direction right --cwd <cwd> --no-focus
herdr workspace create --cwd <cwd> --label <label> --no-focus
```

Choose split direction from available geometry rather than repeatedly creating narrow columns or short rows.
Parse the response:

- `workspace create`: `.result.workspace`, `.result.tab`, `.result.root_pane`.
- `tab create`: `.result.tab`, `.result.root_pane`.
- `pane split`: `.result.pane`.

Use the returned root pane for the first process; do not split just to obtain another launch location.
Inspect the new target before starting dependent work.
Use the relevant group's `--help` for rename, move, focus, or close syntax.

## Start, submit, and wait for an agent

Use the agent surface rather than raw terminal input for normal agent work.
`agent start` requires an existing available shell pane: its interactive shell must be in the foreground, not an editor, running command, or another agent.
It does not create layout.

```bash
herdr agent start <name> --kind <kind> --pane <pane-id> -- <native-agent-args...>
```

Honor the requested agent, model, reasoning level, and session-continuity flags.
Success means Herdr detected the expected agent in that terminal and it is ready for input; it does **not** mean a task was submitted.
Startup defaults to 30 seconds.
If startup returns `agent_not_ready`, inspect the retained agent name and blocked UI rather than launching another agent.

Revalidate the target and its session, confirm `idle` or `done`, consume any previous result, and ensure a clean input box before submission.
Never prompt a working agent unless the user explicitly authorized interruption.
Submit the actual task and wait as one operation:

```bash
herdr agent prompt "$target" "$prompt" --wait --timeout 600000
```

`agent prompt` sends text and encoded Enter as one ordered submission, honoring bracketed-paste mode.
An already-blocked agent is rejected before input is sent.
With `--wait`, submission from a non-working state must produce observed `working` or `blocked` activity within five seconds; otherwise it returns `agent_prompt_stalled` (or `timeout` if the caller deadline expires first).
It then waits for the first settled `idle`, `done`, or `blocked` state.
Use these defaults for ordinary work; do not add a done-only filter or repeat the default states.
This tracks lifecycle state, not a particular turn: prompting an already-working agent can match that agent's existing turn instead.

For an already-submitted task whose activity has been confirmed:

```bash
herdr agent wait "$target" --timeout 600000
```

Standalone wait checks current state and can immediately return for a never-prompted idle agent.
It is not a substitute for submitting the task or confirming activity.
If dispatching without `--wait`, verify submission and observed activity before treating the task as running.
Never label agent startup or prompt echo as successful delegation.

Use `--until` only for a genuinely state-specific workflow.
For alternatives, repeat `--until` in **one** command; do not chain separate waits with shell `||`, which only starts the next wait after the first fails.

```bash
herdr agent wait "$target" --until blocked --timeout 120000
```

Herdr timeout values are milliseconds; a surrounding shell-tool timeout in seconds must exceed the Herdr deadline plus transport overhead.
Without a Herdr timeout, waits can be indefinite.

After a wait returns, inspect its returned status and read the result:

```bash
herdr agent get "$target"
herdr agent read "$target" --source recent-unwrapped --lines 120
```

On `blocked`, inspect the question/approval and obtain any required user decision; do not advance the dependency as complete.
On timeout, stalled submission, cancellation, or error, inspect current identity, state, and output before deciding what to do.
These outcomes do not prove the prompt was never delivered: never blindly resubmit, hide the error with `|| true`, or report success because a later read succeeded.
Use `agent send-keys` for intentional interactive controls, not as the routine prompt transport.

## Raw commands and output waits

Use pane commands for shells, tests, servers, and other ordinary terminal processes:

```bash
herdr pane run "$pane" "$command"
herdr pane wait-output "$pane" --source recent-unwrapped --match "$expected_output" --timeout 120000
herdr pane read "$pane" --source recent-unwrapped --lines 120
```

`pane run` sends command text and Enter together.
For intentional raw input, `pane send-text` omits Enter and `pane send-keys` sends logical keys.

`pane wait-output` searches the selected snapshot **immediately, including existing output**, then polls.
It is not restricted to output produced after the wait started.
A command echo, submitted prompt, startup banner, or earlier result can satisfy a match.
Choose output attributable to the intended command execution; never use echoed task wording as proof of agent activity or completion.
Use the agent lifecycle surface for agent work instead.

Use `--match <text>` for a literal substring or `--regex <pattern>` for a regex; `--regex` takes the pattern, not a boolean flag.
A text match does not establish process exit status or task success.
Inspect the command's actual outcome.

Read sources:

- `visible`: current rendered viewport.
- `recent`: recent rendered output, including soft wraps.
- `recent-unwrapped`: recent output with soft wraps joined; prefer it for logs/transcripts and explicitly select it for corresponding waits.

`--lines` limits the requested snapshot; `pane read --format ansi` preserves terminal styling when it is evidence.
Increasing lines cannot recover output lost from an alternate screen.
If a completed response remains unavailable after a larger read, request the complete result in a temporary Markdown file and read that path; use this only as a recovery fallback.

## Safety and result handling

- Keep focus unchanged for background work.
- Use explicit verified IDs/names, or local `--current` when intentionally addressing the caller; never rely on user focus.
- Do not close resources outside the authorized task or discard unconsumed results.
- Never kill the main Herdr process or stop its server from an active session unless the user explicitly intends to stop its panes and processes.
- Do not create test sessions, watchers, wrappers, or polling machinery when the existing agent start/prompt/wait operations cover the task.
- Most control commands return JSON; terminal reads return text. Check command-specific help and inspect the actual response.
- Server errors are JSON on stderr with exit status 1; CLI syntax errors exit with status 2. Preserve failures rather than masking them with a later successful command.
