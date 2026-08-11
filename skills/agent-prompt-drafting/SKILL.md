---
name: agent-prompt-drafting
description: Draft explicit, context-bounded prompts for other AI agents. Use whenever instructing, spawning, delegating to, queueing work for, following up with, or messaging another agent, especially through Herdr. Requires clear mode, permissions, routing, approval gates, and task sizing so agents can finish without compaction.
---

# Agent Prompt Drafting

Use this skill every time you write instructions for another AI agent.
This includes Herdr panes, Pi agents, review agents, implementation agents, watcher-delivered follow-ups, and queued prompts.

For Herdr coordination, use this skill with `herdr-manager`.
Herdr manager owns routing and live pane safety.
This skill owns task sizing and prompt wording.

## Primary goal: finish without compaction

Treat context-window pressure as a correctness risk.
A prompt is not successful if it causes the recipient to compact, lose requirements, or stop early.

Default to one bounded task packet that the agent can complete in one context window.
Keep the task inline and self-contained, but do not reproduce context the agent can discover from the repository.

A short prompt is not an underspecified prompt.
State the outcome, relevant issues, constraints, and stop condition, then trust the agent to choose the mechanics.

## Task-sizing gate

Before drafting or sending a technical prompt, assess whether it is likely to fit comfortably in one context window.

Warning signs include:

- more than three independent issue clusters;
- changes spanning several architectural layers or languages;
- review, implementation, and exhaustive verification bundled together;
- a long list of exact changes such as “change X to Y, rewrite Z, migrate A, and retest B”;
- whole-diff audits plus fixes;
- large behavior matrices or many test suites;
- migrations, schemas, workflows, provider integrations, or failure recovery combined in one task;
- an existing recipient already near or past 50% context usage.

When these signs appear, **do not draft or send the full prompt yet**.
First propose a small batch sequence to Jorge and wait for approval.

An implementation phase may contain at most two batches. Each batch must fit one session and produce an independently reviewable, mergeable change. If a third batch is needed, redesign the phase instead of extending the sequence.

Choose batches based on dependencies, for example:

1. implement one related correctness seam with focused tests;
2. implement the next independent seam with focused tests.

Tests-first is a suggestion, not a fixed rule.
Use it when characterization reduces implementation risk.
Combine tests with implementation when they are small and inseparable.

The batching proposal should be short:

```text
This phase is too large. Suggested redesign:
1. <bounded, mergeable outcome>
2. <bounded, mergeable outcome>

Want me to send batch 1 first?
```

After approval, draft or send one batch at a time unless Jorge explicitly asks to queue multiple batches.
If the task cannot be made safely concise without losing requirements, split it rather than expanding the prompt.

## Do not prescribe broad-task procedure

For broad objectives such as review, investigation, or planning, do not dictate an exhaustive step-by-step process.
The receiving agent is responsible for choosing how to inspect, search, reason, and validate.

For example, prefer:

```text
Review the current working-copy diff for correctness, focusing on dispatch recovery and outcome consistency.
Report actionable findings with file references and a verdict.
```

Do not expand that into instructions to read every file, enumerate every helper, run a long command matrix, trace every branch, and produce multiple inventories unless Jorge specifically requests those artifacts.

For precise implementation tasks, describe each issue and the required invariant.
Avoid prescribing exact internal mechanics unless the mechanism itself is a user-approved requirement.

## Minimal context rules

Include only context the recipient cannot reliably infer:

- the task and business outcome;
- the exact workspace, cwd, revision, pane, and session/tree plan when relevant;
- one plan, PR, ticket, or artifact anchor when useful;
- the issue descriptions or decisions that must cross agent boundaries;
- mode, edit permissions, source-control permissions, and approval gate;
- the expected artifact or concise completion report.

Keep business context to one to three short bullets.
Default to roughly 150–350 words for a single task packet.
Exceed that only when the exact issue list itself requires it and the task still fits one context.

Omit by default:

- review procedures and generic coding workflows;
- exhaustive test/check command lists;
- full prior-agent transcripts or chronological history;
- repeated repository instructions already available to the agent;
- detailed changed-surface inventories the agent can derive;
- speculative edge cases unrelated to the named issue;
- unrelated sibling work, even as negative scope;
- repeated explanations of the same invariant;
- mandatory report sections that do not affect the decision.

Pass findings, not the investigation that produced them.
Prefer exact file paths and a short issue description over copied review prose.

## Mandatory prompt fields

Every delegated prompt must still make these points explicit, usually in one line each:

- **Target:** workspace/cwd/revision and session plan when relevant.
- **Mode:** planning, investigation, review, implementation, or bookkeeping.
- **Edits:** allowed scope, or “do not modify files.”
- **Source control:** whether mutations are allowed.
- **Task:** one bounded objective or approved batch.
- **Output:** the artifact or concise report expected.
- **Stop condition:** approval gate or concrete ambiguity that should stop work.

If Jorge says “that agent,” “same agent,” “continue from here,” “use `/tree`,” or similar, target the exact session/tree.
Do not substitute a fresh session with copied context.
If Jorge explicitly requests `/new` or a fresh sibling, say that the new session is intentional.

Before submitting to an existing Pi pane, confirm it is not working and clear any staged input.
Never append a prompt to existing input.

## Drafting workflow

1. Resolve the target workspace, pane, cwd, revision, and session plan.
2. Choose the mode and edit/source-control permissions.
3. Apply the task-sizing gate.
4. If batching is needed, propose batches and stop for approval.
5. Draft only the current bounded task.
6. Run a compression pass:
   - remove procedural instructions the agent can choose itself;
   - remove context available in the repo;
   - remove duplicated constraints and report sections;
   - replace copied history with direct issue descriptions;
   - confirm the task can finish without compaction.
7. Clear the target input and submit.

## Mode wording

### Planning

```text
Mode: PLANNING ONLY.
Do not modify files or source-control state.
Produce a concise implementation plan covering the key decisions, likely files, focused validation, and real open questions.
Stop for Jorge’s approval before implementation.
```

Do not request a “full detailed plan” by default.
The plan should be detailed enough to implement the bounded task, not an exhaustive architecture document.

### Investigation

```text
Mode: INVESTIGATION ONLY.
Do not modify files or source-control state.
Answer <specific question> and report the evidence, conclusion, and remaining uncertainty concisely.
```

Ask for a durable artifact only when another agent or future session genuinely needs it.

### Review

```text
Mode: REVIEW ONLY.
Do not modify files or source-control state.
Review <bounded scope> for <named concerns>.
Report actionable findings with file references and a verdict.
```

Do not give the reviewer a review procedure.
Do not combine a broad review with implementation in the same prompt.
If fixes are likely, review first and send a separate implementation batch after findings are approved.

### Implementation

```text
Mode: IMPLEMENTATION.
Allowed scope: <one approved seam or batch>.
Do not mutate source-control state or push unless explicitly authorized.
Implement the required behavior and focused tests.
Fix required discoveries that fit this seam. Report evidenced systemic issues outside it with their impact, evidence, and recommended remediation.
Report changed files, checks run, and blockers concisely.
Stop if required work exceeds this seam, would leave an incomplete fix, would entrench the systemic issue, or requires an unapproved schema/session/source-control change.
```

Expected files may be listed as orientation, not as a rigid cage.
Allow nearby code and tests when they are the simplest correct implementation of the named seam.

### Bookkeeping

```text
Mode: BOOKKEEPING.
Allowed edits: <specific notes/task files>.
Apply <specific update> and report the files changed.
Do not alter code or source-control state.
```

## Technical issue prompts

Describe technical findings in this compact shape:

```text
Issue: <what is wrong and where>.
Impact: <why it matters>.
Required invariant: <what must be true afterward>.
```

Usually omit the proposed algorithm.
Include it only when Jorge approved that design or interoperability requires that exact mechanism.

If several issues share one control-flow seam, they may form one batch.
If they require independent designs or validation paths, split them.

## Plan-based parallel work

Parallel prompts still need a shared plan anchor and seam ownership, but keep sibling context minimal:

```text
Plan: <path and section>.
You own: <seam and output>.
Sibling dependency: <only the input/output this task directly touches>.
Integration owner: <pane or later batch>.
```

Do not include every sibling’s history or responsibilities.
If a missing sibling seam blocks the task, tell the agent to stop and report rather than inventing a temporary architecture.

## Follow-ups and watchers

A queued prompt must be safe and understandable when delivered later.
Begin with:

```text
Follow-up after the previous task completes.
Mode: <mode>.
```

Include the bounded task, permissions, session plan, and stop condition in the queued prompt itself.
Do not rely on watcher shell comments or manager memory.

Do not queue a large second phase merely because the first phase is still running.
Wait for the first result when it could change the next batch.

## Source-control wording

Default no-mutation wording:

```text
Do not run source-control mutation commands or push. Read-only inspection is allowed.
```

When isolated mutation is explicitly authorized, state the exact operation and workspace.
Do not mix mutation permission with a contradictory prohibition.

## Anti-patterns

Do not send prompts that:

- bundle review, fixes, exhaustive tests, and final audit;
- prescribe a long review or investigation procedure;
- paste the prior agent’s full output when a short issue list suffices;
- ask for multiple inventories, matrices, retrospectives, and plans in one response;
- contain every possible validation command “just in case”;
- use “full detailed,” “comprehensive,” or “exhaustive” without a user-requested reason;
- enumerate many independent technical changes without first offering batches;
- give a high-context agent another broad task instead of starting fresh;
- say “fix it,” “revise,” or “continue” without mode and edit permissions;
- replace required same-session continuity with copied context;
- introduce unrelated topics through negative constraints.

## Pre-send checklist

Before sending, answer yes:

- Can this task reasonably finish in one context window without compaction?
- If it is broad or highly technical, did I offer a batch plan first?
- Is this prompt only for the current approved batch?
- Does its phase contain at most two implementation batches?
- Did I state target, mode, edit permissions, source-control permissions, task, output, and stop condition?
- Did I avoid dictating procedure for a broad review/investigation?
- Did I pass concise findings instead of history and transcripts?
- Did I remove context the agent can derive from the repo?
- Is the business context short and decision-relevant?
- Is the session/tree plan explicit?
- Is the target agent idle with a clean input box?

If the first answer is no, do not send the prompt.
Split the task or start a fresh agent with a smaller batch.
