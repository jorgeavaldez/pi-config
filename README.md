# pi-agent config

## Contents

- `AGENTS.md` - global rules (loaded for all sessions)
- `settings.json` - agent settings
- `keybindings.json` - custom keybindings
- `extensions/` - custom tools (websearch, handoff, notification, theme, edit-prompt, subagent, task)
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

Opens neovim to edit prompt files stored in Obsidian vault (`~/obsidian/delvaze/prompts/`).

**Usage:** `/edit`

- First call prompts for filename, subsequent calls reuse it
- Creates markdown files with Obsidian-compatible frontmatter
- Prepends timestamped sections (newest first)
- Executes the prompt after saving

### qna

Enables the agent to draft clarifying questions and receive user answers asynchronously. Questions appear inline in the session and in the status bar.

**Tool:** `draft_questions` - Agent drafts questions for the user to review

**Commands:**
- `/questions` - View currently drafted questions
- `/answer` - Provide answers to the drafted questions

## Setup

```bash
git clone <repo-url> ~/.pi/agent
cd ~/.pi/agent/extensions && npm install
```

Create `~/.pi/agent/auth.json` with your credentials (not tracked).
