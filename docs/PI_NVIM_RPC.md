# Pi ↔ Neovim RPC Flow (Pi Extension Side)

## What this owns
Extension integration for external editing.

Files:
- `extensions/editor-env.ts`
- `extensions/shared/editor-state.ts`
- `extensions/handoff.ts`
- `extensions/editor-open.ts` (Ctrl+G flow, preserved)

## Initialization
At extension load:
- `editor-env.ts` resolves wrapper path:
  - `${XDG_CONFIG_HOME:-$HOME/.config}/nvim/bin/pi-nvim-editor`
- If executable exists:
  - sets `process.env.EDITOR`
  - sets `process.env.VISUAL`
- If missing/unexecutable:
  - warns and leaves env unchanged

Important: this is process-wide; spawned subprocesses inherit these env vars.

## Runtime behavior
- `openInEditor(...)` remains the shared editor launcher.
- `editTextExternally(...)` adds temp-file prefill + readback semantics.
- `/handoff` now uses `editTextExternally(...)` (no `ctx.ui.editor(...)`).
- Ctrl+G editor-open flow remains extension-based and synchronous.

## Expected by context
Inside Neovim `:terminal` with valid `$NVIM`:
- edits open in host Neovim tabs
- no nested nvim instance

Outside host mode or stale `$NVIM`:
- wrapper falls back to local nvim

## Quick checks
```bash
# wrapper present
ls -l ~/.config/nvim/bin/pi-nvim-editor

# in running pi shell context
echo "$EDITOR"
echo "$VISUAL"
```

## Troubleshooting (short)

### 1) `/handoff` uses modal editor path again
Expected behavior is external-file flow now.
- Verify `extensions/handoff.ts` imports and calls `editTextExternally(...)`.
- Verify extension set being loaded is your local `~/.pi/agent/extensions`.

### 2) `EDITOR`/`VISUAL` not set to wrapper
- Wrapper path missing or not executable.
- Fix perms/path:
  ```bash
  chmod +x ~/.config/nvim/bin/pi-nvim-editor
  ```
- Restart Pi process after fixing.

### 3) Ctrl+G opens but flow feels slow
Likely wrapper polling/probe latency tradeoff (50ms poll, 1s probe cadence).
Usually acceptable; see nvim-side doc for tuning options.

### 4) Cancel/abort semantics confusing
Wrapper exit mapping:
- `0` committed
- `1` aborted/cancelled
- `2` protocol/runtime error

For extension logic:
- treat `1` as user cancel
- treat `2` as error path with notification/retry guidance

## When asking an agent to debug
Ask it to collect these first:
1. current `$EDITOR`, `$VISUAL`, `$NVIM`
2. wrapper executable/path check
3. latest request/ack JSON in state dir
4. host command availability (`exists(':PiEditOpen')`)
5. exact exit code from `pi-nvim-editor`
