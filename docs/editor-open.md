# `editor-open` Extension

Custom `Ctrl+G` prompt drafting flow with message reference context.

## Overview

**Location:** `~/.pi/agent/extensions/editor-open.ts`

`editor-open` handles the main prompt's configured `app.editor.external` action (normally `Ctrl+G`) with a structured markdown section format. Other focused dialogs and fullscreen transcript search retain their own input handling. Review dialogs also honor this action, editing their own draft rather than sending a message.

## Behavior

When you press `Ctrl+G` while the main prompt is focused:

1. The extension reads the previous user-facing message from the current branch: visible user/assistant text or a displayed custom message. System instructions, tool output, thinking, and tool calls are never used as reference text.
2. It creates one temporary markdown buffer containing the reference and a timestamped prompt section prefilled with the existing Pi draft. A fresh session has only the prompt section.
3. It opens your editor at the prompt section, using the Neovim RPC wrapper configured by `editor-env` when available (otherwise the retained editor preference, defaulting to local Neovim).
4. On a successful editor exit, it checks the reference is unchanged, extracts only the prompt section, clears the Pi draft, and sends the prompt as a new user message.

Only a successful editor exit (status 0) is accepted. A failed launch, nonzero exit (including Neovim's `:cq`), or signal termination submits nothing and leaves the prefilled Pi prompt unchanged.

The reference and prompt remain in the **same buffer**. A changed reference, missing delimiters, or an empty prompt submits nothing and preserves the Pi draft. The temporary directory is removed after success, cancellation, or failure. `/edit` and persistent prompt-file selection are no longer provided; historic session file selections are ignored.

## Delimiter Format

```markdown
<!-- REFERENCE: 2026-02-09T12:00:00 -->
(previous user-facing message)
<!-- PROMPT: 2026-02-09T12:00:00 -->
(your prompt here)
<!-- /REFERENCE: 2026-02-09T12:00:00 -->
```

Extraction behavior:
- Only content between `<!-- PROMPT: ... -->` and `<!-- /REFERENCE: ... -->` is sent
- Prompt is trimmed; whitespace-only content is treated as empty
- Reference block is verified to remain unchanged

## Keybinding

The usual binding in `keybindings.json` is:

```json
{
  "app.editor.external": "ctrl+g"
}
```

The extension installs a `CustomEditor` that handles `app.editor.external` only when input reaches the main prompt. All other keys delegate to Pi's stock editor, and the working indicator remains embedded in its border.

No extension shortcut is registered, so there is no startup shortcut conflict. Fullscreen search retains its default `Ctrl+G` next-match binding while its search panel has focus. After closing search, `Ctrl+G` opens the reference/prompt flow again.

Run `/reload` after changing the extension or keybindings.
