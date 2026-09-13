# pi-agent config

## Contents

- `AGENTS.md` and `APPEND_SYSTEM.md` - global agent instructions
- `settings.json`, `models.json`, and `keybindings.json` - Pi configuration
- `obsidian.json` - optional Obsidian vault root
- `extensions/` - local extensions and their TypeScript workspace
- `skills/` and `private-skills/` - public and local-only skills
- `prompts/` - prompt templates
- `docs/` - extension runbooks and integration notes

## Configuration

### `obsidian.json`

The optional Obsidian config stores only the vault root.
Tools and skills derive obvious paths like `prompts/` from the vault root and otherwise route by path/context.

Supported locations:
- global: `~/.pi/agent/obsidian.json`
- project override: `<cwd>/.pi/obsidian.json`

Supported fields:

| Field | Description |
|-------|-------------|
| `vaultPath` | Root of the Obsidian vault |

Example:

```json
{
  "vaultPath": "~/obsidian/delvaze"
}
```

Do not add per-directory overrides or domain-specific task paths here.
The vault layout is intentionally plain:

- prompts derive from `<vaultPath>/prompts`
- work plans live under `work/plans/` when the work domain is clear
- personal project plans live under `projects/` or require an explicit path/clarifying question

## Extensions

### webtools

Provides Exa-backed `websearch` and `webfetch` tools for real-time web search and page fetching.

### notification

Sends a desktop notification when an agent run fully settles outside Herdr. It also warns when the agent requests a potentially dangerous shell command.

### editor-open

Adds a custom `Ctrl+G` workflow for drafting prompts in your editor with reference context.

Behavior:
- Opens the previous user-facing message and existing prompt draft in the same temporary buffer
- Uses only visible user/assistant or displayed custom-message text, never system instructions or tool output
- Protects the reference and sends only the trimmed prompt section after a successful editor exit
- Cancellation, failure, a changed reference, or an empty prompt leaves the Pi draft unchanged
- Removes the temporary buffer file after editing; `/edit` is no longer provided

The extension handles the configured `app.editor.external` action (normally `Ctrl+G`) while the main prompt has focus. See [`docs/editor-open.md`](docs/editor-open.md).

### pi ↔ nvim rpc flow

`editor-env` sets `EDITOR`/`VISUAL` to invoke the available `pi-nvim-editor` wrapper through Node; without it, the configured editor is retained, defaulting to Neovim.

This gives the main prompt and review dialogs a host-aware external edit path:
- if pi runs inside nvim `:terminal`, edits open in the host nvim
- otherwise it falls back to local nvim

For caveats and debugging steps, see [`docs/PI_NVIM_RPC.md`](docs/PI_NVIM_RPC.md).

### Herdr agent and compaction state

`herdr-agent-state` publishes authoritative Pi session and lifecycle state to Herdr when `HERDR_ENV=1`. Although Herdr manages this file, the repository carries a documented local patch so Pi compaction reports as semantic `working` state.

`herdr-compaction-state` separately owns the display-only `compacting` token, outcome notifications, and cleanup. See [`docs/herdr-compaction.md`](docs/herdr-compaction.md) for the ownership model, overwrite warning, upgrade procedure, validation, and troubleshooting.

### review

Interactive code review for a jj revset.

**Commands:** `/review [revset]`, `/end-review`

- `/review` — opens an editor prefilled with `trunk()..@`, then optionally collects review guidance
- `/review <revset>` — uses the supplied revset as the editor default
- Review dialogs show and honor the configured `app.editor.external` action; external edits update the dialog draft without submitting it
- `/end-review` — completes an isolated review, optionally summarizes it, and returns to the original session position; cancelling the loader aborts and awaits navigation, retaining review state for retry

When the current session has messages, `/review` can use an empty session-tree branch for isolation. Requires a jj repository.

### jj-footer

Reimplements the default footer and swaps the branch segment to show jj revision info (change ID, bookmarks, description), with fallback to the built-in git branch logic.

Enabled by default. Toggle with `/jj-footer` (`on`, `off`, `toggle`, `status`).

## Setup

```bash
jj git clone git@github.com:jorgeavaldez/pi-config.git ~/.pi/agent
cd ~/.pi/agent/extensions && npm install --ignore-scripts
```

Create `~/.pi/agent/auth.json` with your credentials (not tracked).

## Extension dependency sync

The extension workspace keeps local `devDependencies` on the same pi package versions as the installed `pi` CLI so TypeScript, editor IntelliSense, and `npm run type-check` use matching APIs.

`peerDependencies` are kept broad (`"*"`) because pi provides those packages at runtime; the pinned local `devDependencies` are just for workspace tooling.

After upgrading pi, resync the extension workspace with:

```bash
cd ~/.pi/agent/extensions
npm run sync-pi-deps
```

That script resolves the installed Pi package from the `pi` binary, updates the local Pi and TypeBox versions in `extensions/package.json`, and runs `npm install --ignore-scripts`. Commit `extensions/package-lock.json` with dependency changes; it is the canonical workspace lockfile, including on Termux.

Then check the workspace with `npm run type-check` and `node --test tests/*.test.ts` (Node.js with TypeScript stripping support).
