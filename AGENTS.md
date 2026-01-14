# Critical Rules

## Git Operations - NEVER DO THESE UNLESS EXPLICITLY ASKED

- **NEVER** run `git add`, `git commit`, `git push`
- **NEVER** create branches
- **NEVER** perform any git operations on behalf of the user

Only perform git operations when the user EXPLICITLY requests them.

## Asking Clarifying Questions

Use the `draft_questions` tool when you need clarifying information from the user before proceeding:

- **When to use**: If you need user input to complete a task correctly (e.g., ambiguous requirements, missing details, or choices that require user preference)
- **Single call only**: Include ALL your questions in a single `draft_questions` call — calling it again will overwrite any previously drafted questions
- **User response**: The user will review your questions and respond via the `/answer` command
