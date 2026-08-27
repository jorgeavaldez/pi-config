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

### edit-prompt

Opens your editor to edit prompt files under `<vaultPath>/prompts` when `obsidian.json` is configured, otherwise `~/.pi/prompts`.

**Usage:** `/edit` - First call opens file selector, subsequent calls reuse the file.

Two modes in file selector (toggle with `Ctrl+R`):
- **New File** (default): Type filename to create/open
- **Search**: Fuzzy search existing files (requires `fd`)

Uses `$EDITOR` → `$VISUAL` → nvim → vim → vi fallback chain.

### editor-open

Adds a custom `Ctrl+G` workflow for drafting prompts in your editor with reference context.

Behavior:
- Includes the latest non-tool message as a reference section when one is available
- Adds a separate prompt section delimited by HTML comments
- Extracts and sends only the prompt section after save/quit
- If `/edit` has set an active file, prepends the section there (after frontmatter)
- Otherwise uses a temporary file

`keybindings.json` sets `app.editor.external` to `[]`, so `Ctrl+G` is handled by this extension instead of Pi's built-in external editor action.

### pi ↔ nvim rpc flow

`editor-env` sets `EDITOR`/`VISUAL` to `~/.config/nvim/bin/pi-nvim-editor` when available.

This gives `/edit` and `Ctrl+G` a deterministic host-aware external edit path:
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
- `/end-review` — completes an isolated review, optionally summarizes it, and returns to the original session position

When the current session has messages, `/review` can use an empty session-tree branch for isolation. Requires a jj repository.

### jj-footer

Reimplements the default footer and swaps the branch segment to show jj revision info (change ID, bookmarks, description), with fallback to the built-in git branch logic.

Enabled by default. Toggle with `/jj-footer` (`on`, `off`, `toggle`, `status`).

## Setup

```bash
jj git clone git@github.com:jorgeavaldez/pi-config.git ~/.pi/agent
cd ~/.pi/agent/extensions && bun install
```

Create `~/.pi/agent/auth.json` with your credentials (not tracked).

## Extension dependency sync

The extension workspace keeps local `devDependencies` on the same pi package versions as the installed `pi` CLI so TypeScript, editor IntelliSense, and `bun run type-check` use matching APIs.

`peerDependencies` are kept broad (`"*"`) because pi provides those packages at runtime; the pinned local `devDependencies` are just for workspace tooling.

After upgrading pi, resync the extension workspace with:

```bash
cd ~/.pi/agent/extensions
bun run sync-pi-deps
```

That script resolves the installed Pi package from the `pi` binary, updates the local Pi package versions in `extensions/package.json`, and runs `bun install`.
