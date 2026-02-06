# Task Tool

Spawn general-purpose subagents to handle tasks in isolated context windows.

Inspired by Claude Code's Task tool from the Agent SDK, this tool allows the main agent to spawn ad-hoc workers with custom prompts for any task—without requiring pre-defined agent configuration files.

## Features

- **General-purpose**: Each task gets full tool access by default (read, bash, edit, write, etc.)
- **Isolated context**: Each task runs in a separate `pi` process with its own context window
- **Extension-free subprocesses**: Spawned processes run with `--no-extensions` for clean, fast execution
- **Parallel execution**: Run up to 10 tasks in parallel (4 concurrent)
- **Custom prompts**: Optionally provide extra instructions per task
- **Streaming output**: See tool calls and progress as they happen
- **Usage tracking**: Shows turns, tokens, cost, and context usage per task

## When to Use

- **Parallel research**: Search different parts of a codebase simultaneously
- **Independent analyses**: Run security, performance, and style checks concurrently
- **Divide and conquer**: Break complex tasks into smaller independent pieces
- **Context isolation**: Work with large files without filling up main context
- **Exploration**: Quickly investigate multiple hypotheses in parallel

## Usage

### Single Task

Delegate one task to an isolated subagent:

```json
{
  "description": "Find all authentication-related code and summarize the auth flow"
}
```

With custom instructions:

```json
{
  "description": "Analyze the caching implementation",
  "prompt": "Focus on cache invalidation patterns and potential race conditions. Be concise."
}
```

### Parallel Tasks

Run multiple tasks concurrently:

```json
{
  "tasks": [
    { "description": "Find all REST API endpoints" },
    { "description": "Find all database models" },
    { "description": "Find all authentication middleware" }
  ]
}
```

With per-task customization:

```json
{
  "tasks": [
    {
      "description": "Review error handling in src/api/",
      "prompt": "Focus on exception types and recovery patterns",
      "tools": ["read", "grep", "find"]
    },
    {
      "description": "Check test coverage for auth module",
      "cwd": "./tests"
    }
  ]
}
```

## Parameters

### Single Task Mode

| Parameter | Type | Description |
|-----------|------|-------------|
| `description` | string | **Required.** What the task should accomplish |
| `prompt` | string | Extra instructions appended to system prompt |
| `cwd` | string | Working directory (defaults to current) |
| `tools` | string[] | Limit available tools (defaults to all) |
| `model` | string | Model to use (defaults to current) |

### Parallel Mode

| Parameter | Type | Description |
|-----------|------|-------------|
| `tasks` | array | Array of task objects (max 10) |

Each task object supports: `description`, `prompt`, `cwd`, `tools`, `model`

## Examples

### Codebase Research

```
Use the task tool to run 3 parallel searches:
1. Find all database queries and note which ones lack indexes
2. Find all API endpoints that don't have rate limiting
3. Find all places where user input is used in SQL queries
```

### Multi-file Analysis

```
Use tasks to analyze these files in parallel:
- src/auth/login.ts - check for security issues
- src/auth/session.ts - review session handling
- src/auth/tokens.ts - verify token generation is secure
```

### Divide and Conquer

```
I need to refactor the payment module. Use parallel tasks to:
1. Map out the current payment flow
2. Identify all external payment provider integrations  
3. Find all places that handle payment errors
4. List all payment-related database tables
```

## Output

**Collapsed view** (default):
- Status icon (✓/✗/⏳) and task count
- Task descriptions with progress
- Last 5 tool calls per task
- Usage stats

**Expanded view** (Ctrl+O):
- Full task descriptions and prompts
- All tool calls with formatted arguments
- Final output rendered as Markdown
- Per-task and aggregate usage

## Comparison with Subagent Tool

| Feature | Task Tool | Subagent Tool |
|---------|-----------|---------------|
| Agent definition | Not needed | Required (.md files) |
| Custom prompts | Inline per-task | Pre-defined |
| Primary use | Ad-hoc parallel work | Specialized workflows |
| Tool access | Full by default | Configurable per agent |
| Chaining | Not supported | Supported |

Use **Task** for ad-hoc parallel work. Use **Subagent** for reusable specialized agents with defined workflows.

## Limits

- Maximum 10 parallel tasks
- 4 concurrent executions
- Each task has its own context window (isolated from main and other tasks)
- Tasks cannot communicate with each other during execution
- Subprocesses run without extensions (`--no-extensions`) — only built-in tools are available

## Error Handling

- **Exit code != 0**: Task failed, stderr/output returned
- **stopReason "error"**: LLM error propagated with message
- **stopReason "aborted"**: User abort (Ctrl+C) kills all tasks with SIGTERM, escalating to SIGKILL after 5s
- **Partial failures**: In parallel mode, if one task fails fatally, no new tasks are started; already-running tasks finish naturally
- **Signal-killed processes**: Processes terminated by signals are correctly reported as failures (exit code 1)
