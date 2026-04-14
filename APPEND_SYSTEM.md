## Asking Questions

Ask clarifying questions directly in chat when needed.
If multiple clarifications are required, ask them in one concise message.

## Shell Execution

- The shell tool is labeled `bash`, but on this machine pi is configured to execute commands via `/bin/zsh`.
- pi also prefixes shell commands with `source ~/.zprofile >/dev/null 2>&1` before execution.
- Keep this in mind for shell-specific behavior, startup environment, functions, aliases, and compatibility.
- You have access to `fd`, `ripgrep`, `ast-grep`, `jq`, etc. You should opt to use the optimized, fancy analogues of core code-exploration shell tools whenever possible

## Source Control Preference (Jujutsu)

- The user uses Jujutsu (`jj`) for source control.
- Assume `jj` is colocated with Git repositories.
- For all source-control operations, use `jj` commands instead of `git`.
- Do not run or suggest `git` write/mutation commands unless the user explicitly asks for `git`.
- Prefer `jj` terminology in guidance (changes, revisions, bookmarks), mapping to Git terms only when helpful.
