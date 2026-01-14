# pi-agent config

## Contents

- `settings.json` - agent settings
- `keybindings.json` - custom keybindings
- `extensions/` - custom tools (websearch, handoff, notification, theme, edit-prompt, subagent)
- `skills/` - custom skills (pr-review-comments, resolve-pr-comment)
- `prompts/` - custom prompts
- `agents/` - subagent definitions

## Extensions

### subagent

Delegate tasks to subagents with isolated context. Supports single, parallel, and chain modes.

Agents defined in `agents/*.md` with frontmatter (`name`, `description`, `tools`, `model`).

Based on [pi-coding-agent examples](https://github.com/mariozechner/pi-ai/tree/main/packages/coding-agent/examples/extensions/subagent).

### edit-prompt

Opens neovim to edit prompt files stored in Obsidian vault (`~/obsidian/delvaze/prompts/`).

**Usage:** `/edit`

- First call prompts for filename, subsequent calls reuse it
- Creates markdown files with Obsidian-compatible frontmatter
- Prepends timestamped sections (newest first)
- Executes the prompt after saving

## Setup

```bash
git clone <repo-url> ~/.pi/agent
cd ~/.pi/agent/extensions && npm install
```

Create `~/.pi/agent/auth.json` with your credentials (not tracked).
