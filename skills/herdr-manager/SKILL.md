---
name: herdr-manager
description: Coordinate local or explicitly named remote Herdr sessions safely by mapping tasks to exact hosts, workspaces, panes, Pi sessions, cwd, and revisions; routing work; and queueing task-local follow-ups without cross-workspace confusion.
---

# Herdr Manager

Use this skill when coordinating other Herdr panes and Pi agents.

Ownership is strict:

- `herdr` owns command mechanics.
- `herdr-manager` owns routing, workspace/pane mapping, session continuity, and watcher safety.
- `agent-prompt-drafting` owns task sizing, prompt wording, modes, permissions, approval gates, and expected output.

Load `herdr` before controlling panes. Load `agent-prompt-drafting` before writing or sending agent instructions.

## Environment and control route

Establish one route before acting:

- **Local:** require `HERDR_ENV=1` and keep the current pane as coordinator unless the user says otherwise.
- **Remote:** use only an explicitly requested SSH target and exact named Herdr session. Verify the session through the SSH transport defined by the `herdr` skill, then scope every session-specific command to it. The dispatching shell does not need `HERDR_ENV=1`.

If neither route is fully identified, ask whether Jorge wants to use a local Herdr-managed pane or which SSH target and named remote session to use. Do not flatly refuse, guess a target, use a default session, or require Jorge to pre-start a Pi agent in the remote Herdr.

Do not mix local and remote inventory or actions. Remote authorization is limited to the exact target and named session the user selected. Do not perform implementation, investigation, or review-fix work in the coordinator pane. This separation does not require a new agent for every workflow stage: route a bounded follow-up to one existing task owner whenever that is the smallest safe handoff.

## Inventory and map live state

At the start of an orchestration sequence, establish the selected route and map only the task-owned workspace:

```bash
herdr workspace list
herdr tab list --workspace <workspace-id>
herdr pane list --workspace <workspace-id>
```

In remote mode these are the inner commands executed over SSH with the exact named session; never run their unscoped local equivalents. Use an unscoped pane listing only when the target workspace cannot yet be identified or the authorized task genuinely spans workspaces. Do not stream unrelated workspace or pane state into the model context.

Map each task to:

```text
task -> control route -> SSH target (remote only) -> Herdr session -> workspace -> tab -> pane -> Pi session/tree -> cwd -> revision
```

Use `herdr pane read <pane> --source recent-unwrapped --lines 80` only when needed to confirm the workstream, session, or context usage. Read only enough lines to make the routing decision. For repository work, verify the target cwd and revision with read-only `jj` commands when the action depends on them.

Herdr state is concurrent and user-controlled; expect workspaces, tabs, panes, focus, and agent status to change between commands. Immediately before a control action, refresh the known target with the applicable exact commands (`workspace get`, `tab get`, `pane get`, and `agent get`); fall back to a workspace-scoped list when an exact lookup is unavailable or the mapping is ambiguous. Rerun the scoped topology lists after a topology change or when an ID, owner, or task mapping may have changed.

Do not batch a state refresh with a hard-coded action or treat a successful lookup as verification without checking its result. Parse newly created IDs from the creation response, then verify the new target before prompting or starting dependent work. If the target changed or disappeared, stop and resolve the live mapping again.

Never rely on remembered pane IDs, tab numbers, status, cwd, or revisions. If multiple live targets fit the user's reference, name them and ask.

## Routing rules

- Treat a workspace as task-owned, not merely repository-owned. Never route a new unrelated task into an existing workspace because it uses the same repository or has an idle agent.
- Reuse a workspace only for the same workstream or when the user explicitly requests that exact reuse; otherwise obtain permission for a fresh isolated workspace.
- Do not create Herdr or jj workspaces, worktrees, branches, bookmarks, or clones without explicit permission.
- Do not start multiple agents editing the same filesystem workspace unless explicitly asked.
- When a distinct review, investigation, or follow-up agent is justified, place it in the task-owning workspace and keep its ownership separate from the file editor.
- Keep bookkeeping in the appropriate vault/bookkeeping context.
- Never send a prompt to a `working` agent unless the user explicitly asks to interrupt.
- Confirm the target is idle and clear staged input before sending; never append to existing input.

### Proportional orchestration

Delegation is a real boundary, not a default phase transition, but minimizing agent count is not the goal. Keep one integration owner while using as many bounded task-local sessions as the work genuinely requires.

- Reuse an agent only for a small follow-up that fits its current role, permissions, and remaining context.
- Use fresh sessions for substantial new roles, independent investigation seams, implementation batches, or validation ownership rather than carrying accumulated context forward.
- For broad read-only discovery, split non-overlapping evidence questions across fresh sessions and synthesize centrally; do not make one nominal planner inspect every layer.
- Keep one file editor unless parallel editing was explicitly authorized. Read-only investigators may work alongside that editor when their seams are independent.
- Do not create tabs merely for phase symmetry, workflow ceremony, or visibility.

A skill's internal stages do not by themselves justify separate agents. Apply the global smallest-complete-outcome rule to each assignment, not to the number of sessions.

Workspace isolation and Pi session continuity are separate. A new workspace does not authorize a fresh Pi session when the user requested the same session or tree.

## Session continuity and context ownership

Treat “that agent,” “same agent,” “continue from here,” and `/tree` references as exact routing requirements. Use the requested session/tree when it can be identified safely; do not replace explicit continuity with copied context in a fresh session.

Otherwise, context budgeting is the manager's responsibility. Pi recipients do not control automatic compaction and cannot reliably self-police their live context usage. Never delegate that responsibility in a prompt.

- Estimate task size before dispatch and decompose work that could consume one session.
- Inspect available pane or session metadata before assigning a follow-up; never rely on the child to report its own percentage.
- Reuse a session only for a genuinely small continuation with ample context.
- Prefer a fresh session with a concise task-local handoff for a substantial new role, seam, batch, or validation pass.
- Use `/tree` when exact earlier-session continuity is necessary. Use `/compact` only when Jorge explicitly requests it or a fresh task-local handoff cannot preserve required continuity.

Do not assign substantial new work to a session near 50% context. Treat 70% as unavailable for further substantive work, not as a cue to compact and continue.

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

Create an independent review agent only when the user requests one or a concrete risk, ownership boundary, integration seam, or delivery gate justifies it. Implementation having occurred, or review comments having been addressed, is not by itself a reason for another review pass. A bounded follow-up that the task owner has inspected and validated should normally finish with one concise report.

When independent review is justified, run it in a clean tab in the implementation workspace. If implementation is still running, queue review after the implementation pane reaches `done`.

After parallel implementation, use one serial reconciliation review when the seams share interfaces or design. Use parallel reviewers only for genuinely independent surfaces.

## Reporting

Report only operational routing state:

- task or phase;
- control route, SSH target and named Herdr session when remote, workspace, pane, Pi session/tree, cwd, and revision when relevant;
- current agent status and material context pressure;
- continuation or recovery choice;
- watcher trigger/target mapping;
- blockers or user decisions needed;
- next queued or recommended routing action.

Do not include raw global inventories or long child transcripts in routine reports; summarize only the mapped target and material result. Do not guess when an agent raises a product, scope, or session ambiguity. Surface it to the user.
