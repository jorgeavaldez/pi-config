---
name: code-quality
description: Audit-first strict code quality review. Use before and after non-trivial code edits, when refactoring, when the user asks to revise/review/cleanup, or when user flags abstraction/type/API/code smell. Defaults to the current working-copy/current-revision diff; do not ask what to review unless the user requested a non-default scope that cannot be inferred. Requires a self-review audit and approval before cleanup edits.
---

# Code Quality

The canonical policy lives in `~/.pi/agent/AGENTS.md`, especially `Scope, Simplicity, and Delivery` and `Critical Code Quality Rules`.
This skill owns the audit workflow only. Do not restate or override that policy here.

## Mode and approval

For review, revision, refactoring, or cleanup, begin in audit-only mode.
Inspect the full relevant changed surface, present a concise audit and cleanup plan, and wait for approval before editing.

If the user already approved a specific implementation plan, do not add a redundant approval gate. Self-review before and after the edit, and stop only when required work exceeds the approved seam.

If the user asks for findings only, do not edit.

## Determine scope

Default to the current working-copy/current-revision diff against its parent:

```bash
jj status --no-pager
jj diff --stat --no-pager
```

Ask only when the user requested a different comparison and its endpoints cannot be inferred after read-only inspection.

Read every modified authored file in the approved seam. Read adjacent call sites and tests only as needed to judge the design and the class of issue.

For generated or high-churn artifacts, inspect the path-specific diff and the authored inputs instead of reading the artifact in full. Treat generated output as evidence unless it suggests manual edits, suspicious output, or source/generator mismatch.

## Audit

1. Inspect the whole approved seam before proposing edits.
2. Search for the same class of issue to determine whether it is local or systemic.
3. Steelman meaningful abstractions before removing them.
4. Classify relevant items as `keep`, `inline`, `delete`, `merge`, `make private`, or `redesign`.
5. Separate required current work from systemic follow-up work under the global scope rules.
6. Prefer refactoring, deletion, or consolidation over additive guardrails.
7. Present the smallest complete cleanup plan.

When approval is still needed, use this compact shape:

```markdown
## Code Quality Audit

### Scope
- <changed surface and approved seam>

### Decisions
| Item | Decision | Reason | Change |
| ---- | -------- | ------ | ------ |

### Systemic follow-ups
- <impact, evidence, and recommended remediation, or none>

### Approval
I will not edit until you approve this cleanup plan.
```

Do not inventory incidental symbols that do not affect a decision.
Do not turn broad inspection into broad implementation.

## Implement

After approval:

1. Apply the approved cleanup across the complete seam.
2. Update real call sites and behavior-focused tests directly.
3. Do not preserve obsolete APIs or tests through compatibility shims.
4. Stop and ask to rescope if a safe fix would exceed the seam, remain incomplete, or entrench the systemic issue.

## Verify

Before reporting completion:

1. Re-read every modified file.
2. Re-run the relevant class-of-issue and API-surface searches.
3. Remove unnecessary exports, wrappers, suppressions, and compatibility code within the seam.
4. Run appropriate formatting, lint, typecheck, and focused tests.
5. Report the cleanup, validation, intentionally retained design, and systemic follow-ups concisely.
