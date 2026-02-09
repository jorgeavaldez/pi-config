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

Ask clarifying questions directly in chat when you need user input before proceeding.

- Group related clarifications into one concise message.
- Ask only what is necessary to unblock implementation.
