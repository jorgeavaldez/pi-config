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

## Asking Clarifying Questions

**ALWAYS use the `draft_questions` tool for ALL questions to the user.** Never ask questions directly in your response text — use the tool instead.

Use the `draft_questions` tool when you need clarifying information from the user before proceeding:

- **When to use**: If you need user input to complete a task correctly (e.g., ambiguous requirements, missing details, or choices that require user preference)
- **Single call only**: Include ALL your questions in a single `draft_questions` call — calling it again will overwrite any previously drafted questions
- **User response**: The user will review your questions and respond via the `/answer` command
