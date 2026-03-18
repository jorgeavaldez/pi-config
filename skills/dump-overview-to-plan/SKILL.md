---
name: dump-overview-to-plan
description: Creates or updates a practical implementation or handoff plan in Jorge's Obsidian vault. Use when the user wants to dump findings into a plan, write a handoff plan, create an implementation plan, or update an existing plan document.
---

# Dump Overview to Plan

Create or update a practical, implementation-ready plan in the Obsidian plans directory configured in Obsidian config.

Config files:
- project override: `.pi/obsidian.json`
- global fallback: `~/.pi/agent/obsidian.json`

Resolve the plans directory in this order:
1. read `~/.pi/agent/obsidian.json` if it exists
2. read `.pi/obsidian.json` from the current project if it exists
3. merge them with project values overriding global values
4. use merged `plansDir` if present
5. otherwise, if merged `vaultPath` is present, derive `plansDir = <vaultPath>/work/plans`
6. if neither value is available, STOP and ask the user

Prioritize signal over exhaustiveness. The goal is a useful handoff document, not a giant research dump.

## File selection rules

### If the user gave an explicit plan path
Use that exact path.

### If the user referenced an existing plan by name or topic
Search the plans directory first and reuse the existing matching file if there is a clear match.

Use `bash` to inspect likely matches in the resolved `plansDir`, for example:

```bash
find "$PLANS_DIR" -maxdepth 1 -type f | sort
```

### If no plan file was given
Infer a filename from the conversation and write the file under:

- `<resolved plansDir>/<inferred-name>.md`

Filename rules:
- use the primary feature, subsystem, or task name from the conversation
- convert to concise kebab-case
- prefer stable nouns over verbs
- append `-plan.md` for new plan files unless the conversation clearly implies another established naming pattern
- avoid generic names like `implementation-plan.md`, `notes-plan.md`, or `update-plan.md`
- if there is a clearly related existing plan, update it instead of creating a near-duplicate
- if there are two equally plausible names and choosing incorrectly would be confusing, STOP and ask the user

Examples:
- `poll status refresh endpoint` → `poll-status-refresh-plan.md`
- `infra map orchestration workflow` → `infra-map-orchestration-plan.md`
- `slack canvas sync` → `slack-canvas-sync-plan.md`

## Workflow

1. Resolve Obsidian config and determine `plansDir` before selecting or writing a plan file.
2. Read the relevant code, docs, notes, and any existing plan file.
3. If a missing answer would materially affect the plan, STOP and ask the user. Do not guess.
4. Write or update the plan in the resolved plans directory.
5. Do one self-review focused only on blocker-level gaps, contradictions, or missing implementation details.
6. Optionally run at most one review task only if the work is unusually cross-cutting or high-risk.
7. If you run a review task, ask it for at most the top 5 blocker/high-risk issues.
8. Incorporate only material fixes.
9. STOP once the plan is implementation-ready. Do not loop on repeated reviews or micro-edits.

## Required plan content

Include:
- a brief summary of what is being done and why
- a `Current Status` section directly below the summary covering:
  - done
  - in progress
  - blocked
  - next
- business context and requirements
- explicit IN scope / OUT of scope
- validated assumptions vs assumptions still needing validation
- relevant codebase file references using relative paths
- key findings, observations, decisions, and implementation details that save the next engineer time
- a progress checklist mapped to phases and key deliverables
- phased execution plan with, for each phase:
  - goal and description
  - files touched or created
  - approach and key details
  - acceptance criteria
  - dependencies / parallelism where relevant

## Writing rules

- Write a practical handoff plan, not a full research transcript.
- Remove material ambiguity, but do not chase perfection.
- If something is unresolved but non-blocking, document it briefly in the most relevant section instead of expanding the plan.
- Keep the plan concise, integrated, and useful.
- Avoid duplication, implementation journals, append-only discovery dumps, and giant “changes from above” sections.
- Prefer blocker-level and high-risk information over low-value polish.
- Do not include full code implementations. Use short snippets only when they remove material ambiguity.
- When updating an existing plan, edit it so it reads as if it was always written that way.

## Review-task rules

If you use a `task` review:
- ask for filtered findings only
- ask for the top blocker/high-risk issues only
- do not ask for exhaustive nitpicks
- do not chain multiple review tasks
- do not re-run review unless the first review surfaced a real blocker that required a substantial rewrite

Example review prompt shape:

```text
Read <plan-file>. Return at most 5 blocker/high-risk issues only. Focus on contradictions, missing implementation details, auth/visibility gaps, dependency gaps, or places a receiving engineer would still need to rediscover core context. Ignore editorial nits.
```

## Response to the user

When done, report:
- the plan file path
- whether it was created or updated
- a short summary of the plan contents
- any blocker questions that still need user input

Do not keep iterating once the plan is clear and implementation-ready.
