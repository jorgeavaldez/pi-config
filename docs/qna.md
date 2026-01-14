# Q&A Extension

The Q&A extension provides a structured workflow for the LLM to ask clarifying questions and receive user answers through an external editor.

## Overview

When the LLM needs additional information before proceeding, it can use the `draft_questions` tool to draft questions. The user then runs `/answer` to open their preferred editor, write responses, and send them back to the conversation.

This creates a clean separation between:
- **Agent asking** → Uses `draft_questions` tool
- **User answering** → Uses `/answer` command with external editor

## Usage

### Tool: `draft_questions`

The LLM calls this tool when it needs clarification:

```typescript
// The tool accepts a single "questions" parameter (plain text)
draft_questions({
  questions: `1. What database should we use?
2. Do you prefer TypeScript or JavaScript?
3. What's the target deployment environment?`
})
```

**Important**: Calling `draft_questions` OVERWRITES any previously drafted questions. Include all questions in a single call.

### Commands

| Command | Description |
|---------|-------------|
| `/answer` | Open your editor to answer pending questions |
| `/questions` | View pending questions without opening editor |

### Display

When `draft_questions` is called, questions are rendered inline in the session with nice formatting:

```
┌─ ❓ Questions ─────────────────────────────────────────┐
│                                                        │
│   1. What database should we use?                      │
│   2. Do you prefer TypeScript or JavaScript?           │
│   3. What's the target deployment environment?         │
│                                                        │
│   Run /answer to respond                               │
│                                                        │
└────────────────────────────────────────────────────────┘
```

The bordered box with emoji header makes pending questions easy to spot in the conversation. The hint at the bottom reminds you how to respond.

### Typical Workflow

1. You ask the agent to do something
2. Agent realizes it needs more information
3. Agent calls `draft_questions` with its questions
4. Status bar shows: `❓ Questions pending - /answer to respond`
5. You run `/answer`
6. Editor opens with questions and an answer section
7. You write your responses below `# Answers`, save and quit
8. Responses are sent as a user message
9. Agent continues with the information

### Skipping Questions

If you send a new prompt without calling `/answer`, pending questions are automatically cleared and the conversation continues normally. This is useful when you change your mind or the questions become irrelevant.

## File Format

When `/answer` opens the editor, it creates a temporary markdown file:

```markdown
# Questions

1. What database should we use?
2. Do you prefer TypeScript or JavaScript?
3. What's the target deployment environment?

# Answers

```

Write your responses below the `# Answers` delimiter:

```markdown
# Questions

1. What database should we use?
2. Do you prefer TypeScript or JavaScript?
3. What's the target deployment environment?

# Answers

1. PostgreSQL
2. TypeScript with strict mode
3. AWS Lambda with API Gateway
```

**Rules:**
- The `# Answers` delimiter must remain in the file
- Only content below `# Answers` is sent to the LLM
- Empty responses (nothing below delimiter) cancel the answer
- The questions section is for reference only (edits are ignored)

## State Management

The extension persists question state across sessions using pi's branch history:

### How State is Tracked

1. **Draft**: When `draft_questions` is called, the questions are stored in the tool result's `details` field
2. **Clear**: When questions are answered or skipped, a `qna-clear` custom entry is appended to the branch

### Session Restore

On `session_start`, the extension walks the branch history:
1. Finds the last `draft_questions` tool result
2. Checks if a subsequent `qna-clear` entry exists
3. If questions exist and weren't cleared → restores pending state
4. Updates status indicator accordingly

### Clear Reasons

The `qna-clear` entry tracks why questions were cleared:
- `"answered"` - User provided responses via `/answer`
- `"skipped"` - User sent a new prompt, ignoring questions

## Editor Support

### Environment Variables

The extension checks these in order:
1. `$EDITOR`
2. `$VISUAL`
3. Falls back to `nvim` → `vim` → `vi`

### Cursor Positioning

For a better UX, the editor opens with cursor at the end of file:

| Editor | Arguments |
|--------|-----------|
| vim/nvim/vi | `+ filename` |
| nano | `+9999 filename` |
| emacs | `+9999 filename` |
| others | `filename` (no positioning) |

### TUI Integration

The `/answer` command properly suspends the TUI before spawning the editor:
1. Calls `tui.stop()` to release terminal
2. Clears screen
3. Spawns editor with `stdio: "inherit"`
4. Restores TUI after editor exits

## Configuration

The extension has no configuration options. Behavior is controlled via:

- **`$EDITOR`** - Set your preferred editor
- **`$VISUAL`** - Fallback editor (for GUI editors)

Example in your shell profile:
```bash
export EDITOR="nvim"
# or
export EDITOR="code --wait"  # VS Code (--wait is required)
```

## When to Use `draft_questions`

### Good Use Cases

1. **Ambiguous requirements**
   ```
   User: "Add authentication to my app"
   Agent: What auth method? OAuth, JWT, session-based?
   ```

2. **Missing critical information**
   ```
   User: "Deploy this to production"
   Agent: Which cloud provider? What region?
   ```

3. **Design decisions**
   ```
   User: "Create a database schema"
   Agent: Relational or NoSQL? What's the expected scale?
   ```

4. **Confirming destructive actions**
   ```
   User: "Clean up the codebase"
   Agent: Should I delete unused files? Modify package.json?
   ```

### When NOT to Use

- Simple yes/no questions → Just ask inline
- Optional clarifications → Make reasonable assumptions, mention them
- Information available in context → Read files/docs first
- When you can proceed with defaults → Do so and explain choices

### Formatting Questions

The `questions` parameter accepts plain text. Format for clarity:

```
# Numbered list (good for sequential questions)
1. What database?
2. What framework?
3. What deployment target?

# Bullet points (good for independent questions)
- Preferred testing framework?
- Code coverage requirements?
- CI/CD platform?

# Prose (good for context-heavy questions)
I noticed the project uses both REST and GraphQL endpoints.
Should new features follow REST conventions, or would you
prefer to migrate toward GraphQL?
```

## Examples

### Basic Q&A Flow

```
You: Create a REST API for user management

Agent: [calls draft_questions]
  1. Which framework: Express, Fastify, or Hono?
  2. Database: PostgreSQL, MySQL, or MongoDB?
  3. Authentication: JWT, sessions, or OAuth?

[Status: ❓ Questions pending - /answer to respond]

You: /answer
[Editor opens, you write answers, save and quit]

Agent: [continues with your specifications]
```

### Viewing Without Answering

```
[Status: ❓ Questions pending - /answer to respond]

You: /questions
[Shows questions in notification or select dialog]

You: Actually, let's do something else instead
[Questions automatically cleared, new task proceeds]
```

### Session Persistence

```
[Session 1]
Agent: [calls draft_questions]
You: [close pi without answering]

[Session 2 - same branch]
[Status: ❓ Questions pending - /answer to respond]
You: /answer
[Questions restored, can still answer]
```

## Related

- **`question` tool** (examples/extensions/question.ts) - For simple multiple-choice questions with UI selector
- **`qna` command** (examples/extensions/qna.ts) - Extracts questions from assistant messages into editor
