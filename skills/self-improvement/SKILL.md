---
name: self-improvement
description: Explicit-invocation-only retrospective and configuration-improvement exercise. Never invoke automatically. After a task is complete, or after addressing user dissatisfaction about overreach, wasted effort, or poor judgment, you may offer this exercise once and must wait for explicit confirmation.
---

# Self-Improvement

This is an explicit-invocation-only exercise. Never start it because a task merely resembles a past mistake.

You may offer it once:

- after completing the current task; or
- after first addressing a reprimand or a question that indicates annoyance about judgment, overreach, wasted time, or wasted tokens.

Use a short offer and wait for explicit confirmation. Do not interrupt necessary corrective work. A direct user request to run this skill is confirmation.

## Purpose

Review the relevant session evidence, identify what went wrong and why, and improve the agent configuration so the same class of failure is less likely to recur.

The result must improve the overall policy, prompting, review, and orchestration system—not preserve incident-specific history in reusable configuration.

## Boundaries

Inspect and modify only agent configuration discovered from the current runtime:

- global and project instruction or context resources;
- system-prompt additions;
- prompts and templates;
- skills and their bundled references or scripts;
- extensions and related configuration.

Do not assume absolute paths, usernames, repository names, ticket identifiers, or a machine-specific layout. Discover resource locations from runtime metadata, official documentation, loaded context, and the current working directory.

Do not modify:

- application or product source code;
- generated or managed files;
- dependencies or installed package contents;
- credentials, secrets, session archives, or model/provider settings;
- historical task artifacts merely to record the retrospective.

Session records are evidence, not configuration outputs. Redact sensitive values from reports.

## Ownership gate

Classify each discovered resource as:

- personal and editable;
- shared or team-owned;
- generated, managed, or externally owned;
- unknown.

Use repository purpose, ownership instructions, source-control metadata, package origin, and surrounding documentation as evidence. Do not infer personal ownership from filesystem location alone.

Personal global and local configuration may be proposed for editing. Shared or team-owned changes are optional: present them separately and obtain explicit approval before editing. Treat unknown ownership as shared until clarified.

Never perform source-control mutations unless separately requested.

## 1. Reconstruct the event

Use the current session by default. If the user identifies another session, locate it through runtime session metadata or the documented session interface; do not guess paths.

Review the complete relevant sequence, including:

- the original request and constraints;
- the agent's response, plan, and actions;
- tool calls and results;
- user corrections or signs of dissatisfaction;
- the eventual correction and outcome;
- available summaries needed to recover earlier context.

Use user-visible transcript and recorded actions as evidence. Do not claim access to hidden reasoning. Distinguish facts from inference.

Summarize:

1. expected behavior;
2. actual behavior;
3. impact, including scope, time, tokens, risk, or user effort;
4. the correction that worked.

Do not turn the report into a transcript or apology essay.

## 2. Find the cause

Trace the failure through three layers:

### Judgment

Identify the mistaken decision or heuristic. Examples include confusing broad inspection with broad remediation, treating discovery as authorization, delegating unresolved decisions, or adding enforcement instead of fixing ownership.

### Configuration

Identify which current instructions, prompts, skills, or extensions encouraged, permitted, contradicted, duplicated, or failed to prevent that decision.

### Orchestration

Identify whether task sizing, delegation, workspace routing, review disposition, approval gates, or follow-up handling contributed.

State the causal chain. Do not stop at “the agent should be more careful.”

## 3. Audit the configuration

Discover relevant global and local resources by behavior and responsibility, not by a predetermined filename list.

Audit broadly enough to find:

- the canonical policy owner;
- direct contradictions or bypasses;
- duplicated or stale policy;
- prompt entry points that omit necessary context;
- review or delegation workflows that can recreate the failure;
- local overrides that weaken global behavior.

Read every relevant file in full before judging or editing it, even if it was read earlier in the session. For a skill, also inspect its frontmatter, bundled references, scripts, callers, and adjacent skills when they affect its purpose.

Use read-only delegation when the surface is large. Divide audits by independent configuration boundary or behavior path. The coordinating agent owns synthesis, scope, decisions, and the final plan. Do not let multiple agents edit the same resources, and do not turn a child finding into authorized work automatically.

Use available planning, prompt-drafting, code-quality, and orchestration skills when their descriptions match the work. Discover them at runtime rather than assuming a fixed set.

## 4. Design the smallest complete correction

For every candidate change, decide whether to:

- keep;
- refactor;
- merge or consolidate;
- rewrite;
- delete;
- leave unchanged;
- report as follow-up.

Prefer one canonical owner. Change another resource only when it directly contradicts or bypasses that owner, or when its self-contained output must carry the rule into a context that cannot see the canonical policy.

Do not default to additive guardrails. Refactoring stale or crusty configuration is encouraged when it is the smallest complete correction. Deletion and consolidation are valid; so is a complete rewrite.

Before rewriting any existing skill or prompt:

1. reread the complete current resource;
2. state its core purpose and durable truths;
3. identify useful side context and specificity that must survive;
4. preserve those fundamentals in the new structure;
5. remove only duplication, contradiction, obsolete procedure, or accidental complexity.

Do not make a resource generic enough that it loses its original intent. Do not preserve bad structure merely because it already exists.

Keep incident details out of reusable policy. Generalize only lessons supported by evidence.

Classify the result:

- **Current correction:** required to prevent the demonstrated failure through the approved configuration seam.
- **Approval required:** shared, team-owned, ownership-unknown, or newly expanded work.
- **Follow-up:** evidenced systemic improvement that is not required for the current correction.
- **No change:** already governed by the canonical owner or unrelated.

A follow-up must include impact, evidence, and recommended remediation. If a local patch would be incomplete, unsafe, or entrench the systemic issue, stop and ask to rescope.

## 5. Present the retrospective and plan

Before editing, unless the user explicitly requested both analysis and remediation, present:

```markdown
## Self-Improvement Review

### What happened
- Expected:
- Actual:
- Impact:
- Effective correction:

### Root cause
- Judgment:
- Configuration:
- Orchestration:

### Proposed correction
| Resource responsibility | Ownership | Evidence | Decision | Change |
| --- | --- | --- | --- | --- |

### Follow-ups
- <impact, evidence, recommended remediation, or none>

### Approval needed
- <shared/unknown resources or scope questions, or none>
```

Keep it concise and evidence-based. Do not inventory irrelevant files.

If the user requested reflection only, stop here. If remediation was not explicitly authorized, wait for approval. Shared or ownership-unknown resources always require explicit approval.

## 6. Implement as manager

After approval:

1. Apply the smallest complete correction to personal configuration.
2. Use no more than two implementation batches in a phase; redesign larger work.
3. Delegate only independent, bounded seams with non-overlapping ownership.
4. Retain responsibility for reconciliation and integration.
5. Re-read every modified file in full after editing.
6. Search again for the demonstrated class of contradiction, duplication, or bypass.
7. Confirm that each changed resource still fulfills its original purpose.

Do not edit an optional shared resource merely because another agent recommends it.

## 7. Validate and report

Run validation appropriate to the resources changed, such as:

- skill discovery and frontmatter validation;
- extension formatting, lint, typecheck, and focused tests;
- prompt and instruction consistency searches;
- broken-reference and portability checks;
- source-control diff and scope review.

Verify that reusable configuration contains no machine-specific paths, personal identifiers, incident identifiers, secrets, or accidental private context.

Report:

- the reusable lesson;
- resources changed and why;
- refactors, deletions, and preserved fundamentals;
- validation completed;
- shared changes not made;
- remaining systemic follow-ups.

Do not claim that configuration guarantees perfect future behavior. State the concrete failure mode it now addresses.
