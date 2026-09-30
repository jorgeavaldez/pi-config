# Pi ↔ Neovim RPC Flow (Pi Extension Side)

## What this owns
Extension integration for external editing.

Files:
- `extensions/editor-env.ts`
- `extensions/shared/editor-state.ts`
- `extensions/editor-open.ts` (main prompt reference + draft buffer)
- `extensions/shared/editor-ui.ts` (review dialog drafts)

## Initialization
At extension load:
- `editor-env.ts` searches for `<config-home>/<NVIM_APPNAME or nvim>/bin/pi-nvim-editor` in `XDG_CONFIG_HOME`, Windows `LOCALAPPDATA`, then `~/.config`.
- When the wrapper exists, it sets `EDITOR` and `VISUAL` to `bash <wrapper-path>` for Bash clients (identified by their shebang), or `node <wrapper-path>` for JavaScript clients, quoting paths with spaces or special characters. A Unix executable bit is not required; the selected interpreter must be available.
- Without a wrapper, it retains `EDITOR` or uses `VISUAL`, defaulting to `nvim`, and fills an unset `VISUAL` from `EDITOR`. No warning is emitted.

Important: this is process-wide; spawned subprocesses inherit these env vars.

## Runtime behavior
- `runEditor(...)` asynchronously launches the configured command without a shell. The TUI is suspended while the editor runs and restored afterward.
- The main prompt handles `app.editor.external` (normally Ctrl+G), opening the previous user-facing message and existing draft in **one temporary buffer**. System/tool text is never reference material.
- Status 0 permits submission of only the trimmed prompt section, provided the reference is unchanged and the markers are valid. Other exits or rejected content preserve the Pi draft. Temporary files are always cleaned up.
- Review dialogs show and handle the same configured action. A successful external edit updates the dialog draft; Enter submits it separately.
- `/edit` and persistent active-file state have been removed.

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

### 1) `EDITOR`/`VISUAL` not set to wrapper
- Check the configured wrapper path and `NVIM_APPNAME`. Bash clients must be invoked with Bash, not Node; JavaScript clients use Node.
- Restart Pi or reload extensions after correcting the path.

### 2) Ctrl+G opens but flow feels slow
Likely wrapper polling/probe latency tradeoff (50ms poll, 1s probe cadence).
Usually acceptable; see nvim-side doc for tuning options.

### 3) Cancel/abort semantics confusing
Wrapper exit mapping:
- `0` committed
- `1` aborted/cancelled
- `2` protocol/runtime error

For extension logic:
- the main prompt accepts only `0`; all other exits notify and submit nothing
- review dialogs treat `1` as cancellation and other nonzero exits as failures, preserving the dialog draft

## When asking an agent to debug
Ask it to collect these first:
1. current `$EDITOR`, `$VISUAL`, `$NVIM`
2. wrapper executable/path check
3. latest request/ack JSON in state dir
4. host command availability (`exists(':PiEditOpen')`)
5. exact exit code from `pi-nvim-editor`
