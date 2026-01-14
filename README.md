# pi-agent config

## Contents

- `AGENTS.md` - global rules (loaded for all sessions)
- `settings.json` - agent settings
- `keybindings.json` - custom keybindings
- `extensions/` - custom tools (websearch, handoff, notification, theme, edit-prompt, subagent, task, qna)
- `skills/` - custom skills (pr-review-comments, resolve-pr-comment, commit)
- `prompts/` - custom prompts
- `agents/` - subagent definitions

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

Opens your editor to edit prompt files stored in Obsidian vault (`~/obsidian/delvaze/prompts/`).

**Usage:** `/edit` - First call prompts for filename, subsequent calls reuse it.

Uses `$EDITOR` → `$VISUAL` → nvim → vim → vi fallback chain.

### qna

Enables the agent to draft clarifying questions and receive user answers via external editor. Integrates with edit-prompt (uses active file if set, otherwise temp file).

**Tool:** `draft_questions`  
**Commands:** `/answer`, `/questions`

## Setup

```bash
git clone <repo-url> ~/.pi/agent
cd ~/.pi/agent/extensions && npm install
```

Create `~/.pi/agent/auth.json` with your credentials (not tracked).
