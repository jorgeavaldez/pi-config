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
- When work needs Jorge's passphrase, password, login, or 2FA (for example, a locked SSH key), stop and ask him to unlock it; it takes him seconds. Don't work around it with agent forwarding, other credentials, or new keys, and don't kill agents or credential helpers that hold unlocked keys.
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
- Load the `browser-research` skill before multi-step browser research or when orchestrating browser agents.
- On desktop, every agent browser session connects to Jorge's daily Chrome (`cdp` in `~/.agent-browser/config.json`); never launch a managed browser (`--profile`, `--headed`, `sessionMode: fresh`). Connecting needs remote debugging enabled at `chrome://inspect/#remote-debugging` plus Jorge's approval of Chrome's prompt; if it fails or times out, ask Jorge once instead of retrying in a loop. On the phone (Termux), the default managed browser is expected; there is no daily Chrome to attach to.
- Start with `--session <unique-task-name> --pin-tab tab new <url>`, then pass `--session <unique-task-name>` first on every later call, including `batch`. A bare call acts on Jorge's active tab.
- Work only in tabs you opened and close only those (`tab close <id>`). Never close Jorge's browser or windows, or another agent's tabs or sessions. Leave captchas and logins to Jorge.
- Keep every browser call under 25 seconds: repeat short `wait --fn` checks instead of long waits or polling `eval` promises. Longer calls time out and can restart the session's connection.
- Run one agent per site at a time and pace searches; rapid bursts get blocked whatever the browser.

## Delegation

Load the `agent-prompt-drafting` skill before instructing another agent, and `herdr-manager` when routing to Herdr panes. One bounded outcome per prompt; context budgeting is the delegator's job, never the recipient's.

### Orchestrator resume file

When orchestrating work across agents or sessions, keep resume state where the effort is already tracked, so Jorge can point a fresh agent at it and continue without the chat.

- Vault projects: the project's entry in its domain `FOCUS.md` (current state, live workers, what's next, decisions needed) and dated status sub-bullets under its tasks in the domain `tasks.md`. Never create separate status, sitrep or dated handoff notes; a status or handoff request means updating those.
- Research folders: `progress.md`, with a `## Resume here` section at the top: read order, current state with booking or confirmation IDs, live workers/sessions/tabs, ordered to-dos with owners, open decisions, budgets or totals, and operating gotchas.
- Update at every milestone and before ending a turn that changed state. Replace stale state in place.
- Workers write only their own findings; the orchestrator owns the resume state.

## Code Quality

Load the `code-quality` skill before writing or reviewing non-trivial code; it owns the full rules. Always, in every language:

- Prefer direct, local code. No trivial or unjustified helpers, wrappers, aliases, shims, adapters, or speculative layers.
- Change bad APIs and update every call site rather than preserving them with compatibility code.
- No `any`, unchecked or double casts, `@ts-ignore`, lint disables, or other suppressions without an explicit, narrowly scoped justification.
- Validate untrusted input once at the boundary, then use precise types. Make required values required.
- Compare secrets, tokens, signatures, and hashes in constant time.
- When a pattern is criticized, re-read the files and search for the same class of issue before answering or patching.
