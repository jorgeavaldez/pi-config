---
name: herdr-manager
description: Coordinate Herdr panes and Pi agents safely by mapping tasks to exact workspaces, panes, sessions, cwd, and revisions; routing work; and queueing local follow-ups without cross-workspace confusion.
---

# Herdr Manager

Use this skill when coordinating other Herdr panes and Pi agents.

Ownership is strict:

- `herdr` owns command mechanics.
- `herdr-manager` owns routing, workspace/pane mapping, session continuity, and watcher safety.
- `agent-prompt-drafting` owns task sizing, prompt wording, modes, permissions, approval gates, and expected output.

Load `herdr` before controlling panes. Load `agent-prompt-drafting` before writing or sending agent instructions.

## Environment

Verify `HERDR_ENV=1` before acting. If it is not, stop.
Keep the current pane as coordinator unless the user says otherwise. Do not perform implementation, investigation, or review-fix work in the coordinator pane.

## Inventory and map live state

Before every orchestration action, read current state:

```bash
herdr workspace list
herdr pane list
herdr tab list --workspace <workspace-id>
```

Map each task to:

```text
task -> workspace -> tab -> pane -> session/tree -> cwd -> revision
```

Use `herdr pane read <pane> --source recent-unwrapped --lines 80` only when needed to confirm the workstream, session, or context usage.
For repository work, verify the target cwd and revision with read-only `jj` commands.

Herdr state is concurrent and user-controlled; expect workspaces, tabs, panes, focus, and agent status to change between commands.
Immediately before each action, reread and actually verify the target's current workspace, tab, pane, session, cwd, revision, and status as applicable.
Do not batch an inventory command with a hard-coded action or treat a successful listing as verification without checking its result.
If the target changed or disappeared, stop and resolve the live mapping again.

Never rely on remembered pane IDs, tab numbers, status, cwd, or revisions.
If multiple live targets fit the user's reference, name them and ask.

## Routing rules

- Treat a workspace as task-owned, not merely repository-owned. Never route a new unrelated task into an existing workspace because it uses the same repository or has an idle agent.
- Reuse a workspace only for the same workstream or when the user explicitly requests that exact reuse; otherwise obtain permission for a fresh isolated workspace.
- Do not create Herdr or jj workspaces, worktrees, branches, bookmarks, or clones without explicit permission.
- Do not start multiple agents editing the same filesystem workspace unless explicitly asked.
- Route review work to a clean tab in the workspace that owns the work. Split investigation or follow-up panes beside the pane that owns the work.
- Keep bookkeeping in the appropriate vault/bookkeeping context.
- Never send a prompt to a `working` agent unless the user explicitly asks to interrupt.
- Confirm the target is idle and clear staged input before sending; never append to existing input.

Workspace isolation and Pi session continuity are separate. A new workspace does not authorize a fresh Pi session when the user requested the same session or tree.

## Session continuity

Treat “that agent,” “same agent,” “continue from here,” and `/tree` references as exact routing requirements.
Use the requested session/tree when it can be identified safely. Do not replace it with copied context in a fresh session.

When the user did not require a specific continuation, choose the smallest safe recovery:

1. `/tree` to a suitable point;
2. `/compact` when the objective is unchanged;
3. an approved fork from a finalized plan session;
4. a fresh session with the plan path and concise task-local context.

Avoid assigning substantial new work to a session above 50% context. Above 70%, prefer recovery or fresh context.

## Delegation

Before delegating:

1. Confirm the user authorized dispatch now. Future intent, prioritization, or discussion of what to delegate next is not immediate dispatch authorization.
2. Confirm the task owner, plan or PR anchor, task-owned workspace, pane, session plan, cwd, and revision.
3. Confirm any requested workspace creation, reuse, or source-control operation is authorized.
4. For parallel work, confirm the seams are independent and identify the integration owner and order.
5. Load `agent-prompt-drafting` and give it the routing facts.
6. Revalidate the live target, confirm it is idle with a clean input box, then send the prompt.

For plan-based parallel work, pass only the shared plan anchor, sibling seam map, this agent's owned seam, required inputs, and integration owner. Do not duplicate prompt policy or sibling history here.

If a child reports required work outside its seam, surface the rescope question. Do not convert the discovery into another assignment automatically.

## Watchers and queued follow-ups

Queue a follow-up only when all of these are known:

- target pane and task;
- trigger pane and actual dependency;
- target and trigger workspace relationship;
- target session/tree plan;
- self-contained prompt produced with `agent-prompt-drafting`.

Create the watcher in the target task's workspace, preferably by splitting the target pane. Cross-workspace watchers require explicit user approval.
Wait for the real dependency, not a nearby workstream. Re-check live state before delivery and do not deliver into a working agent.

After queueing, report the target, trigger, watcher, dependency, and session plan. Close temporary watcher panes after delivery or failure reporting.

## Review and integration routing

Run review and code-quality work in a clean tab in the implementation workspace. If implementation is still running, queue review after the implementation pane reaches `done`.

After parallel implementation, use one serial reconciliation review when the seams share interfaces or design. Use parallel reviewers only for genuinely independent surfaces.

## Reporting

Report only operational routing state:

- task or phase;
- workspace, pane, session/tree, cwd, and revision when relevant;
- current agent status and material context pressure;
- continuation or recovery choice;
- watcher trigger/target mapping;
- blockers or user decisions needed;
- next queued or recommended routing action.

Do not guess when an agent raises a product, scope, or session ambiguity. Surface it to the user.
