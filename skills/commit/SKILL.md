---
name: commit
description: Reviews working copy changes and drafts a concise 1-line commit message. Use when the user wants a commit message or asks to describe/commit changes.
---

# Commit Skill

Generate a 1-line commit message for current changes.

## Steps

1. Run `jj diff --git --no-pager` to inspect the working-copy changes.
2. If there are no changes, say `No changes in working copy.` and stop.
3. Draft a short 1-line message that explicitly describes the changes. Use no conventional-commit prefix and no verbose description.
4. Return only the commit message. Do not run any source-control mutation commands.

Examples:
- `fix token expiry edge case`
- `refactor auth middleware`

## Rules

- **NEVER** run `jj commit`, `jj describe`, `jj new`, or any jj mutation commands
- **NEVER** run `git add`, `git commit`, `git push`
- **NEVER** create branches or bookmarks
- Only return the message — the user will commit/describe themselves
