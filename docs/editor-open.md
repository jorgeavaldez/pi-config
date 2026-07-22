# `editor-open` Extension

Custom `Ctrl+G` prompt drafting flow with message reference context.

## Overview

**Location:** `~/.pi/agent/extensions/editor-open.ts`

`editor-open` replaces the default `Ctrl+G` external-editor behavior with a structured markdown section format.

## Behavior

When you press `Ctrl+G`:

1. The extension reads the latest non-tool message from the current session branch when one is available.
2. It creates a timestamped section with HTML comment delimiters.
3. It opens your editor at the prompt section.
4. On save/quit, it extracts only the prompt section and sends it as a new user message.

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
  "app.editor.external": []
}
```

This unbinds Pi's built-in `app.editor.external` action from `Ctrl+G`, allowing `editor-open` to handle `Ctrl+G` through its extension shortcut.
