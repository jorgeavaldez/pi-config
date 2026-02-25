# pi-agent config

## Contents

- `AGENTS.md` - global rules (loaded for all sessions)
- `settings.json` - agent settings
- `keybindings.json` - custom keybindings
- `extensions/` - custom tools (websearch, handoff, notification, theme, edit-prompt, editor-open, editor-env, subagent, task, review, jj-footer)
- `skills/` - custom skills (pr-review-comments, resolve-pr-comment, commit)
- `PI_NVIM_RPC.md` - external editor rpc runbook/troubleshooting
- `prompts/` - custom prompts
- `agents/` - subagent definitions

## Configuration

Custom settings in `settings.json`:

| Setting | Description | Default |
|---------|-------------|---------|
| `promptsDir` | Directory for prompt files | `~/.pi/prompts` |
| `exaMcpEndpoint` | Exa AI MCP endpoint URL | `https://mcp.exa.ai/mcp` |

Example:

```json
{
  "promptsDir": "~/obsidian/vault/prompts/",
  "exaMcpEndpoint": "https://mcp.exa.ai/mcp"
}
```

## Extensions

### subagent

Delegate tasks to subagents with isolated context. Supports single, parallel, and chain modes.

Agents defined in `agents/*.md` with frontmatter (`name`, `description`, `tools`, `model`).

Based on [pi-coding-agent examples](https://github.com/mariozechner/pi-ai/tree/main/packages/coding-agent/examples/extensions/subagent).

### task

Spawn general-purpose subagents with isolated context. Inspired by Claude Code's Task tool.

Unlike subagent (which requires pre-defined agents), task allows ad-hoc workers with inline prompts.

- **Single:** `{ description: "..." }`
- **Parallel:** `{ tasks: [{ description: "..." }, ...] }` (max 10, 4 concurrent)
- **Per-task options:** `prompt`, `cwd`, `tools`, `model`

### edit-prompt

Opens your editor to edit prompt files (configurable via `promptsDir` setting).

**Usage:** `/edit` - First call opens file selector, subsequent calls reuse the file.

Two modes in file selector (toggle with `Ctrl+R`):
- **New File** (default): Type filename to create/open
- **Search**: Fuzzy search existing files (requires `fd`)

Uses `$EDITOR` → `$VISUAL` → nvim → vim → vi fallback chain.

### editor-open

Adds a custom `Ctrl+G` workflow for drafting prompts in your editor with reference context.

Behavior:
- Always includes the **last message content** as a reference section
- Adds a separate prompt section delimited by HTML comments
- Extracts and sends only the prompt section after save/quit
- If `/edit` has set an active file, prepends the section there (after frontmatter)
- Otherwise uses a temporary file

`keybindings.json` sets `externalEditor` to `[]`, so `Ctrl+G` is handled by this extension instead of pi's built-in external editor action.

### pi ↔ nvim rpc flow

`editor-env` sets `EDITOR`/`VISUAL` to `~/.config/nvim/bin/pi-nvim-editor` when available.

This gives `/handoff`, `/edit`, and `Ctrl+G` a deterministic host-aware external edit path:
- if pi runs inside nvim `:terminal`, edits open in the host nvim
- otherwise it falls back to local nvim

For caveats and debugging steps, see `PI_NVIM_RPC.md`.

### review

Code review against a jj bookmark (typically the PR base branch). Auto-detects the nearest ancestor bookmark of the current revision.

**Commands:** `/review [bookmark]`, `/end-review`

- `/review` — finds nearest parent bookmark, diffs against it
- `/review some-bookmark` — reviews against a specific bookmark
- `/end-review` — complete review, optionally summarize, and return to original session position

Supports fresh session mode: branches the session tree for an isolated review, then returns with a structured summary.

Requires jj (colocated with git).

### jj-footer

Reimplements the default footer and swaps the branch segment to show jj revision info (change ID, bookmarks, description), with fallback to the built-in git branch logic.

Enabled by default. Toggle with `/jj-footer` (`on`, `off`, `toggle`, `status`).

## Setup

```bash
mkdir -p ~/.pi/agent
git clone git@github.com:jorgeavaldez/pi-config.git ~/.pi/agent
cd ~/.pi/agent/extensions && npm install
```

Create `~/.pi/agent/auth.json` with your credentials (not tracked).
