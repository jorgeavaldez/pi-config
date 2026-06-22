---
name: dump-overview
description: Dump a concise overview of repo/branch/session changes to Jorge's Obsidian vault for handoffs. Use from any repo when the user wants to document what was implemented, summarize changes, or create a handoff overview.
---

# Dump Overview

Generate a structured overview of changes for handoff and write it into the Obsidian vault.

Use `jj` for source-control inspection unless the user explicitly asks for git.
Route the overview by domain.
Ask if the destination is ambiguous.

## Vault resolution

Resolve the vault simply:

1. If the user gave an explicit output path, use it.
2. If the current directory is inside the vault, write relative to that vault.
3. Otherwise, use `~/obsidian/delvaze` if it exists.
4. If a minimal Obsidian config exists, it may be used as a fallback:
   - project override: `.pi/obsidian.json`
   - global fallback: `~/.pi/agent/obsidian.json`
5. If the vault cannot be found, STOP and ask.

Do not require a large hardcoded directory map.

## Destination rules

| Domain | Destination |
|--------|-------------|
| work/Nebari/Bari | `<vault>/work/overviews/{feature}-overview.md` |
| personal project | `<vault>/projects/<project>/...` or ask |
| unclear | ask before writing |

Work repos usually live under `~/proj/werk/`.
The common work repo is `~/proj/werk/nebari-mvp`, but do not assume it.

Personal technical project overviews should not go in `work/overviews/`.

## Workflow

1. Determine or ask:
   - repo path, usually current cwd
   - domain: work or personal project
   - comparison base/revision
   - feature name / output filename
2. Resolve the vault and output destination.
3. Inspect repository changes with `jj`.
4. Read relevant code and docs.
5. Search vault context in the matching domain.
6. Write the overview to the selected vault location.
7. Offer follow-up tasks/prompts only if useful.

Useful `jj` commands:

```bash
jj status
jj log -r 'ancestors(@) & mutable()' --limit 20
jj diff --stat
jj diff
```

If the user gives a base revision, use it explicitly:

```bash
jj diff --from <base> --to @
```

## Related docs search

Use path-appropriate search from the vault root:

```bash
rg -l "keyword" prompts work projects garden
```

Use `obsidian` CLI search if available and simpler.
Fallback to plain files.

## Overview structure

For work overviews under `work/overviews/`, use:

```markdown
---
id: {feature}-overview
aliases: []
tags: []
branch: {change_or_bookmark_name_if_known}
base: {base_revision_if_known}
date: YYYY-MM-DD
---

# {Feature} Overview

## Summary

Brief description of what was implemented and why.

## Files Changed

| File | Change Type | Description |
|------|-------------|-------------|
| path/to/file.py | modified | Updated to support X |

## Key Decisions

- Decision 1 and why it matters.

## Patterns Established

- Pattern 1 for future work.

## Testing / Verification

- What was tested.
- Commands run.
- What still needs manual validation.

## Known Limitations

- Limitation or risk.

## Follow-up Work

- [ ] Follow-up task.

## Related Docs

- [[work/plans/related-plan]]
- [[prompts/originating-prompt]]
```

For personal project overviews, use the same content shape but place it under the relevant project path and link related project notes.

## Rules

- Prefer concise handoff value over exhaustive transcript.
- Always include a files-changed table when summarizing repo changes.
- Use wikilinks for related vault docs.
- Preserve work/personal boundaries.
- Ask before writing if the destination is ambiguous.
- Do not use git mutation commands.
