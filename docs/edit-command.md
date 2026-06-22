# `/edit` Command Extension

Opens your editor to edit prompt files stored in an Obsidian vault, then executes the written prompt.

## Overview

**Location:** `~/.pi/agent/extensions/edit-prompt.ts`  
**Storage:** Derived from `obsidian.json` `vaultPath` as `<vaultPath>/prompts`, with fallback to `~/.pi/prompts`

## Behavior

### Session Flow

1. **First `/edit` in session:** File selector dialog → creates/opens file → opens editor → executes prompt
2. **Subsequent `/edit` in session:** Reuses same file → prepends new section → opens editor → executes prompt

The filename persists across session restarts via `pi.appendEntry()`.

### File Selection Dialog

The dialog has two modes, toggled with `Ctrl+R`:

| Mode | Description |
|------|-------------|
| **New File** (default) | Type a filename to create or open |
| **Search** | Fuzzy search existing files in the resolved prompts directory using `fd` |

**Search mode features:**
- Fuzzy matching (e.g., `rem` matches `remediation-pr-close.md`)
- Shows file metadata: modified time, created time, file size
- Arrow keys to navigate, Tab to autocomplete into input box
- Requires `fd` to be installed; no suggestions shown without it

**Key bindings:**

| Key | New File Mode | Search Mode |
|-----|---------------|-------------|
| `Enter` | Create/open file | Open selected file |
| `Escape` | Cancel dialog | Back to New File (preserves input) |
| `Ctrl+R` | Switch to Search | Switch to New File (preserves input) |
| `Ctrl+C` | Clear input, then cancel if empty | Clear input, then back to New File if empty |
| `Tab` | — | Autocomplete selection into input |
| `↑/↓` | — | Navigate suggestions |

### Session Persistence

The active prompt filename is stored in the session file as a custom entry (`edit-prompt-state`). This enables:

- **Continue session (`pi -c`):** Filename restored automatically
- **Resume session (`/resume`):** Filename restored from target session
- **Fork (`/fork`):** Filename carries forward to the new session
- **Clone (`/clone`):** Filename carries forward to the duplicated session
- **Tree navigation (`/tree`):** Filename remains unchanged (session-wide)

The filename is **session-wide**, not branch-specific. All branches in a session share the same active prompt file.

### Status Indicator

When an active prompt file is set, a status indicator appears in the footer showing the current filename (e.g., `📝 my-prompt.md`). This indicator:

- Appears when you first set a filename via `/edit`
- Persists across session restarts, switches, forks, clones, and tree navigation
- Clears when starting a new session without a previous prompt file

### Prompt Execution

After saving and quitting the editor, the content between the **paired delimiters** (matching timestamps) is extracted and sent to the agent via `pi.sendUserMessage()`.

## File Format

### Structure

```markdown
---
id: <filename-without-extension>
aliases: []
tags: []
---

<!-- prompt: 2026-01-13T15:49:28 -->
<newest prompt here>
<!-- prompt-end: 2026-01-13T15:49:28 -->

<!-- prompt: 2026-01-13T14:30:00 -->
<older prompt here>
<!-- prompt-end: 2026-01-13T14:30:00 -->
```

### Key Details

| Element | Format |
|---------|--------|
| Frontmatter `id` | Filename without `.md` extension |
| Timestamp | `YYYY-MM-DDTHH:MM:SS` (ISO 8601, no ms/timezone) |
| Order | Descending chronological (newest first) |
| Start delimiter | `<!-- prompt: <timestamp> -->` |
| End delimiter | `<!-- prompt-end: <timestamp> -->` |

New sections are **prepended** after frontmatter, pushing older content down. Each section is "boxed" between matching start and end delimiters with the same timestamp.

## Key Decisions

| Decision | Rationale |
|----------|-----------|
| Vault-root config only | Keep config minimal; derive prompt storage from `<vaultPath>/prompts` |
| Newest-first ordering | Most relevant prompt is always at top when editing |
| Session-scoped filename | Natural workflow—related prompts stay in one file |
| Session-wide (not branch-specific) | Simpler mental model; prompt file is a session-level setting |
| Persisted via `appendEntry()` | Survives restarts; follows pi extension patterns |
| HTML comment delimiters | Obsidian-friendly, doesn't render visually |
| Auto-append `.md` | Convenience; entering `foo` creates `foo.md` |
| Paired delimiters with timestamp | Prevents accidental execution of old content when user deletes/abandons new section |

## Edge Cases

| Scenario | Behavior |
|----------|----------|
| Directory doesn't exist | Error notification, exits |
| Empty/cancel filename input | Exits silently |
| Search mode, file doesn't exist | Error notification (files must exist in Search mode) |
| `fd` not installed | Search mode shows no suggestions |
| Empty prompt saved | "No prompt entered" notification, no execution |
| User deletes new section markers | "No prompt entered" (won't fall back to old content) |
| User deletes only start or end marker | "No prompt entered" (both markers required) |
| File missing frontmatter | Section prepended at start |
| Editor exits abnormally | Warning notification |
| Session restored, file deleted | Uses restored path; creates new file |
| New session (no state) | Prompts for filename as normal |
| Old file without end markers | "No prompt entered" until user fills new boxed section |

## Editor Integration

### Editor Selection

Uses a fallback chain (via shared module `extensions/shared/editor-state.ts`):
1. `$EDITOR` environment variable
2. `$VISUAL` environment variable
3. `nvim`
4. `vim`
5. `vi`

### Cursor Positioning

The editor opens with cursor positioned on the blank line between start and end markers:

| Editor | Arguments |
|--------|-----------|
| vim/nvim/vi | `+{line} filename` |
| nano | `+{line} filename` |
| emacs | `+{line} filename` |
| others | `filename` (no positioning) |

### TUI Handling

- Uses `ctx.ui.custom()` to suspend TUI
- Spawns editor synchronously with `stdio: "inherit"`
- TUI restored after editor exits

## Section Extraction Logic

1. Track the timestamp used when creating the new section
2. Look for exact start marker: `<!-- prompt: TIMESTAMP -->`
3. Look for exact end marker: `<!-- prompt-end: TIMESTAMP -->`
4. Validate both markers exist and end comes after start
5. Extract and trim content between them
6. Return empty string if markers missing, out of order, or content empty

This ensures only the specific section created by the current `/edit` invocation is extracted—never old content from previous sections.

## Integration with `editor-open` Extension

The edit-prompt extension shares its active file state with `editor-open` via `extensions/shared/editor-state.ts`.

When `/edit` has set an active file, pressing `Ctrl+G` (handled by `editor-open`) prepends a reference+prompt section into that same file instead of using a temporary file.

See [docs/editor-open.md](editor-open.md) for delimiter format and extraction behavior.

## Configuration

### Prompts Directory

The storage location for prompt files is derived from the Obsidian vault root.

**Files:**
- global: `~/.pi/agent/obsidian.json`
- project override: `<cwd>/.pi/obsidian.json`

```json
{
  "vaultPath": "~/obsidian/delvaze"
}
```

### Resolution order

1. `vaultPath + "/prompts"` from project `obsidian.json`
2. `vaultPath + "/prompts"` from global `obsidian.json`
3. fallback: `~/.pi/prompts`

### Details

| Field | Default | Description |
|------|---------|-------------|
| `vaultPath` | none | Obsidian vault root used to derive prompt storage |

- **Tilde expansion:** Paths starting with `~` are expanded to your home directory
- **Auto-creation:** The directory is not auto-created; it must exist before use
- **No prompt/plan directory overrides:** keep routing in skills/docs, not JSON config
