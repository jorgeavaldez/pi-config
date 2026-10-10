# Critical Rules

Skills named below live in `~/.pi/agent/skills/<name>/SKILL.md`. If a skill is not in your inventory, read that file directly.

## Source Control: jj Only

- Jorge uses Jujutsu (`jj`). Assume repositories are `jj` + Git colocated.
- Use `jj` for every source-control operation and in explanations. Do not use `git` unless explicitly asked.
- **Never** commit, push, create bookmarks or branches, or otherwise mutate history unless explicitly asked.
- Load the `jj-conflict-resolution` skill before resolving conflicts.

## Shell: Nushell

- Jorge's interactive shell on every device is Nushell (`nu`), and Herdr, tmux, and Zellij panes start in it. `~/dots` is the source of truth for shell setup.
- Write commands for Jorge to run, and any text typed into a pane, in Nushell syntax: no `&&`, `export`, `VAR=x cmd`, `$(...)`, or heredocs. Wrap a POSIX one-liner as `bash -c '...'` when porting it is not worth it.
- Your own shell tool keeps its own syntax. It does not load Nu config, so Nu aliases and custom commands (`j`, `psh`, `commit`) are unavailable there; call the underlying programs.
- The macOS/Linux login shell is still zsh, so non-interactive SSH commands run under zsh, not Nu.

## Source Interpretation and Clarifying Questions

Treat tickets, product docs, specs, acceptance criteria, comments, plans, and examples as context and evidence, not as binding contracts or guaranteed-correct scope.

- Reconstruct the intended outcome from the user's words, the actual current state, and the relevant artifacts. Do not mirror an artifact one-to-one merely because it exists.
- Binding constraints are limited to explicit user instructions, user-approved scope or design decisions, verified public or runtime contracts that current consumers rely on, and genuine interoperability, security, or legal requirements.
- If wording is ambiguous, conflicting, overscoped, or supports materially different interpretations, stop before planning, delegating, or implementing and ask. Do not guess. This applies to every task.
- Group clarifications into one concise message and ask only what is needed to unblock the task.

## Scope, Simplicity, and Delivery

- Audit broadly, but implement the smallest complete outcome. Start from the requested outcome and the actual current state, and identify the smallest missing delta before proposing or doing work.
- Existing compatible capabilities are context or dependencies, not new work.
- Organize work around real outcomes, not categories of activity. Discovery, setup, testing, documentation, review, and release readiness support the outcome; they are not separate scope or permission to add persistent artifacts.
- Do not invent validation. Every check must correspond to a concrete, authoritative requirement or demonstrated failure. Review prose editorially; do not add validators, workflows, or scripts merely to claim something was validated.
- Add structure, process, or a split in responsibility only for a distinct required outcome or an unavoidable boundary (separate ownership, a real handoff, an independently blocking dependency), never for visibility, symmetry, or an appearance of completeness.
- Prefer refactoring, deletion, or consolidation over additive guardrails. Prefer one canonical owner; change another file only when it directly contradicts or bypasses that owner.
- Complete the approved seam before optional or adjacent work. Fix required discoveries that fit the seam. If a safe fix exceeds it, would be incomplete, or would entrench a systemic issue, stop and ask to rescope.
- Report evidenced systemic issues outside the seam as follow-ups with impact, evidence, and recommended remediation.
- An implementation phase has at most two batches. Each batch fits one agent session and produces one independently reviewable, mergeable change. Review iterations are not batches, and neither review feedback nor deployment or production-validation gates expand the approved outcome.

## Bounded Evidence Collection

- Start with the smallest query that can distinguish the current hypotheses. Filter and aggregate at the source; keep each result under 8 KB or 200 lines unless the task genuinely requires more.
- Never read a truncated output file wholesale. Search it with targeted tools such as `rg`, `jq`, or `awk`.
- Synthesize what each diagnostic batch established before collecting more. After two inconclusive batches, reassess the hypothesis or ask before expanding.
- Stop researching once the question is supported by sufficient evidence.

## Web Research and Browser Use

- Use web search for discovery and current external facts: one focused search batch first, primary sources preferred, pages opened only to resolve a specific uncertainty.
- For a known public URL, use a fetch/text-retrieval tool. Do not open a browser merely to read documentation, articles, or raw source files.
- Launch a browser only for interaction, authenticated content, rendered DOM or visual inspection, or when lightweight retrieval demonstrably fails. Prefer a native browser tool over shell-driven automation.
- Load the `screenshot-review` skill before capturing screenshots for visual review.

## Delegation

Load the `agent-prompt-drafting` skill before instructing another agent, and `herdr-manager` when routing to Herdr panes. One bounded outcome per prompt; context budgeting is the delegator's job, never the recipient's.

## Code Quality

Load the `code-quality` skill before writing or reviewing non-trivial code; it owns the full rules. Always, in every language:

- Prefer direct, local code. No trivial or unjustified helpers, wrappers, aliases, shims, adapters, or speculative layers.
- Change bad APIs and update every call site rather than preserving them with compatibility code.
- No `any`, unchecked or double casts, `@ts-ignore`, lint disables, or other suppressions without an explicit, narrowly scoped justification.
- Validate untrusted input once at the boundary, then use precise types. Make required values required.
- Compare secrets, tokens, signatures, and hashes in constant time.
- When a pattern is criticized, re-read the files and search for the same class of issue before answering or patching.
