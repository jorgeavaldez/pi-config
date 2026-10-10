## Asking Questions

Ask clarifying questions directly in chat when needed.
If multiple clarifications are required, ask them in one concise message.

## Shell Execution

- The `bash` tool executes through bash (Git Bash on Windows). Write bash there, not Nushell.
- It inherits the environment of the process that launched pi and loads no Nushell or Zsh startup files, aliases, or functions.
- You have access to `fd`, `ripgrep`, `ast-grep`, `jq`, etc. You should opt to use the optimized, fancy analogues of core code-exploration shell tools whenever possible

## Browser Tool

- The native browser tool is `agent_browser`. When no fetch tool is available, `args: ["read", "<url>"]` fetches page text without launching Chromium.
- `open → snapshot → interact` applies to real browser workflows, not ordinary web research.

## Source Control Preference (Jujutsu)

- The user uses Jujutsu (`jj`) for source control.
- Assume `jj` is colocated with Git repositories.
- For all source-control operations, use `jj` commands instead of `git`.
- Do not run or suggest `git` write/mutation commands unless the user explicitly asks for `git`.
- Prefer `jj` terminology in guidance (changes, revisions, bookmarks), mapping to Git terms only when helpful.
