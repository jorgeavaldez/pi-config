---
name: code-quality
description: Audit-first strict code quality review. Use before and after non-trivial code edits, when refactoring, when the user asks to revise/review/cleanup, or when user flags abstraction/type/API/code smell. Requires a full self-review audit and approval before cleanup edits.
---

# Code Quality

Use this skill to prevent trivial indirection, brittle API shims, type acrobatics, and cleanup-by-patching-only.

These rules are mandatory for all languages and all code changes.

## Non-Negotiable Process

When this skill is used to review, revise, refactor, or clean up existing code, begin in **audit-only mode**.

Do not edit files during audit-only mode. Do not run with the first issue you notice. Do not make a narrow patch and call it cleanup.

First, inspect the full set of changed files fresh, including code from parent revisions that now belongs to the changed-file surface. For generated or high-churn artifacts, inspect the path-specific diff and relevant source inputs instead of reading the artifact in full. Then produce a self-review audit and stop for user approval before modifying code.

The audit must:

1. **Steelman the current shape**: explain the strongest plausible reason each notable helper, wrapper, type, export, cache, schema, and test seam might exist.
2. **Retrospect against this skill**: explain where that shape still fails these rules, especially directness, public surface area, type precision, validation boundaries, and test design.
3. **Inventory the whole changed surface**: list every modified file and every helper/wrapper/shim/alias/exported type/explicit return type/cache/config abstraction touched or adjacent to the change.
4. **Classify each item** as one of:
   - keep, with a specific rule-based justification;
   - inline;
   - delete;
   - merge;
   - make private;
   - redesign.
5. **Explain the proposed cleanup plan** before edits, including expected call-site and test changes.
6. **Stop for approval**. Do not modify files until the user approves the audit/plan.

If the user explicitly asks for findings only, stop after the audit. If the user explicitly asks to auto-apply, still perform and present the audit first, then proceed only if the instruction clearly waived the approval checkpoint.

## Critical Rules

### 1. Prefer direct, local code over abstraction

Do not create wrappers, helpers, aliases, shims, adapters, or proxy functions unless they are justified by current code.

A helper is allowed only when it:

- is reused;
- encodes meaningful domain semantics;
- hides real complexity;
- materially improves testability;
- prevents a real security/correctness mistake;
- or defines an intentional, stable public boundary.

Do not create helpers merely to make code “look cleaner.”

### 2. No trivial one-use helpers

Inline one-use code that only wraps:

- constructors;
- regexes;
- parsing calls;
- validation calls;
- casts/conversions;
- option/default resolution;
- simple string splitting/joining;
- simple list/map/filter transformations;
- simple hashing/encoding calls;
- direct library calls;
- pass-through function calls.

If the abstraction has no independent meaning, delete it.

### 3. Treat review comments as class-of-issue signals

When the user points out one bad function or pattern, assume the issue may exist elsewhere.

Before responding:

- re-read every modified file;
- search for the same class of smell;
- fix all related instances;
- then explain the broader cleanup.

Do not patch only the exact symbol the user named.

### 4. Do not preserve bad API surfaces

Backward-compatible shims, aliases, renamed exports, overloads, compatibility wrappers, and migration layers are code smells unless explicitly requested.

Default behavior:

- change the API surface;
- update all call sites;
- delete the old shape;
- remove tests that preserve the obsolete API.

We can change APIs. Do not contort implementation code to preserve a bad API.

### 5. No type acrobatics

Avoid casts, widening, narrowing hacks, fake generics, double assertions, and “make TypeScript shut up” patterns.

Do not use:

- `any`;
- double casts like `as unknown as T`;
- broad `Record<string, unknown>` unless truly modeling arbitrary records;
- unnecessary generic parameters;
- type assertions where validation or better types should exist;
- optional fields only to appease a caller;
- unions that encode impossible states.

If the type does not fit, improve the API or data model instead of forcing it.

### 6. Validate at boundaries, then use precise types

For untrusted input:

- validate once at the boundary;
- return/use a precise typed value;
- avoid repeated ad hoc checks downstream.

For trusted internal values:

- do not add defensive parsing everywhere;
- keep the type narrow from the source.

Validation should clarify the code, not create ceremony.

### 7. Hoist expensive or reused definitions; inline cheap call sites

Hoist:

- schemas used for exported/inferred types;
- schemas reused in multiple places;
- regexes used repeatedly;
- expensive constructors;
- clients/caches;
- stable constants.

Inline:

- one-off parse/validate calls;
- simple transformations;
- local option handling;
- one-use intermediate wrappers.

Do not put expensive schema/client construction inside hot paths.

### 8. Tests must not fossilize bad design

Do not keep a helper public because a test imports it.

Tests should exercise real public behavior. If a helper only exists for tests, delete the helper and rewrite the tests.

When API shape changes, update tests to the better API instead of adding compatibility wrappers.

### 9. No speculative architecture

Do not add layers for hypothetical future use.

Avoid:

- “we may need this later” abstractions;
- generic utility modules with one consumer;
- adapter layers without a real second implementation;
- compatibility shims for imagined users;
- config hooks that are not currently needed.

Build the simplest correct thing for the current requirement.

### 10. Keep public surface area small

Export the minimum needed API.

Before exporting anything, ask:

- Is this consumed outside the module/package now?
- Is it intentionally part of the package contract?
- Would changing it later be painful?

If not, keep it private or inline it.

### 11. Prefer explicit data flow over hidden behavior

Avoid hidden global state, implicit mutation, surprising defaults, and magic fallbacks.

If a value is required, require it in the API. Do not silently construct fallback clients/caches/config in leaf functions unless that is the clear boundary owner.

### 12. Make invalid states unrepresentable

Prefer types and API shapes that prevent invalid combinations.

Avoid:

- optional values that are actually required;
- loosely typed bags of options;
- booleans that create unclear modes;
- accepting multiple shapes if only one is needed;
- returning partially valid objects.

If a caller must provide a cache/client/tenant/config, make it required.

### 13. Security-sensitive comparisons must be deliberate

Use constant-time comparison for secrets, tokens, signatures, MACs, hashes, and bearer-token-derived values.

Do not use ordinary equality for security-sensitive values.

Ordinary equality is fine for non-secret domain values like tenant slugs, methods, paths, enum values, and IDs, unless they are acting as secrets.

### 14. Cleanup means search and simplify

When asked to revise, review, or cleanup:

- inspect all changed files;
- search for named smells and adjacent patterns;
- remove the class of issue;
- delete obsolete helpers;
- delete obsolete tests;
- run formatting/lint/typecheck/tests.

Do not report done after narrow patching.

### 15. No suppressions without explicit justification

Do not add linter/typechecker suppressions unless absolutely necessary.

Forbidden by default:

- `any`;
- `@ts-ignore`;
- `@ts-expect-error`;
- lint disables;
- type checker ignores;
- blanket noqa/ignore comments;
- unchecked casts.

If unavoidable, explain why and scope it to the smallest possible line.

### 16. Error handling should be meaningful, not decorative

Do not wrap errors in helpers/classes unless callers use the distinction.

Use structured/domain errors when they improve control flow, observability, or security decisions. Otherwise keep errors simple and local.

### 17. Re-read before defending

If challenged, do not explain from memory.

First:

- re-read the relevant files;
- search for similar patterns;
- identify whether the critique applies broadly;
- then answer.

If the user is right, say so and fix it.

## Required Workflow

### Context discipline for generated/high-churn artifacts

Do not spend context reading large machine-generated or high-churn artifacts in full just because they are modified. This class includes lockfiles, generated clients/schemas/types, snapshots/golden files, fixture dumps, vendored or compiled output, minified bundles, source maps, SBOMs, coverage/build artifacts, and other files where most lines are deterministic tool output rather than authored code.

For these files:

- Use status/stat first to identify them.
- Inspect the path-specific diff (`jj diff -- <path>` or the equivalent requested diff command) rather than the whole file.
- Read the authored inputs that produced the artifact: manifests, schemas, generator configs, source templates, tests, or package declarations.
- If dependency metadata matters, inspect only the relevant changed entries/hunks and verify with package-manager or catalog commands; do not page through the whole lockfile.
- Treat the generated artifact as review evidence, not as code-quality surface, unless the diff suggests manual edits, suspicious generated output, security-sensitive dependency changes, or a generator/source mismatch.
- If you believe a generated/high-churn artifact truly must be read in full, stop and explain why before doing it.

### Phase 1: Fresh intake, no edits

1. Determine the changed scope with the appropriate source-control diff/status command.
2. Read every modified authored source, config, and test file in full, or in complete chunks if large. Do not read generated/high-churn artifacts in full; inspect only their diffs and relevant changed entries as described above.
3. Read adjacent call sites/tests needed to understand whether exports and helpers are real boundaries or incidental seams.
4. Search the changed scope for:
   - helper/wrapper/shim/alias/proxy/pass-through patterns;
   - exported symbols and explicit return/object types;
   - `any`, suppressions, double casts, broad records, compatibility exports;
   - tests importing internals or preserving obsolete API shapes.

### Phase 2: Self-review audit, still no edits

Produce an audit before modifying code. Use this structure:

```markdown
## Code Quality Audit

### Changed Surface
- file: why it is in scope

### Steelman
- item: strongest reason this shape might be justified

### Retrospect
- item: why the steelman is insufficient, or why the item should stay

### Decisions
| Item | Classification | Justification | Planned change |
| ---- | -------------- | ------------- | -------------- |
| path:symbol | keep/inline/delete/merge/private/redesign | rule-based reason | concrete action |

### Approval Checkpoint
I will not modify files until you approve this plan.
```

Do not collapse this into one paragraph. Do not list only the first issue found. The audit is the work product.

### Phase 3: Implementation after approval

1. Apply the approved cleanup across the whole changed surface, not only the first issue.
2. Prefer direct code.
3. Do not preserve bad APIs.
4. Avoid casts and widening.
5. Validate at boundaries.
6. Update call sites and tests to the improved API instead of adding compatibility shims.

### Phase 4: Verification and final retrospect

Before final response:

1. Re-read every modified file.
2. Re-run the helper/wrapper/shim/alias/export/type-acrobatics searches.
3. Remove unnecessary public exports.
4. Run formatting/lint/typecheck/tests appropriate to the change.
5. Report what changed relative to the approved audit:
   - items removed/inlined/merged/made private;
   - items intentionally kept and why;
   - validation commands and results.
