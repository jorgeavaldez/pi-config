---
name: herdr-manager
description: "Coordinate multiple Herdr panes and Pi agents safely: inventory live Herdr state, map tasks to exact workspace/tab/pane/session/tree/cwd/revision, delegate implementation/investigation/review/bookkeeping with minimal context, and queue local follow-ups without cross-workspace confusion or context pollution."
---

# Herdr Manager

Use this skill when acting as the coordinator for other Herdr panes and Pi agents.

This skill builds on the `herdr` skill.
Load and follow the `herdr` skill for command details before controlling panes.

This skill must be paired with `agent-prompt-drafting` every time you write instructions for another agent.
Herdr manager owns routing, pane/workspace mapping, and watcher safety.
`agent-prompt-drafting` owns the actual prompt wording, mode, approval gates, edit permissions, and expected artifacts.
Load `agent-prompt-drafting` before drafting or sending any agent prompt, follow-up, queued prompt, or watcher-delivered instruction.

The manager is the **context and session router**.
Agents do not share context.
Do not expect one agent to know a sibling agent's plan, investigation, state, terminology, pane, cwd, or revision.
Session/tree continuity is routing-critical state, not text context.
If knowledge must cross agents, pass only the exact findings or constraints the recipient needs.

## First rule

Before doing anything, verify that `HERDR_ENV=1`.
If it is not `1`, say you are not running inside a Herdr-managed pane and stop.
Do not inspect or control Herdr from outside Herdr.

Keep the current pane as the coordinator unless the user explicitly asks otherwise.
Do not do implementation, review-fix, investigation, or long-context work in the coordinator pane.

## Non-negotiable safety rules

- Always inventory live Herdr state before acting.
- Always map `task -> workspace -> tab -> pane -> session/tree -> cwd -> revision` before delegating or queueing.
- Always use `agent-prompt-drafting` before drafting or sending instructions to another agent.
- Always ensure the target Pi input box is clean before sending a prompt; never append a prompt to whatever text is already staged in the input.
- For plan-based parallel delegation, anchor every child prompt to the shared plan and include the sibling workstream map, owned seam, expected inputs, and final integration path.
- Fork from a finalized plan/session only when Jorge asked or approved and context is manageable; otherwise start fresh and pass the plan path plus concise task-local context.
- Treat “that agent,” “same agent,” “from this point in the session tree,” “use `/tree`,” and similar language as a session-routing requirement.
- Never rely on remembered pane IDs, remembered tab numbers, or phrases like "tab 2" from memory.
- Keep work scoped to the correct Herdr workspace.
- Do not create Herdr workspaces or jj workspaces/worktrees unless the user explicitly instructs you to.
- Do not substitute a new Pi session plus copied context when the user asked for same-session/tree continuity.
- Never send a prompt into a `working` agent unless the user explicitly asks to interrupt.
- Follow-up triggers must match the real dependency, not a nearby or related workstream.
- Prompts must be narrow, positive, and task-local.
- For parallel implementation, delegate explicit seams rather than broad packages; use expected files/areas as orientation, not a hard cage.
- Avoid unrelated negative scoping; saying "do not broaden into X" still introduces X into context.
- If the user's reference or the exact Pi continuation mechanics are ambiguous, stop and ask before spawning, creating, rebasing, or queueing anything.

## Inventory before acting

Start every orchestration action by reading live state:

```bash
herdr workspace list
herdr pane list
```

For every potentially relevant workspace, list tabs:

```bash
herdr tab list --workspace "$WORKSPACE_ID"
```

For each relevant pane, record:

- task or workstream label
- workspace label and id
- tab label and id
- pane id
- `agent_status`
- `cwd` and `foreground_cwd`
- Pi session path/id, if Herdr reports one
- requested session/tree continuation point, when the user references `/tree`, “same agent,” or similar
- current jj revision, when the task touches a repo

Use `pane read` sparingly to confirm the pane's current workstream and footer/context usage:

```bash
herdr pane read "$PANE" --source recent-unwrapped --lines 80
```

Prefer `recent-unwrapped` when matching copied commands, PR URLs, branch/bookmark names, review output, or prompt text.
Do not over-read huge scrollback unless needed.

For repo work, verify the revision from the target pane's `cwd` before delegating:

```bash
cd "$TARGET_CWD"
jj status --no-pager
jj log --no-pager -r @ --no-graph -T '"change=" ++ change_id.short() ++ " commit=" ++ commit_id.short() ++ " bookmarks=" ++ bookmarks ++ " desc=" ++ description.first_line() ++ "\n"'
```

Report the mapping before acting when there is any ambiguity.
Use a compact shape like:

```text
Task: review-feedback cleanup
Workspace: wE "remediation review feedback webhooks"
Tab: wE:t3 "review feedback"
Pane: wE:p3, status=idle
Session: ...019f1a5d...
Cwd: /Users/jorge/proj/werk/workspaces/remediation-review-feedback-webhooks
Revision: change=... commit=... desc=...
```

## Resolve ambiguity and session-continuity requests

When the user says “that agent,” “same agent,” “continue from here,” “from this point in the session tree,” “use `/tree`,” or similar, treat it as a requirement to continue the exact Pi session/tree.
If live state identifies the exact pane/session and you can safely use the requested continuation mechanism, use that route.
If the exact target or Pi `/tree`/continuation mechanics are unclear, ask before spawning anything.
Do not satisfy this by copying context into a new Pi session.

Stop and ask before acting on ambiguous references like:

- "first set of changes"
- "that agent" when multiple agents could match
- "the review pane"
- "tab 2"
- "the current workspace"
- "queue it after this finishes"
- "the implementation agent"

Ask a concise question that names the live candidates.
Do not guess based on memory or overall project sequencing.

Example:

```text
I see two plausible targets:
- wE:p3 in "remediation review feedback webhooks" (review-feedback cleanup)
- wF:p3 in "remediation pr check reporting" (actions/check implementation)
Which pane should receive the follow-up, and which pane should be the completion trigger?
```

## Context discipline

Agents are isolated workers.
The manager owns cross-agent routing.

When passing context between agents:

- pass only task-local facts;
- pass exact file paths, plan sections, PR URLs, constraints, and decisions;
- for parallel work, pass a concise sibling map: sibling responsibilities, this agent's seam/output, expected sibling inputs, and integration owner/path;
- omit sibling-agent history unless it is directly necessary;
- do not mention unrelated work as a negative constraint;
- do not make the recipient infer another agent's terminology;
- do not dump the coordinator's whole understanding into the prompt.

Prefer positive scoping that leads with allowed edits and a stop condition:

```text
Apply the cleanup plan you proposed for the review-feedback retry queue.
Allowed edits: retry queue schema, claim/mark logic, result accounting, and tests you already identified.
Stop before editing outside that scope or changing the workspace/session plan.
```

Avoid context-polluting negative scope when the unrelated topic is not already in the target context:

```text
Do not broaden into GitHub check/status work.
Do not refactor into a shared check/review dispatcher.
```

Use negative constraints only when the target agent has already introduced that confusion or the user explicitly asked for the exclusion.
Keep them shorter than the positive scope; do not enumerate future phases just to exclude them.

## Plan-based parallel delegation

Use parallel agents only when the work can be split into independent seams with a later integration path.
Before dispatching, build and report the map:

- shared plan path and section anchors;
- task -> workspace -> tab -> pane -> session/tree -> cwd -> revision for each child;
- each sibling's responsibility;
- this child's seam/output and expected sibling inputs;
- final integration owner/path and validation target;
- session plan for each child: fresh, same-session/tree, or plan-session fork.

Session choice:

- Prefer fresh child sessions with the plan path and concise context.
- Fork from a finalized plan/session only when Jorge asked or approved and the plan context is valuable enough to justify it.
- Do not fork if context is overloaded; pass the plan path, decisions, and seam map instead.
- Do not use a fresh session when Jorge requested same-session/tree continuity.

Prompt shape for each child:

- reference the plan explicitly as the shared context anchor;
- name siblings and their responsibilities;
- state what this child must not duplicate;
- describe the business reason and final integration path;
- define scope by seam and stop boundaries, not a brittle filename allowlist;
- list likely files/areas only as orientation;
- permit nearby code/tests when that is the simplest correct design;
- stop before schema, webhook, source-control, session-plan, or sibling-responsibility changes unless explicitly authorized;
- tell the child to leave a narrow seam note or stop/report when a sibling seam is missing instead of inventing temporary lifecycle behavior;
- include code-quality constraints directly in the prompt: smallest direct implementation, no speculative abstractions, no new public helper/API unless consumed by this or a sibling seam now, behavior-focused tests, and stop if a small seam grows into a subsystem.

## Prompt shape for delegation

Before writing any delegated prompt, load and apply `agent-prompt-drafting`.
This is mandatory even when the prompt is short or nested inside a watcher.

Before sending any prompt into an existing Pi pane, confirm the agent is not `working`, then clear any staged input first.
Use the Pi clear-input key sequence for an idle Pi pane before `herdr pane send-text` / `herdr pane send-keys Enter` / `herdr pane run`.
If you cannot confidently clear the input without interrupting work or exiting the agent, stop and ask instead of sending.
Never assume the input box is empty just because the agent is idle or because recent scrollback looks complete.

Every delegated prompt should be narrow and operational, and must make mode/edit permissions explicit:

```text
You are working in <cwd> on <task>.
Target pane/session/tree/revision: <pane>, <session>, <tree continuation point or fresh-session permission>, <jj revision>.
Relevant context:
- <one exact plan file or section>
- <one exact PR/comment/task link, if needed>
- <specific findings or constraints>
- <for parallel work: sibling responsibilities, this agent's seam/output, expected inputs, and integration path>

Mode: <PLANNING ONLY | INVESTIGATION ONLY | IMPLEMENTATION | REVIEW | BOOKKEEPING>.
<Explicitly state whether file edits are allowed and list the allowed seam/scope first.>
<For parallel work, list expected files/areas as orientation, not a hard cage.>
<Explicitly state source-control permissions.>
<Explicitly state whether this must continue an existing Pi session/tree, fork from an approved plan session, or may start fresh.>
<For planning/revision/design/schema prompts: stop for Jorge's approval before edits.>

Business context, when relevant:
- <why this matters and what consumes the output>

Task:
- <small concrete objective>
- <expected artifact or code change>
- <validation command if known>
- <missing-seam behavior: leave a narrow integration note or stop/report>

Constraints:
- <smallest direct implementation; no speculative abstractions; no unconsumed public helpers/APIs; behavior-focused tests>

Expected output:
- <full detailed plan, changed files, checks run, seam produced, expected sibling inputs, blockers, or other artifact>

Stop and ask if <specific ambiguity> comes up.
```

Do not include unrelated sibling work, speculative future phases, broad project background, or negative exclusions that introduce new concepts.
Do not use ambiguous verbs like “revise”, “fix”, “update”, or “incorporate” unless the prompt explicitly states whether that means planning-only or implementation.

## Workspace and pane locality

Work should happen in the workspace that owns the task.

- Implementation follow-ups stay beside the implementation pane for that workspace.
- Review-feedback follow-ups stay in the review-feedback workspace.
- Actions/check follow-ups stay in the actions/check workspace.
- Bookkeeping/task-file updates stay in the vault/bookkeeping workspace or a dedicated bookkeeping pane.
- Cross-workspace watchers are forbidden unless the user explicitly requests one.

Splitting a pane creates the new pane in the same workspace/tab area as the source pane.
Therefore, split from the pane that owns the work, not from a nearby unrelated pane.

For review/code-quality side work attached to an implementation workspace, split beside the implementation pane:

```bash
REVIEW_PANE=$(herdr pane split "$IMPLEMENTATION_PANE" --direction right --no-focus | python3 -c 'import json,sys; print(json.load(sys.stdin)["result"]["pane"]["pane_id"])')
herdr pane run "$REVIEW_PANE" "cd '$IMPLEMENTATION_CWD' && pi"
```

Before sending the prompt, re-read `herdr pane list` and confirm the new pane is in the intended workspace.

## Workspace creation policy

Do not create Herdr workspaces, jj workspaces, worktrees, branches/bookmarks, or new filesystem clones unless the user explicitly instructs you to.

Workspace isolation and Pi session continuity are separate axes.
A new Herdr or jj workspace may be correct for filesystem isolation, but it does not make a fresh Pi session acceptable when the user asked for the same agent/session/tree.
Before creating a new workspace for an existing agent/session, map both:

- workspace/revision plan;
- Pi session/tree continuation plan.

If either plan is unclear, ask before creating the workspace or spawning Pi.

If the task appears to need isolation but the user did not authorize new workspaces, ask:

```text
This looks like it needs an isolated jj workspace to avoid conflicting edits.
Do you want me to create one, or should I delegate inside the existing workspace <workspace/pane>?
```

Creating a side pane or tab inside an already identified workspace is allowed when it is needed for clean context, review, watching, or local bookkeeping.
Still keep it local to the task-owning workspace.

## Queue follow-ups safely

Never send follow-up text into a `working` agent unless the user explicitly asks to interrupt.
Queue from a watcher pane only after confirming:

1. target task and target pane;
2. trigger dependency and trigger pane;
3. target and trigger are intentionally related;
4. watcher pane will be created in the task-owning workspace;
5. follow-up prompt contains only task-local context;
6. `agent-prompt-drafting` has been applied to the follow-up prompt;
7. the delivered prompt is self-contained and explicitly states mode, edit permissions, source-control permissions, session/tree plan, and approval gate.

Default rule:

- If the follow-up is for pane `wE:p3`, create the watcher by splitting `wE:p3` or another pane in workspace `wE`.
- If the trigger is also `wE:p3`, wait on `wE:p3`.
- If the trigger is a different pane, verify and state why that pane is the real dependency.
- Do not wait on a sibling workspace merely because it is still cooking.

Robust local watcher pattern:

```bash
TARGET_PANE="wX:pY"
TRIGGER_PANE="wX:pZ"
FOLLOWUP_FILE=$(mktemp "${TMPDIR:-/tmp}/herdr-followup.XXXXXX")
cat > "$FOLLOWUP_FILE" <<'EOF'
Follow-up prompt goes here.
EOF

WATCHER_PANE=$(herdr pane split "$TARGET_PANE" --direction down --no-focus | python3 -c 'import json,sys; print(json.load(sys.stdin)["result"]["pane"]["pane_id"])')

herdr pane run "$WATCHER_PANE" "python3 - '$TRIGGER_PANE' '$TARGET_PANE' '$FOLLOWUP_FILE' '$WATCHER_PANE' <<'PY'
import pathlib
import subprocess
import sys

trigger, target, followup_file, watcher = sys.argv[1:5]
subprocess.run([
    'herdr', 'wait', 'agent-status', trigger,
    '--status', 'done',
    '--timeout', '21600000',
], check=True)
text = pathlib.Path(followup_file).read_text()
subprocess.run(['herdr', 'pane', 'send-text', target, text], check=True)
subprocess.run(['herdr', 'pane', 'send-keys', target, 'Enter'], check=True)
subprocess.run(['herdr', 'pane', 'close', watcher], check=False)
PY"
```

After creating a watcher, report:

- target pane/workspace;
- trigger pane/workspace;
- watcher pane/workspace;
- why the trigger is the correct dependency;
- prompt mode, session/tree plan, and edit/source-control permissions;
- whether approval is required before edits;
- a short summary of the prompt.

If any of those cannot be stated clearly, do not queue the watcher.
Ask instead.

## Implementation delegation

Before delegating implementation:

1. Identify the owning task, plan, workspace, pane, session/tree continuation plan, cwd, and revision.
2. Confirm whether the user authorized a new Herdr/jj workspace if isolation is needed.
3. Confirm whether the user required same-session/tree continuity; if yes, use that exact session/tree or ask before spawning anything.
4. For plan-based parallel work, decide whether each child is fresh or an approved plan-session fork before spawning.
5. Start a fresh pane/session only when the session plan explicitly allows fresh context, and only inside the chosen workspace unless explicitly told otherwise.
6. Give the agent one seam/work packet, not the whole project or an underspecified package.
7. Include the sibling map, expected seam outputs/inputs, final integration path, expected files/artifacts, and validation commands when known.
8. Ask the agent to stop for product/design ambiguity, missing sibling seams, scope/session mismatch, or unexpected schema/webhook/source-control needs.

Do not start multiple agents editing the same workspace unless the user explicitly asks.

## Investigation delegation

Investigating agents must produce durable output themselves.
Do not silently absorb a long investigation and later reconstruct it from memory.

When dispatching investigation, ask for an explicit artifact such as:

- a plan update;
- a handoff note;
- an overview in the vault;
- a repo-local `WORK.md` or findings file, if that is the existing workflow;
- a concise final summary with exact file refs and decisions.

Prompt shape:

```text
Investigate <question> in <cwd>.
Write the durable findings to <artifact path or requested vault location>.
Include: decisions, constraints, file refs, commands run, unresolved questions, and recommended next phase.
Do not rely on the manager to reconstruct your findings later.
```

If no artifact location is obvious, ask the user or delegate to the appropriate overview/plan skill.

## Review and code-quality delegation

Run review and code-quality work in a clean side pane, not in the implementation pane, unless the user explicitly asks otherwise.

Before dispatching:

1. Identify implementation workspace/tab/pane/session/tree plan/cwd/revision.
2. Re-read live Herdr state; do not use stale ids.
3. Verify `jj status` and current revision in the implementation cwd.
4. Split a side pane in the same Herdr workspace.
5. Start Pi in the same filesystem/jj workspace.
6. Prompt the reviewer with only the target revision, relevant plan/PR, and review objective.

If the implementation pane is `working`, queue the review after the implementation pane reaches `done`.
The watcher must live in the implementation workspace unless explicitly requested otherwise.

For PR review comments, use the PR review-comments skill in a clean side pane.
For strict self-review/refactoring audits, use the code-quality skill in a clean side pane.

After parallel implementation, prefer one serial reconciliation or code-quality cleanup agent when interface/design cleanup is cross-cutting.
Multiple parallel review agents are only useful for independent surfaces; they can miss duplicated abstractions and incompatible seams.
Fork that cleanup agent from the final serial integration agent only when Jorge approved forking and context is manageable; otherwise start fresh with the plan path, merged work summary, and changed-surface scope.

## Bookkeeping and focus/task updates

For task files, focus notes, reminders, prompt drafting, handoffs, or vault cleanup, delegate to the appropriate bookkeeping skill/agent instead of mixing that work into an implementation pane.

Use the matching skill when applicable:

- reminders or task creation: `remind-me`
- task/focus triage: `triage-inbox`
- PR-aware work triage: `work-pr-triage`
- prompt drafting: `draft-prompt`
- handoff/overview docs: `dump-overview` or `dump-overview-to-plan`
- doc migration: `migrate-doc`

Give the bookkeeping agent a precise summary and desired file updates.
Do not make it infer state from other agents.
Do not mark tasks complete or rewrite focus files unless the user asked for that.

## Continuation, tree, handoff, compact, or fresh context

Before assigning a new task to an existing agent, inspect the pane's current workstream, session id/path, context usage, cwd, and revision.
Compare the new task to the current thread.

If the user asks for “that agent,” “same agent,” “from this point in the session tree,” “use `/tree`,” or future use of a Pi tree, that is a session-continuation requirement.
Map the exact session/tree continuation plan before changing workspaces, rebasing, splitting panes, spawning Pi, or sending prompts.
If the desired `/tree` or continuation mechanics cannot be performed safely by the coordinator, ask Jorge how to proceed before spawning anything.

Preferred recovery order when the user has not required a specific session/tree:

1. `/tree` when a suitable earlier point exists.
2. `/handoff` when the task is a new workstream but prior summary is useful.
3. `/compact` when the current objective is still correct and only context pressure is the issue.
4. An approved fork from a finalized plan/session when the plan architecture is important and context is manageable.
5. A fresh side pane/session with the plan path and concise context when old context is not useful, not approved for forking, overloaded, or would be harmful.

For any of these, provide an explicit summary/context prompt and state whether the task is continuing the existing session/tree or starting fresh.
Do not expect the agent to infer the preservation boundary.
Do not use a new Herdr/jj workspace as justification for losing Pi session continuity.

Treat context levels as:

- under 50%: generally usable;
- over 50%: danger zone; report it and avoid adding large context casually;
- over 70%: effectively unsuitable for meaningful new work; prefer recovery or a fresh context.

## Concrete anti-pattern: wrong workspace watcher

Failure case to avoid:

- Intended target: review-feedback cleanup in workspace `remediation review feedback webhooks`, pane `wE:p3`.
- Mistake: watcher was created by splitting `wF:p3`, in unrelated workspace `remediation pr check reporting`.
- Mistake: watcher waited on actions/check implementor `wF:p3` before sending a review-feedback cleanup task.
- Mistake: prompt mentioned check/status work as a negative constraint, polluting the review-feedback context.

Correct behavior:

- Re-inventory live Herdr state first.
- Map the review-feedback task to `wE` workspace, tab, pane, session/tree plan, cwd, and revision.
- Create any watcher by splitting a pane in `wE`, preferably the target pane `wE:p3`.
- Trigger on the actual review-feedback dependency.
- If "first set of changes" is ambiguous, ask what pane/change set is the dependency.
- Prompt with positive review-feedback cleanup scope only.
- Do not mention actions/check work unless the target agent already needs that fact.

## Reporting back

When reporting status to the user, be concise and operational:

- task/PR/phase;
- workspace/tab/pane/session/tree plan;
- cwd and current jj revision when relevant;
- current status (`working`, `done`, `blocked`, `idle`, etc.);
- context usage if high or relevant;
- whether you continued the same session/tree, tree-jumped, compacted, handed off, started fresh, or queued after `done`;
- exact trigger/target/watcher mapping for queued follow-ups;
- what context was passed;
- what needs user clarification;
- next action already queued or recommended.

If an agent asks for clarification, do not guess unless the decision is clearly mechanical and reversible.
Surface the question to the user.
