---
name: draft-pr
description: Opens a draft PR on GitHub. Detects jj (Jujutsu) vs git repos and uses --head flag as required for jj. Use when the user wants to open a draft PR.
---

# Draft PR Skill

Opens a draft pull request on GitHub, handling jj (Jujutsu) and git repositories.

## Steps

1. **Detect VCS:**
   - Try `jj status` to detect jj repo
   - If jj: get bookmark name with `jj bookmark list --remote git`
   - If git: get branch name with `git branch --show-current`

2. **Determine base branch:**
   - Check remote for `main` or `master`
   - Default to `main`

3. **Get PR title:**
   - If user provided: use it
   - Else: use bookmark/branch description or generate from recent commits

4. **Create draft PR:**
   - **ALWAYS** use `--head` flag (required for jj, works for git)
   - Command: `gh pr create --draft --head <name> --base <base> --title <title> [--body <body>]`

5. **Report the PR URL**

## Rules

- **ALWAYS** use `--head` flag with `gh pr create`
- **ALWAYS** default to draft (use `--draft`)
- Ensure bookmark/branch is synced to remote before creating PR
- If not synced, ask user to run `jj git push` or `git push` first

## Example Usage

```json
{
  "description": "Create draft PR",
  "model": "opencode/kimi-k2.6",
  "prompt": "Open a draft PR for the current jj bookmark or git branch. Use gh pr create with --draft and --head flags. Detect base branch (main/master). Generate PR title from bookmark description if available."
}
```
