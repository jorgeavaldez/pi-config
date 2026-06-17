---
name: draft-pr
description: Opens a draft PR on GitHub and assigns it to the current GitHub user. Supports current or explicitly provided branches/bookmarks. Detects jj (Jujutsu) vs git repos and uses --head flag as required for jj. Use when the user wants to open a draft PR.
---

# Draft PR Skill

Opens a draft pull request on GitHub, handling jj (Jujutsu) and git repositories. Supports opening a PR for the current branch/bookmark or for an explicitly provided branch/bookmark name.

## Steps

1. **Detect VCS:**
   - Try `jj status` to detect jj repo
   - If jj: get current bookmark name with `jj bookmark list` / `jj status` as needed
   - If git: get current branch name with `git branch --show-current`

2. **Determine head branch/bookmark:**
   - If the user provided a branch, bookmark, or head name, use that exact value as `<head>`
   - Otherwise use the current jj bookmark or git branch as `<head>`
   - If the provided `<head>` differs from the checked-out/current branch/bookmark, do not use the current working copy to infer PR details

3. **Determine base branch:**
   - Check remote for `main` or `master`
   - Default to `main`

4. **Verify and inspect the PR diff:**
   - Ensure `<head>` exists locally or on the remote and is synced to the remote before creating the PR
   - If `<head>` is not the checked-out/current branch/bookmark, inspect/read the `<base>...<head>` diff and commit details before choosing the PR title/body
   - Derive PR details from the inspected `<head>` vs `<base>` changes, not from unrelated working-copy changes

5. **Get PR title:**
   - If user provided: use it
   - Else: use inspected branch/bookmark description, diff, or recent commits for `<head>`

6. **Create draft PR:**
   - **ALWAYS** use `--head` flag (required for jj, works for git)
   - **ALWAYS** assign the PR to the current GitHub user with `--assignee @me`
   - Command: `gh pr create --draft --assignee @me --head <name> --base <base> --title <title> [--body <body>]`

7. **Report the PR URL**

## Rules

- **ALWAYS** use `--head` flag with `gh pr create`
- **ALWAYS** default to draft (use `--draft`)
- **ALWAYS** assign the PR to the current GitHub user (use `--assignee @me`)
- Accept an explicit branch/bookmark/head name from the user and use it as `--head <name>`
- If an explicit head differs from the current branch/bookmark, verify it and inspect its diff/commits before generating PR details
- Ensure bookmark/branch is synced to remote before creating PR
- If not synced, ask user to run `jj git push` or `git push` first

## Example Usage

```json
{
  "description": "Create draft PR",
  "model": "opencode/kimi-k2.6",
  "prompt": "Open a draft PR for the current jj bookmark, git branch, or an explicitly provided branch/bookmark. Use gh pr create with --draft, --assignee @me, and --head flags. Detect base branch (main/master). If the requested head differs from the current branch/bookmark, verify it and inspect the base...head diff before generating PR details."
}
```
