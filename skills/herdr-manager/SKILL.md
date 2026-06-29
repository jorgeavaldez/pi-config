---
name: herdr-manager
description: "Coordinate multiple Herdr panes and Pi agents: identify sessions, map panes to PRs or tasks, delegate review/implementation work into clean panes or workspaces, queue follow-ups safely after agents finish, and summarize status/next steps. Use when managing other Herdr agents, PR review panes, plan phases, or task-file delegation."
---

# Herdr Manager

Use this skill when acting as the coordinator for other Herdr panes and Pi agents.

This skill builds on the `herdr` skill.
Load and follow the `herdr` skill for command details before controlling panes.

## First rule

Before doing anything, verify that `HERDR_ENV=1`.
If not, say you are not running inside a Herdr-managed pane and stop.

Keep the current pane as the coordinator unless the user explicitly asks otherwise.
Do not do delegated implementation, review-fix, or long-context work in the coordinator pane.

## Discover and identify agents

Start by reading live Herdr state.
Do not rely on stale pane IDs.
Pane IDs can change after panes/tabs/workspaces close.

Use:

```bash
herdr workspace list
herdr pane list
```

For relevant workspaces, also list tabs:

```bash
herdr tab list --workspace "$WORKSPACE_ID"
```

For each relevant pane, record:

- workspace label and id
- tab label and id
- pane id
- `agent_status`
- `cwd` and `foreground_cwd`
- agent session path/id, if Herdr reports one
- visible branch/bookmark/change context, using source-control inspection in that pane's cwd when useful

Use `pane read` sparingly to understand current context:

```bash
herdr pane read "$PANE" --source recent-unwrapped --lines 80
```

Prefer recent-unwrapped when matching copied commands, PR URLs, branch names, or review output.
Do not over-read huge scrollback unless needed.

## Monitor context usage

Context budget is critical when managing Pi agents.
Always inspect the Pi footer for context usage before deciding whether to continue, queue a follow-up, split a pane, tree-jump, compact, hand off, or start fresh.
The footer shows usage like a percentage of the current context window.

Treat context levels as:

- under 50%: generally usable
- over 50%: danger zone; report it and avoid adding large new context casually
- over 70%: effectively useless for meaningful new work; prefer recovery or a fresh context

Check both the coordinator pane and delegated panes when relevant.
Use `pane read` to inspect the visible/recent footer, and include context usage in status reports when it is high or relevant.

## Choose the right continuation point

Before sending a follow-up or assigning a new task to an existing agent, inspect what the current thread/workstream was.
Compare the new task to the most recent workstream.

If the thread ended on something unrelated to the new task, prefer `/tree` instead of continuing linearly.
Inspect the conversation tree and find an earlier point that can arrive naturally at the new task.
Resume from that point with a concise context prompt that explains the objective and any relevant state.

Preferred recovery order:

1. `/tree` when a suitable earlier point exists.
2. `/handoff` when this is a contextually brand new task set or a major extension beyond the current objective.
3. `/compact` when the current objective is still correct and only a simple summary of plan/output is needed.
4. Brand new session when old context is not useful or would be harmful.

For `/tree`, `/handoff`, or `/compact`, provide a summary/context prompt.
Do not expect the agent to infer the right preservation boundary by itself.

## Map panes to pull requests

When mapping Herdr sessions to PRs:

1. List open PRs with the appropriate repository.
2. In each repo/workspace, inspect the current jj state.
3. Match PR `headRefName` to the jj bookmark/branch visible in the workspace.
4. If needed, query PRs by `--head` for the bookmark.

Use `jj` for source-control inspection.
Do not use git mutation commands.

Useful checks:

```bash
jj status --no-pager
jj log --no-pager -r @ --no-graph -T '"change=" ++ change_id.short() ++ " commit=" ++ commit_id.short() ++ " bookmarks=" ++ bookmarks ++ " desc=" ++ description.first_line() ++ "\n"'
gh pr list --repo OWNER/REPO --author @me --state open --json number,title,url,headRefName,reviewDecision,mergeStateStatus,statusCheckRollup
```

When reporting back, include the live pane/session mapping and concrete next steps.

## Keep contexts clean

Use a new pane or workspace when the task should not inherit the current implementation context.
This is especially important for:

- PR review comment triage/fixes started centrally
- design/code review where prior implementation context could bias the agent
- long-running tasks when the current pane is already context-heavy
- parallelizable implementation phases from a plan file
- tasks delegated from task files

For review-type tasks attached to an existing implementation workspace, split beside the main pane:

```bash
NEW_PANE=$(herdr pane split "$MAIN_PANE" --direction right --no-focus | python3 -c 'import json,sys; print(json.load(sys.stdin)["result"]["pane"]["pane_id"])')
herdr pane run "$NEW_PANE" "pi"
```

Then send the initial review prompt only to the new pane, not the main implementation pane.

For independent plan phases or task-file delegation, prefer a fresh workspace/worktree using the user's workspace helper if available.
If a workspace helper/tool/skill such as workspace-add is available, load and follow it.
If no workspace creation workflow is discoverable, ask the user before inventing one.

## Queue follow-ups without polluting active turns

Never send a follow-up prompt into a pane whose agent is `working` unless the user explicitly asks to interrupt.
Sending text into an active Pi turn pollutes the current working context.

If the target pane is `working`, queue the follow-up from a separate watcher pane/process and wait for Herdr's completion signal first.
Herdr exposes Pi's `agent_end` as `agent_status=done`.

Robust pattern:

```bash
TARGET_PANE="wX:pY"
FOLLOWUP_FILE=$(mktemp "${TMPDIR:-/tmp}/herdr-followup.XXXXXX")
cat > "$FOLLOWUP_FILE" <<'EOF'
Follow-up prompt goes here.
EOF

WATCHER_PANE=$(herdr pane split "$TARGET_PANE" --direction down --no-focus | python3 -c 'import json,sys; print(json.load(sys.stdin)["result"]["pane"]["pane_id"])')

herdr pane run "$WATCHER_PANE" "python3 - '$TARGET_PANE' '$FOLLOWUP_FILE' '$WATCHER_PANE' <<'PY'
import pathlib
import subprocess
import sys

target, followup_file, watcher = sys.argv[1:4]
subprocess.run([
    'herdr', 'wait', 'agent-status', target,
    '--status', 'done',
    '--timeout', '900000',
], check=True)
text = pathlib.Path(followup_file).read_text()
subprocess.run(['herdr', 'pane', 'send-text', target, text], check=True)
subprocess.run(['herdr', 'pane', 'send-keys', target, 'Enter'], check=True)
subprocess.run(['herdr', 'pane', 'close', watcher], check=False)
PY"
```

If the target pane is already `done` or `idle`, it is safe to send a new prompt directly after re-reading pane state.
Still prefer asking the user before giving substantial new instructions to another agent.

## Review-comment management workflow

Treat PR review comment work as a clean-context delegation task.
Do not run it in the main implementation pane.

For PR review comments started from a central coordinator:

1. Identify the PR and the main implementation pane/workspace.
2. Split a new pane beside the main pane; do not use the main pane.
3. Start Pi in the new pane.
4. Trigger the review-comments skill with the PR URL.
5. Add a short context line with the relevant plan file and phase.
6. Wait for the agent's triage output.
7. If the triage is straightforward, tell the review pane to proceed.
8. If it asks for product/design choices or defaults, bring that clarification back to the user.

Example initial prompt shape:

```text
/skill:pr-review-comments https://github.com/OWNER/REPO/pull/NUMBER
You may reference the plan file <plan-file>, this PR implements Phase N.
```

If a follow-up needs to happen after the review agent finishes the current batch, use the queued follow-up pattern above.
Do not type it into a working review pane.

## Code-quality review workflow

Treat `code-quality` like PR review comments.
Run it in a fresh side pane, not in the implementation pane, unless the user explicitly asks otherwise.

Before starting `code-quality`:

1. Identify the implementation pane and workspace.
2. Re-read Herdr state for current pane IDs and `agent_status`.
3. Verify the target workspace/revision from the implementation pane's cwd:

   ```bash
   jj status --no-pager
   jj log --no-pager -r @ --no-graph -T '"change=" ++ change_id.short() ++ " commit=" ++ commit_id.short() ++ " bookmarks=" ++ bookmarks ++ " desc=" ++ description.first_line() ++ "\n"'
   ```

4. Include the implementation pane id, session id/path if available, cwd, and current jj revision in the code-quality prompt.
5. Make clear that the review should inspect the current jj revision/worktree implemented by the other agent.

If the implementation pane is still `working`, queue the code-quality prompt after `agent_status=done`.
Do not interrupt the implementation turn or inject review instructions into it.

If context usage is high in the implementation pane, prefer the fresh side pane even more strongly.
The point is to review the current jj revision, not inherit the implementation agent's entire conversation.

## Find relevant plan files without hardcoded paths

When a delegated task needs plan context, search the current project/vault using available project instructions and skills.
Do not hardcode Obsidian vault paths or fixed note locations.

Use the existing Obsidian/task/prompt skills when the task matches, for example:

- reminders or task-file updates: load the reminder/task skill
- task triage: load the inbox/task triage skill
- prompt drafting: load the prompt-drafting skill
- overview or handoff notes: load the overview/handoff skill
- migrating docs into the vault: load the migration skill

When searching manually, prefer fast file/content search:

```bash
fffind "short concept words"
ffgrep "distinct phrase"
```

Read the candidate plan before passing it to a delegated agent.
Mention only the high-signal plan file(s), not every possible note.

## Parallel phases from a plan

When asked to start parallelizable phases from a plan:

1. Read the plan and identify independent phases or work packets.
2. Confirm which phases are safe to run in parallel.
3. For each phase, create an isolated workspace using the user's workspace helper if available.
4. Create or focus a Herdr workspace/tab for that isolated workspace.
5. Start a fresh Pi agent with a concise prompt containing:
   - plan file reference
   - exact phase/work packet
   - expected outputs
   - validation commands if known
   - instruction to avoid touching unrelated phases
6. Track pane id, workspace, session, phase, status, blockers, and next action.
7. Periodically check `agent_status` and pane output.
8. Summarize progress and clarifications to the user.

Do not start multiple agents editing the same workspace unless the user explicitly asks.

## Delegating from task files

When delegating tasks from task files:

1. Load the relevant task/inbox skill first.
2. Read the task and linked context.
3. Find the best plan/prompt/doc links.
4. Create a clean workspace/pane for the delegated work.
5. Give the agent only the task-specific context it needs.
6. Keep the coordinator pane focused on tracking and user decisions.

Do not rewrite task files or mark tasks complete unless the user asked for that.

## Reporting back

When reporting status to the user, be concise and operational:

- PR/task/phase
- workspace/tab/pane/session
- current status (`working`, `done`, `blocked`, etc.)
- current jj revision/worktree when relevant
- context usage status, especially when over 50%
- whether you continued, tree-jumped, compacted, handed off, started fresh, or queued after `done`
- what the agent proposed or changed
- what needs user clarification
- next action already queued or recommended

If an agent asks for clarification, do not guess unless the decision is clearly mechanical and reversible.
Surface the question to the user.
