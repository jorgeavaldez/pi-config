---
name: dump-overview-to-plan
description: Creates or updates a practical implementation or handoff plan in Jorge's Obsidian vault. Use when the user wants to dump findings into a plan, write a handoff plan, create an implementation plan, or update an existing plan document.
---

# Dump Overview to Plan

Create or update a practical, implementation-ready plan in the right vault location.

Do not assume all plans belong in `work/plans/`.
Personal technical projects should usually live under `projects/`.
Use path, current working directory, user wording, and related docs to route the plan.
Ask when the destination is unclear.

## Vault/location resolution

Prefer simple resolution:

1. If the user gave an explicit output path, use it.
2. If the current working directory is inside the Obsidian vault, use vault-relative paths there.
3. If the user names a known project/doc path, search the obvious vault paths.
4. If a minimal Obsidian config exists, it may be used as a fallback:
   - project override: `.pi/obsidian.json`
   - global fallback: `~/.pi/agent/obsidian.json`
5. If neither current directory nor config nor explicit path identifies the vault, STOP and ask.

Do not expand or depend on a large hardcoded directory map.
The vault paths are intentionally plain and intuitive.

## Destination rules

### Work plans

Use `work/plans/` for Nebari/Bari/work implementation plans and specs.
Work repos usually live under `~/proj/werk/`, but do not assume every repo there unless the task says so.

### Personal project plans

Use `projects/` for personal technical projects.
Prefer existing project files/directories when present.
Ask before creating a new project directory or if more than one destination is plausible.

Examples:

- `projects/jj-rebator/sparse-workspaces.md`
- `projects/pi-coding-agent/rpc-extension-ui-request-fix-plan.md`

### Garden/reference notes

Use `garden/` only when the output is durable reusable knowledge rather than a project execution plan.

## File selection rules

### If the user gave an explicit plan path
Use that exact path.

### If the user referenced an existing plan by name or topic
Search likely destinations first and reuse an existing matching file if there is a clear match.

Useful searches:

```bash
fd -t f "keyword" work/plans work/analysis work/docs work/reference work/overviews projects garden 2>/dev/null
rg -l "keyword" work projects garden prompts 2>/dev/null
```

Use the `obsidian` CLI for native search/tags/properties if available and simpler.
Do not depend on it.

### If no plan file was given
Infer a filename from the conversation and write it under the selected destination.

Filename rules:
- use the primary feature, subsystem, or task name
- convert to concise kebab-case
- prefer stable nouns over verbs
- append `-plan.md` for new work plans unless the existing pattern says otherwise
- avoid generic names like `implementation-plan.md`, `notes-plan.md`, or `update-plan.md`
- update a clearly related existing plan instead of creating a near-duplicate
- ask if there are two equally plausible destinations or names

## Workflow

1. Resolve the vault and destination before writing.
2. Read relevant code, docs, notes, and any existing plan file.
3. If a missing answer would materially affect the plan, STOP and ask.
4. Write or update the plan.
5. Do one self-review focused on blocker-level gaps, contradictions, and missing implementation details.
6. For unusually cross-cutting or high-risk work, make that review a distinct second pass and identify at most the top 5 blocker/high-risk issues.
7. Incorporate only material fixes.
8. Stop once the plan is implementation-ready.

## Required plan content

Include:
- a brief summary of what is being done and why
- a `Current Status` section directly below the summary covering:
  - done
  - in progress
  - blocked
  - next
- business/project context and requirements
- explicit IN scope / OUT of scope
- validated assumptions vs assumptions still needing validation
- relevant codebase file references using relative paths when possible
- key findings, observations, decisions, and implementation details that save the next engineer time
- a progress checklist mapped to phases and deliverables
- phased execution plan with, for each phase:
  - goal and description
  - files touched or created
  - approach and key details
  - acceptance criteria
  - dependencies / parallelism where relevant

## Writing rules

- Write a practical handoff plan, not a research transcript.
- Prefer path and wikilinks/backlinks over frontmatter metadata.
- Preserve work/personal boundaries.
- Remove material ambiguity, but do not chase perfection.
- Document unresolved non-blockers briefly in the relevant section.
- Keep the plan concise, integrated, and useful.
- Avoid duplication, implementation journals, append-only discovery dumps, and giant “changes from above” sections.
- Prefer blocker-level and high-risk information over low-value polish.
- Do not include full code implementations. Use short snippets only when they remove material ambiguity.
- When updating an existing plan, edit it so it reads as if it was always written that way.

## Review rules

For the optional second review pass:
- return at most 5 blocker/high-risk issues
- focus on contradictions, missing implementation details, auth/visibility gaps, dependency gaps, or places a receiving engineer would still need to rediscover core context
- ignore editorial nits
- do not repeat the pass unless it surfaced a real blocker that required a substantial rewrite

## Response to the user

When done, report:
- the plan file path
- whether it was created or updated
- a short summary of the plan contents
- any blocker questions that still need user input

Do not keep iterating once the plan is clear and implementation-ready.
