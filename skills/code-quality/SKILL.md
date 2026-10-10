---
name: code-quality
description: Mandatory code quality rules plus an audit-first review workflow. Load before writing or editing non-trivial code in any language, when refactoring, when the user asks to revise/review/cleanup code, or when the user flags an abstraction/type/API/code smell. Reviews default to the current working-copy/current-revision diff; do not ask what to review unless the user requested a non-default scope that cannot be inferred. Requires a self-review audit and approval before cleanup edits.
---

# Code Quality

This skill owns the code quality rules and the audit workflow.
Scope decisions follow `Scope, Simplicity, and Delivery` in the global `AGENTS.md`; do not restate or override that policy here.

## Rules

Mandatory for all languages and all code changes.

### 1. Direct, local code over abstraction

Do not create wrappers, helpers, aliases, shims, adapters, or proxy functions unless current code justifies them. A helper is allowed only when it is reused, encodes meaningful domain semantics, hides real complexity, materially improves testability, prevents a real security or correctness mistake, or defines an intentional, stable public boundary. "Looks cleaner" is not a reason.

Inline one-use code that only wraps a constructor, regex, parse or validation call, cast or conversion, option/default resolution, simple string split/join, simple list/map/filter transformation, hashing or encoding call, direct library call, or pass-through call. If the abstraction has no independent meaning, delete it.

### 2. No speculative architecture, small public surface

Build the simplest correct thing for the current requirement. No "we may need this later" abstractions, generic utility modules with one consumer, adapter layers without a real second implementation, compatibility shims for imagined users, or config hooks nobody needs yet.

Export the minimum. Before exporting, ask whether it is consumed outside the module now, is intentionally part of the package contract, and would be painful to change later. If not, keep it private or inline it.

### 3. Do not preserve bad API surfaces

Backward-compatible shims, aliases, renamed exports, overloads, compatibility wrappers, and migration layers are code smells unless explicitly requested. Change the API surface, update all call sites, delete the old shape, and remove tests that preserve the obsolete API. Do not contort implementation code to preserve a bad API.

### 4. No type acrobatics or suppressions

If the type does not fit, improve the API or data model instead of forcing it. Do not use:

- `any`, double casts like `as unknown as T`, or unchecked casts;
- type assertions where validation or better types should exist;
- broad `Record<string, unknown>` unless truly modeling arbitrary records;
- unnecessary generic parameters;
- `@ts-ignore`, `@ts-expect-error`, lint disables, type-checker ignores, or blanket noqa/ignore comments.

If a suppression is unavoidable, explain why and scope it to the smallest possible line.

### 5. Make invalid states unrepresentable

Prefer types and API shapes that prevent invalid combinations. Avoid optional values that are actually required (or added only to appease a caller), loosely typed option bags, booleans that create unclear modes, unions that encode impossible states, accepting multiple shapes when one is needed, and returning partially valid objects. If a caller must provide a cache, client, tenant, or config, make it required.

### 6. Validate at boundaries, then use precise types

For untrusted input, validate once at the boundary, return a precise typed value, and avoid repeated ad hoc checks downstream. For trusted internal values, do not add defensive parsing; keep the type narrow from the source. Validation should clarify the code, not create ceremony.

### 7. Explicit data flow

Avoid hidden global state, implicit mutation, surprising defaults, and magic fallbacks. If a value is required, require it in the API. Do not silently construct fallback clients, caches, or config in leaf functions unless that is the clear boundary owner.

### 8. Hoist expensive or reused definitions; inline cheap call sites

Hoist schemas used for exported/inferred types or in multiple places, regexes used repeatedly, expensive constructors, clients/caches, and stable constants. Inline one-off parse/validate calls, simple transformations, local option handling, and one-use intermediates. Never construct expensive schemas or clients inside hot paths.

### 9. Tests must not fossilize bad design

Tests exercise real public behavior. Do not keep a helper public because a test imports it; if a helper exists only for tests, delete it and rewrite the tests. When an API changes, update tests to the better API instead of adding compatibility wrappers. Replace only coverage tied to the obsolete contract; preserve unrelated behavior and unaffected user-visible branches.

### 10. Meaningful error handling

Do not wrap errors in helpers or classes unless callers use the distinction. Use structured/domain errors when they improve control flow, observability, or security decisions; otherwise keep errors simple and local.

### 11. Deliberate security-sensitive comparisons

Use constant-time comparison for secrets, tokens, signatures, MACs, hashes, and bearer-token-derived values. Ordinary equality is fine for non-secret domain values such as tenant slugs, methods, paths, enum values, and IDs, unless they act as secrets.

### 12. Treat critique as a class-of-issue signal

When the user points out one bad function or pattern, assume it may exist elsewhere. Before responding or defending, do not explain from memory: re-read every modified file, search for the same class of smell, and apply the global scope rules to decide which occurrences belong in the current seam. Do not patch only the named symbol, silently absorb the broader issue, or expand into unrelated cleanup. If the user is right, say so and fix it.

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
