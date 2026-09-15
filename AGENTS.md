# Critical Rules

## Git Operations - NEVER DO THESE UNLESS EXPLICITLY ASKED

- **NEVER** run `git add`, `git commit`, `git push`
- **NEVER** create branches
- **NEVER** perform any git operations on behalf of the user

Only perform git operations when the user EXPLICITLY requests them.

## Source Control Tooling (Prefer jj)

- The user uses Jujutsu (`jj`) for source control.
- Assume repositories are `jj` + Git colocated repos.
- Use `jj` for all source-control operations (status, diff, log, bookmark/branch, commit, push, rebase/squash, etc.).
- Do not use `git` for source-control actions unless the user explicitly requests `git`.
- When explaining workflows, prefer `jj` terminology and commands.

### Conflict-only resolution

- Preserve current working-copy content outside conflict regions, including changes jj already merged automatically. Do not rebuild the files from one side.
- If diff-style markers are confusing, inspect snapshot-style output with `jj --config ui.conflict-marker-style=snapshot file show -r @ <path>`.
- To inspect pre-rebase edits, use the original commit hash shown in the conflict labels; the change ID may now select the conflicted rebased revision.
- Edit conflict regions directly. Verify the final diff preserves both sides' intended changes, no conflicts remain in the working-copy revision, and the parent commit hash is unchanged.
- Leave the resolution in the current working-copy revision for review. Do not squash or rewrite parent revisions unless explicitly requested.

## Source Interpretation and Clarifying Questions

Treat Jira ticket bodies, product docs, specs, acceptance criteria, comments, plans, examples, and similar internally authored artifacts as context and evidence—not as binding contracts or guaranteed-correct scope and decomposition.

- Reconstruct the intended outcome from the user's words, the actual current state and product behavior, and the relevant series of artifacts. Read between the lines; do not mirror an artifact one-to-one merely because it exists.
- Binding constraints are limited to explicit user instructions, user-approved scope or design decisions, verified public or runtime contracts that current consumers rely on, and genuine interoperability, security, or legal requirements.
- If wording is ambiguous, strange, conflicting, too broad, overscoped, or supports materially different interpretations, stop before planning, delegating, or implementing and ask the user for clarity. Do not guess.
- Apply this clarity gate to every task, not only Jira or product work.
- Group related clarifications into one concise message and ask only what is necessary to unblock the task.

## Scope, Simplicity, and Delivery

- Audit broadly, but implement the smallest complete outcome.
- Start from the requested outcome and the actual current state. Identify the smallest missing delta before proposing or doing work, regardless of the level of abstraction or form of the request.
- Treat existing compatible capabilities as context or dependencies, not new work. Track only missing adaptation or evidence required to complete the requested outcome.
- Organize analysis, recommendations, and execution around real outcomes, not categories of activity. Discovery, setup, compatibility checks, implementation, documentation, testing, validation, review, approval, and release readiness support the requested outcome; they are not separate scope or authorization to add persistent artifacts.
- Do not invent validation. Every check must correspond to a concrete, authoritative requirement or demonstrated failure. Review human-facing prose editorially rather than converting wording into string assertions. Do not add validators, workflows, scripts, or other maintenance machinery merely to claim an outcome was validated.
- Add structure or split responsibility only when it represents a distinct required outcome or an unavoidable boundary such as separate ownership, a real handoff, or an independently blocking external dependency or gate.
- Minimize the number of outcomes and boundaries. Do not add process merely for visibility, symmetry, or an appearance of completeness.
- Prefer refactoring, deletion, or consolidation over additive guardrails when the systemic issue is inside the approved seam.
- Prefer one canonical owner. Change another file only when it directly contradicts or bypasses that owner.
- Complete the approved seam before taking on optional or adjacent work.
- Fix required discoveries that fit the seam. If a safe fix exceeds it, would be incomplete, or would entrench the systemic issue, stop and ask to rescope.
- Report evidenced systemic issues outside the seam as follow-ups with their impact, evidence, and recommended remediation.
- An implementation phase may contain at most two batches. Each batch must fit one agent session and produce one independently reviewable, mergeable change.
- Review iterations do not count as implementation batches, but review feedback does not expand the approved outcome.
- Deployment, apply-time, and production-validation gates do not authorize implementation scope growth.

## Bounded Evidence Collection

- Start with the smallest query that can distinguish the current hypotheses.
- Filter and aggregate logs at the source. Keep each result under 8 KB or 200 lines unless the task genuinely requires more.
- Never read a truncated output file wholesale. Search it with targeted tools such as `rg`, `jq`, or `awk` for the missing evidence.
- After each diagnostic batch, synthesize what it established before collecting more.
- After two inconclusive batches, reassess the hypothesis or ask before expanding the investigation.
- Stop researching once the user's question is supported by sufficient evidence.
- For web research, run one focused search batch first. Open pages only to resolve a specific uncertainty.

## Web Research and Browser Use

- Choose by the information needed, not by the word "browse." Use an available web-search tool for discovery and current external facts; prefer primary sources and stop when the question is supported.
- For a known public URL, prefer an available fetch/text-retrieval tool. If none is available, use `agent_browser` with `args: ["read", "<url>"]`, which can fetch text without launching Chromium. Do not open a browser merely to read documentation, articles, or raw source files.
- Launch a browser for interaction, authenticated/profile content, rendered DOM or visual inspection, or when lightweight retrieval demonstrably cannot provide the needed content. `open → snapshot → interact` applies to those browser workflows, not ordinary web research.
- Prefer native `agent_browser` over shell-driven browser automation when a browser is actually needed. That preference does not displace web search or lightweight URL fetching.

## Screenshot Review: Automatic Contact Sheets

- For multi-screen visual review, capture the known pages, states, or viewports in one safe `agent_browser` call/batch. Use distinct, descriptive output paths such as `home-desktop.png` and `home-mobile.png`; filenames and image dimensions become panel labels. Avoid capture → inspect → capture → inspect when the captures do not depend on visual feedback.
- For known linear capture sequences (open, resize, wait, screenshot), prefer `args: ["batch", "--bail"]` with a JSON array of argv arrays encoded as the `stdin` string, rather than `script`. Reserve `script` for actual conditional or looping orchestration; it uses a separate isolated browser session.
- If a capture script fails, inspect the failure and retry the independent captures together in an ordinary batch, re-establishing the page and viewport there. Do not fall back to separate screenshot calls unless later captures genuinely require new visual feedback; separate calls cannot produce a shared contact sheet.
- The local `extensions/browser-images.ts` hook automatically composes two or more distinct, verified saved screenshots from the same result into a **contact sheet** (screenshot montage). It returns the sheet as the only inline image, reports its saved path and `details.contactSheet`, and preserves originals, existing artifact metadata, and browser success/error status. It also handles saved screenshots omitted from upstream inline attachments.
- Inspect the automatically returned sheet first. Do not write composition commands, search for fonts, install image tools, or separately `read` the same sheet. The hook owns composition; agents only need to batch captures.
- Grouping is per call/batch, not across calls. Keep batches small enough for readable comparisons. For long pages, capture relevant sections instead of shrinking an entire page into an illegible thumbnail. One composite is not automatically cheaper; dimensions and detail still matter.
- Single screenshots remain deferred. Use `read` immediately when a screenshot must determine the next interaction or the task concerns one screen. After reviewing a sheet, read only the originals or crops needed to resolve a specific visual question.
- Check artifact verification and browser errors independently: a contact sheet can contain the successful captures from a partially failed batch and is not proof that every step passed. If composition fails, the hook reports a warning and leaves originals deferred; read the needed originals rather than spending time building a replacement image workflow.
- Evidence-only screenshots do not require a visual correctness claim. Saving a file proves capture, not visual correctness. Keep originals available for detail inspection and handoff.

## Delegation Task-Sizing

When instructing another agent (subagent, Herdr pane, reviewer, implementer), size the prompt so it fits comfortably in one context window. Loaded skills and compaction summaries do not survive into the recipient; only this section and the prompt itself do.

- One bounded outcome per prompt (~150–350 words). Lead with the outcome and semantic seam; link plans, tickets, and files instead of pasting their requirements.
- Never bundle implementation, audit, and exhaustive validation in a single prompt. Split phases per the two-batch limit in Scope, Simplicity, and Delivery.
- Context budgeting is the delegator's responsibility, never the recipient's. Do not ask a recipient to monitor its own context percentage or decide when to compact.
- Treat a recipient past ~70% context as unavailable for substantial new work; route continuations to a fresh session with a concise handoff, never to compact-and-continue.
- Load the agent-prompt-drafting skill before drafting non-trivial delegated prompts; it owns prompt wording.

## Code Style: Avoid Trivial Indirection

Avoid trivial one-use helpers or proxy functions. Inline simple constructors, list comprehensions, regexes, and transformations unless the abstraction is reused, has meaningful domain semantics, hides real complexity, improves testability, or materially clarifies the caller. Prefer direct, local code over small indirection layers.

## Critical Code Quality Rules

These rules are mandatory for all languages and all code changes.

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
- apply `Scope, Simplicity, and Delivery` to decide which occurrences belong in the current seam.

Do not patch only the named symbol or silently absorb the broader issue.

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

When API shape changes, update tests to the better API instead of adding compatibility wrappers. Replace only coverage tied to the obsolete contract; preserve unrelated behavior and unaffected user-visible branches.

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
- apply `Scope, Simplicity, and Delivery` to the full finding set;
- prefer refactoring, deletion, or consolidation over additive guardrails;
- delete obsolete helpers and tests within the approved seam;
- run formatting/lint/typecheck/tests.

Do not report done after narrow patching or expand into unrelated cleanup.

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
