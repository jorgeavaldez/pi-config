---
name: agent-prompt-drafting
description: Draft explicit prompts for other AI agents. Use every time the user asks you to instruct, prompt, start, spawn, delegate to, queue work for, follow up with, or message another agent, especially with Herdr manager. Ensures planning-vs-implementation mode, approval gates, context boundaries, trigger conditions, and expected artifacts are explicit before sending.
---

# Agent Prompt Drafting

Use this skill every time you write instructions for another AI agent.
This includes Herdr panes, Pi agents, Claude/Codex agents, review agents, planning agents, implementation agents, watcher-delivered follow-ups, and queued prompts.

This skill is mandatory even when another skill also applies.
For Herdr coordination, use this skill together with `herdr-manager`.
Herdr manager maps panes/workspaces/triggers; this skill drafts the actual agent prompt.

## Core rule

Never rely on implication.
Agent prompts must explicitly say:

- whether the agent is in planning, investigation, implementation, review, or bookkeeping mode;
- whether file edits are allowed;
- whether source-control mutation is allowed;
- whether the agent must stop for approval before edits;
- what context matters and what artifact/output is expected;
- how much detail is required in the plan or report;
- what exact workspace/revision/pane/session/tree continuation the task belongs to when known;
- that the sender must clear any existing staged input in the target Pi pane before submitting the prompt;
- for plan-based parallel work, what shared plan anchors the work and how this agent's seam fits sibling workstreams.

If the user asks for planning, investigation, review, or a proposal, the prompt must say **planning only** and **do not modify files** unless the user explicitly authorized edits.

If the user says “that agent,” “same agent,” “continue from here,” “from this point in the session tree,” “use `/tree`,” or similar, treat that as a routing requirement, not just context to copy. The prompt must target the exact existing Pi session/tree or stop for clarification; do not replace session continuity by pasting context into a fresh session.

## Prompt drafting workflow

Before sending a prompt to another agent:

1. Identify the task mode:
   - planning / plan revision;
   - investigation / research;
   - implementation;
   - code review / quality audit;
   - follow-up after completion;
   - bookkeeping / vault update.
2. Identify the target:
   - workspace, pane, session, cwd, and revision when using Herdr;
   - whether the task must continue an existing Pi session/tree, fork from a plan session with approval, or use a fresh session;
   - repo path and PR/plan/doc references;
   - current agent status if sending to an existing agent.
3. If the work is plan-based parallel delegation, identify the shared plan anchor, sibling workstream map, expected seams, and final integration path before drafting child prompts.
4. Decide whether approval is required before edits.
   - Default for planning/revision prompts: approval required.
   - Default for implementation prompts: edits allowed only for the named scope.
5. Draft the prompt with explicit mode, allowed edits/scope, task, expected output, and stop conditions.
6. Re-read the prompt before sending and check for verbs that accidentally authorize edits.
7. Immediately before sending to an existing Pi pane, clear the target input box first. Never append a new prompt onto staged text already sitting in the input.

Do not send prompts with ambiguous verbs like “revise”, “fix”, “clean up”, “update”, “take into account”, or “incorporate” unless the prompt also explicitly says whether that means planning-only or code edits.

## Mode language

### Planning-only prompt language

Use this whenever the user wants a plan, proposal, investigation, comparison, design revision, or approval gate.

Required language:

```text
Mode: PLANNING ONLY.
Do not modify files.
Do not run source-control mutation commands.
Do not implement the changes yet.
Produce a full detailed plan first and stop for Jorge's approval before making edits.
```

For plan revisions, be even more explicit:

```text
This is a plan revision, not implementation.
Revise the plan in detail, but do not revise code, migrations, schemas, or source-control revisions yet.
Stop after the revised plan.
```

Required plan detail checklist:

- decisions and reasoning;
- exact files that would change after approval;
- exact data model/API/control-flow shape when applicable;
- migration/revision strategy when applicable;
- validation commands;
- risks and open questions;
- what is intentionally out of scope.

### Investigation/research prompt language

Use this for discovery tasks.

```text
Mode: INVESTIGATION ONLY.
Do not modify files.
Use web search where current provider/API documentation matters.
Write durable findings in the final response or requested artifact.
Include source links, repo file references, decisions, risks, and recommended next steps.
```

If web research is required, say so directly:

```text
You have web search access. Use websearch/webfetch for current external docs before making recommendations.
Do not rely on memory for provider/API behavior.
```

### Implementation prompt language

Use this only when edits are authorized.

```text
Mode: IMPLEMENTATION.
Allowed scope is the workstream/area described below.
Expected files/areas are orientation, not a rigid cage, unless Jorge explicitly requested a hard allowlist.
Agents may touch nearby code/tests when that is the simplest correct design for the named seam.
Stop if the work requires taking over sibling responsibilities, changing schema/webhooks/source-control/session plans without authorization, or if the session/tree target is not available.
Do not push, commit, bookmark, merge, or mutate remote/source-control state unless explicitly asked.
Report changed files, checks run, and remaining blockers.
```

Lead with the allowed scope, expected areas, and the stop condition:

```text
Allowed scope:
- <workstream/seam/output this agent owns>

Expected areas, as orientation:
- <file or directory likely involved>
- <tests likely involved>

Stop condition:
- Stop and report before leaving the scope, taking over sibling work, or changing the session/tree/workspace plan.
```

Use negative scoping sparingly.
Only include “do not edit X” when X is an obvious adjacent risk already in the agent's context or an exclusion the user explicitly requested.
Do not list speculative future phases merely to say they are out of scope.

### Follow-up prompt language

For follow-ups to an existing agent, first preserve mode and routing.
Do not assume a completed planning agent should now implement.
Do not turn “same agent” or “that agent” into a fresh session with copied context; target the existing session/tree or ask how to continue it.

Good:

```text
Follow-up in PLANNING ONLY mode.
Use the findings below to produce a revised detailed plan.
Do not modify files or source-control state.
Stop for approval after the revised plan.
```

Bad:

```text
Revise the schema split to include this feedback.
```

That is ambiguous and can be interpreted as edit authorization.

## Plan-based parallel child prompts

Use this pattern when splitting implementation across agents from a shared plan.
Do not hand each agent a vague package name and a hard file cage.
Give each agent an explicit seam and enough sibling context to avoid duplication.

Required elements:

- Plan anchor: exact plan path and relevant section(s) as the shared source of truth.
- Context/session decision: fresh session by default; fork from a finalized plan/session only when Jorge asked or approved and the context is not overloaded.
- Sibling map: each sibling's responsibility, this agent's responsibility, the seam/output this agent produces, the seam/input it expects, and who will integrate the results.
- Scope boundaries: expected files/areas as orientation; nearby code/tests are allowed when they are the simplest correct design; stop before schema/webhook/source-control/session-plan changes or sibling ownership.
- Business reason: why this work exists and what final user/product path consumes it.
- Missing seam behavior: if a sibling seam is absent, leave a narrow integration note or stop/report instead of inventing temporary lifecycle behavior.
- Code-quality constraints: smallest direct implementation; no speculative abstraction; no new public helper/API unless consumed by a sibling seam now; tests verify behavior, not helper taxonomy; if a small seam becomes a subsystem, stop and explain why.

Reusable shape:

```text
You are implementing <workstream/seam> from <plan path>, especially <section>.
Session plan: <fresh session with plan path and concise context | forked from finalized plan session X with Jorge's approval because context is manageable>.

Sibling workstream map:
- <sibling A>: owns <responsibility>; produces <seam/output>.
- <sibling B>: owns <responsibility>; produces <seam/output>.
- You: own <responsibility>; produce <seam/output>; expect <input/seam> from <sibling>.
- Integration path: <serial integrator/workflow/test path that combines results>.

Mode: IMPLEMENTATION.
Allowed scope: <this agent's seam/workstream>.
Expected areas, as orientation: <likely files/tests>.
You may touch nearby code/tests when it is the simplest correct design for this seam.
Do not duplicate sibling responsibilities.
Stop before schema/webhook/source-control/session-plan changes or taking over sibling work.

Business context:
- <why this matters>
- <what final path consumes it>

Task:
1. <specific seam work>
2. <tests/validation>
3. <integration note if a sibling seam is missing>

Constraints:
- Smallest direct implementation.
- No speculative abstractions or public helper/API unless consumed by this seam or a sibling seam now.
- Tests should verify behavior, not helper taxonomy.
- If this grows into a subsystem, stop and explain why.

Expected output:
- Changed files and checks run.
- Seam produced and expected sibling inputs.
- Integration notes/blockers.
```

## Prompt template

```text
You are working in <cwd> on <task/PR/plan>.
Target context:
- Workspace/pane/session/tree: <ids and continuation point if relevant>
- Session plan: <continue exact session/tree | fresh session allowed | ask before spawning>
- Current revision/branch/bookmark: <revision if relevant>
- Relevant docs/PRs/comments: <short list>
- For plan-based parallel work: <plan anchor, sibling map, seam/output, expected inputs, integration path>

Mode: <PLANNING ONLY | INVESTIGATION ONLY | IMPLEMENTATION | REVIEW | BOOKKEEPING>.
<Explicit edit permissions with allowed scope/areas first, and source-control permissions.>
<Explicit approval gate if any.>

Business context:
- <why this work exists>
- <what correctness means for the product/user>

Task:
1. <specific instruction>
2. <specific instruction>
3. <specific instruction>

Expected output:
- <full detailed plan / changed files / findings / validation results>
- <risks/open questions>
- <stop condition>

Constraints:
- <source-control constraints>
- <workspace constraints>
- <scope boundaries>
```

## Business context requirements

Include business context when the task involves architecture, schema, product behavior, data modeling, workflow orchestration, security, or cross-provider abstractions.

Business context should answer:

- Who or what uses this?
- What decision will consume the output?
- What failure mode are we avoiding?
- What should be simple or future-proof?
- What is not the goal right now?

Example:

```text
Business context:
- Nebari opens remediation PRs for findings.
- This series makes those PRs self-healing.
- Webhooks capture provider check/status state, but a scheduled workflow later chooses only current actionable failures.
- The schema must avoid stale/superseded check output so the feedback agent does not revise a PR from old CI data.
- Keep the schema provider-neutral where possible; do not add GitHub-specific tables unless unavoidable.
```

## Approval gates

Use explicit approval gates for:

- plan revisions;
- schema/data model decisions;
- migrations;
- source-control restructuring;
- cross-provider abstractions;
- broad refactors;
- destructive cleanup;
- ambiguous user intent.

Required wording:

```text
Stop after the plan and wait for Jorge's approval before editing files or changing revisions.
```

If the user authorized implementation after approval, say:

```text
After approval, the next step will be implementation in a separate prompt.
```

## Source-control wording

Be precise.

For no source-control mutations:

```text
Do not run source-control mutation commands: no jj rebase/squash/split/edit/new/bookmark/commit/git push.
Read-only jj inspection is allowed with `--ignore-working-copy` if needed.
```

For isolated jj mutation allowed:

```text
It is OK to use jj mutation commands in this isolated workspace only for the requested split/rebase.
Do not push or create/update bookmarks.
Do not touch other workspaces.
Report the final stack shape.
```

Do not mix these two modes.

## Queue/watch prompts

When writing a prompt that will be delivered later by a watcher, the prompt itself must be safe if delivered at the trigger moment.

Every queued prompt must begin with:

```text
Follow-up after your previous task is complete.
Mode: <mode>.
```

If the follow-up should not start implementation, include:

```text
Do not modify files yet.
Produce the revised plan first and stop for approval.
```

Do not rely on the watcher trigger to convey intent.
The delivered prompt must be self-contained.

## Anti-patterns

Avoid these in agent prompts:

- “revise X” without saying planning-only or implementation;
- “take this into account” without an expected artifact;
- “clean up” without allowed files and validation;
- “fix it” without scope and stop conditions;
- “continue” without saying what context, session, and tree point to preserve;
- mentioning unrelated projects or speculative future phases as negative constraints;
- dumping long manager context instead of task-local facts;
- source-control permissions that conflict with each other;
- replacing same-session/tree continuity with a new session plus copied context;
- delegating broad packages instead of explicit seams and integration outputs;
- using rigid file allowlists for parallel work when scope boundaries would be safer;
- watcher prompts that depend on shell comments or manager memory.

## Pre-send checklist

Before sending, answer yes to all:

- Is the target Pi input box confirmed clean, or will it be cleared immediately before submitting?
- Is the mode explicit?
- Are edit permissions explicit?
- Is the approval gate explicit if this is planning/revision/design/schema work?
- Is source-control permission explicit and non-contradictory?
- Is the allowed edit scope stated before any negative constraints?
- Are negative constraints limited to adjacent risks already in context?
- Is the expected output detailed enough?
- Is the business context included when needed?
- For plan-based parallel work, is the plan anchor, sibling map, seam/output, expected inputs, and integration path explicit?
- Is the prompt self-contained for the receiving agent?
- If same-session/tree continuity or plan-session forking was requested/approved, does the prompt use that exact session/tree instead of a fresh session?
- Would an agent reading only this prompt know whether to edit or stop?
