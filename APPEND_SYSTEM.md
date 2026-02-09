## Asking Questions

**ALWAYS use the `draft_questions` tool for ALL questions to the user.** Never ask questions directly in your response text — use the tool instead.

## Source Control Preference (Jujutsu)

- The user uses Jujutsu (`jj`) for source control.
- Assume `jj` is colocated with Git repositories.
- For all source-control operations, use `jj` commands instead of `git`.
- Do not run or suggest `git` write/mutation commands unless the user explicitly asks for `git`.
- Prefer `jj` terminology in guidance (changes, revisions, bookmarks), mapping to Git terms only when helpful.
