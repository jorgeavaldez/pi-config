# `editor-open` Extension

Custom `Ctrl+G` prompt drafting flow with message reference context.

## Overview

**Location:** `~/.pi/agent/extensions/editor-open.ts`

`editor-open` replaces the main prompt's default `Ctrl+G` external-editor behavior with a structured markdown section format. Other focused dialogs and fullscreen transcript search retain their own input handling.

## Behavior

When you press `Ctrl+G` while the main prompt is focused:

1. The extension reads the latest non-tool message from the current session branch when one is available.
2. It creates a timestamped section with HTML comment delimiters.
3. It opens your editor at the prompt section, using the existing Neovim wrapper configured by `editor-env` when available.
4. On save/quit, it extracts only the prompt section and sends it as a new user message.

Only a successful editor exit (status 0) is accepted. A failed launch, nonzero exit (including Neovim's `:cq`), or signal termination submits nothing and leaves the prefilled Pi prompt unchanged.

If an active `/edit` file is set (`edit-prompt-state`), the section is prepended there (after frontmatter when present). Otherwise, a temporary file is used.

## Delimiter Format

```markdown
<!-- REFERENCE: 2026-02-09T12:00:00 -->
(last message content)
<!-- PROMPT: 2026-02-09T12:00:00 -->
(your prompt here)
<!-- /REFERENCE: 2026-02-09T12:00:00 -->
```

Extraction behavior:
- Only content between `<!-- PROMPT: ... -->` and `<!-- /REFERENCE: ... -->` is sent
- Prompt is trimmed; whitespace-only content is treated as empty
- Reference block is verified to remain unchanged

## Keybinding

`keybindings.json` sets:

```json
{
  "app.editor.external": "ctrl+g"
}
```

The extension installs a `CustomEditor` that handles `app.editor.external` only when input reaches the main prompt. All other keys delegate to Pi's stock editor, and the working indicator remains embedded in its border.

No extension shortcut is registered, so there is no startup shortcut conflict. Fullscreen search retains its default `Ctrl+G` next-match binding while its search panel has focus. After closing search, `Ctrl+G` opens the reference/prompt flow again.

Run `/reload` after changing the extension or keybindings.
