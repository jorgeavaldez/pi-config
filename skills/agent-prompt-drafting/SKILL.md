---
name: agent-prompt-drafting
description: Draft concise, context-bounded prompts for another agent. Use when Jorge asks for an investigation, planning, review, implementation, or follow-up handoff. Preserve his scope and context, include relevant existing artifacts, and return a complete usable prompt.
---

# Agent Prompt Drafting

Write the prompt for the work Jorge actually requested.
This skill owns prompt wording, not workspace setup or agent startup.
Return the prompt in chat unless Jorge requests another destination.

## Understand the request

Identify the intended outcome, the kind of work requested, and the context the recipient needs.
Use Jorge's words, corrections, and approved decisions to interpret tickets, plans, and other source material.
An internal document is context, not automatically a complete or correct specification.
If different interpretations would materially change the work, ask before drafting.

Read enough to carry the task accurately; leave the requested investigation to its recipient.
Preserve additional guidance Jorge supplies, including what he wants simplified or left out.
If the conversation or artifact he references is outside this session, read the relevant part rather than assuming its contents.

## Keep the handoff small and complete

Aim for one bounded question or independently useful implementation outcome that fits a focused session.
If the request bundles materially different outcomes, suggest a smaller first outcome for Jorge to choose.
Do not make a recipient responsible for watching its own context usage.

Usually 150–350 words is enough; use more only when the actual task needs it.
Include:

- The goal and whether this is investigation, planning, review, or implementation.
- The approved scope and important boundaries.
- The task/ticket and directly relevant existing artifacts.
- Known findings or decisions that the recipient would otherwise have to rediscover.
- The actual workspace and revision when known, distinguishing them from where earlier investigation happened.
- What may be edited and what source-control or external actions Jorge authorized.
- The requested result and any concrete condition that requires clarification.

These are information needs, not mandatory headings or a form to fill out.
Describe outcomes and meaningful constraints rather than prescribing every file, command, or internal step.
Trust the recipient to inspect current source and choose the smallest correct implementation.

## Existing artifacts and source anchors

Include a relevant plan when it exists, even if the ticket is self-contained.
For a local Obsidian plan, provide both a wikilink for Jorge and an absolute path the agent can read.
Identify the relevant sections, including shared checks or exclusions when they matter.
For example:

```text
Plan: [[work/plans/example#3. History and results|History and results plan]]
File: /Users/jorge/obsidian/delvaze/work/plans/example.md
Read §3 for this change and §5 for its checks.
```

Use a small number of code references as orientation, not an exhaustive file allowlist.
Pass findings and decisions, not the entire investigation transcript.
Distinguish source inspection, runtime verification, inference, and remaining uncertainty.
Refresh stale facts such as the destination, revision, and whether implementation has started.

Private vault paths belong in the handoff, not in shared Jira or PR content.
When the recipient runs on another host, resolve a readable artifact location rather than assuming a local path exists there.
A saved plan is useful context, not a prerequisite: a clear approved outcome supplied in conversation can be handed off directly.

## Investigation or planning

Ask for concise, simplified technical English, using short bullets:

- What exists today.
- What is missing for the requested outcome.
- What can be done with small changes.
- What would require larger work.
- What is in scope and out of scope.
- Any real question Jorge needs to answer.

Adapt those bullets to the actual question rather than requiring an exhaustive report.
Separate Jorge's settled scope from recommendations that still need his decision.
For planning, add a short proposed implementation order and meaningful dependencies when needed.
The result belongs in the conversation so Jorge can discuss and refine it.
Durable documents and ticket changes are separate requests.

Example:

```text
Investigate <outcome> in <repository>. Read-only; leave files and source control unchanged.
Context: <ticket/docs and Jorge's additional guidance>.
Explain what already exists, what is missing, and the smallest changes needed.
Separate that from larger work outside <approved boundary>.
Use concise, simplified technical-English bullets, with concrete source references where useful.
Call out any scope decision you need from me.
```

## Implementation

State the approved outcome directly and include existing plan sections when available.
Summarize only the current-state facts and boundaries needed to begin.
Include focused tests and checks as part of delivering the behavior, not as a separate process.
State actual edit permissions; implementation does not itself authorize commits, bookmarks, pushes, or opening a PR.

Example:

```text
Implement <approved outcome> in <workspace and revision>.
Context: <ticket, plan link/path/sections, and Jorge's guidance>.
Keep this change limited to <scope>. Preserve <important existing behavior>.
Recheck current source, implement the behavior and focused tests, and prepare the change for review.
Leave source-control mutations and PR publication for separate authorization.
Report changed behavior, checks run, and blockers concisely.
Ask if completing the outcome requires work beyond the approved scope.
```

## Review and follow-ups

For review, identify what to review and the concerns that matter.
Request actionable findings with file references and a concise verdict; make clear whether edits are requested.
For a follow-up, carry the specific correction and enough context to make it understandable on its own.
Honor references to a particular existing conversation rather than silently substituting another.

## Revise and finish

When Jorge revises the handoff, return the entire updated prompt unless he explicitly asks for only a snippet.
Integrate corrections, links, and scope decisions into one copy-paste-ready version.
Check it once for missing context, stale facts, accidental scope growth, and unnecessary procedure.
Prefer short sentences and bullets; omit repetitive exclusions and generic instructions the repository already supplies.
Then present the prompt. Saving or sending it is a separate requested action.
