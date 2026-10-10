---
name: jj-conflict-resolution
description: Resolve jj (Jujutsu) conflicts by editing only the conflict regions. Use when a rebase, squash, or merge leaves conflicts in the working copy, or when the user asks to resolve conflicts.
---

# jj Conflict-Only Resolution

- Preserve current working-copy content outside conflict regions, including changes jj already merged automatically. Do not rebuild the files from one side.
- If diff-style markers are confusing, inspect snapshot-style output with `jj --config ui.conflict-marker-style=snapshot file show -r @ <path>`.
- To inspect pre-rebase edits, use the original commit hash shown in the conflict labels; the change ID may now select the conflicted rebased revision.
- Edit conflict regions directly. Verify the final diff preserves both sides' intended changes, no conflicts remain in the working-copy revision, and the parent commit hash is unchanged.
- Leave the resolution in the current working-copy revision for review. Do not squash or rewrite parent revisions unless explicitly requested.
