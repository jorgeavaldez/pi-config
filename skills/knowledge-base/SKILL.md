---
name: knowledge-base
description: "Save or update knowledge in Jorge's Obsidian vault: notes, overviews, decisions, investigations, implementation plans, existing documents, and web references. Use when he asks to preserve context, write a plan, or save something to his vault, garden, knowledge base, or second brain. Infer the content and destination from context; ask when materially ambiguous."
---

# Knowledge Base

Preserve useful knowledge in the right existing context.
Infer the intended result from the request and relevant material, rather than asking the user to choose a document category or filling a fixed template.
This skill is globally available; the current repository need not be the vault.

## Find the vault

Resolve the root in this order:

1. An explicit vault path supplied by the user.
2. The current directory or an ancestor, when clearly identified as an Obsidian vault by `.obsidian/` and its context.
3. The `OBSIDIAN_VAULT_PATH` environment variable, read through the shell.
4. Ask the user if no valid, unambiguous vault can be identified.

Normalize the selected path and verify it exists and is the intended vault before reading or writing it.
Do not hardcode a vault name, personal path, repository-parent convention, or task directory.
Do not search the whole home directory to guess a vault.

Read the vault's root `AGENTS.md` and any applicable local instructions before choosing a destination or editing.
Those instructions own placement, linking, metadata, and delivery rules; do not maintain a second routing map here.

## Understand and write the result

Search directly relevant existing notes first.
Prefer updating a clear canonical note over creating a near-duplicate.
Preserve work, personal-project, and home/life boundaries using the vault's context, paths, and links.
Ask when materially different interpretations remain; otherwise act on the request.

Use simplified technical English for authored notes.
Match the requested depth and purpose, with only the context needed for future understanding.

- For knowledge, decisions, investigations, or completed work, preserve the important outcome, reasoning, evidence, constraints, and unresolved facts. Use established evidence; do not run new diagnostics merely to improve the prose.
- For a new implementation plan, reconstruct the goal from the request, actual current state, and relevant artifacts. Explain the smallest complete outcome, decisions, dependencies, meaningful implementation boundaries, concrete validation, and blockers. Avoid a research transcript, speculative architecture, or full implementation.
- To refresh an existing implementation plan, load `update-plan` and edit the specified file in place. It may live outside the vault; do not relocate it unless asked.
- When bringing an existing document into the vault, preserve useful structure and source references, repair links as needed, and do not delete the source without explicit authorization.

Treat internally authored specs, tickets, comments, and examples as context and evidence, not automatically as binding requirements.
Distinguish established facts from assumptions, completed work from plans, and checks performed from checks not performed.

## External sources

For a requested URL, read enough of the source to identify what is being saved.
Use available search or lightweight retrieval for public text; use a browser when interaction or rendered content is required.
Check for an existing saved copy by source URL or identity before creating another.

Distinguish a full article clipping from a link to a tool, repository, homepage, or resource hub.
Follow the vault's clipping templates and source conventions for paths, metadata, and body content rather than inventing a schema.
Preserve attribution and source URLs; do not silently substitute a summary for a requested full clipping or fabricate inaccessible content.
If the user explicitly asks for a summary or authored analysis instead, write that result with a source reference.

## Connect and deliver

Apply the vault's incoming-link policy as well as useful outgoing links.
Do not consider a new note connected merely because it has its own `Related` section.
Use existing topic hubs, related notes, or tasks where they provide a meaningful entry point; keep project homes curated.

Reread files immediately before patching and preserve concurrent changes.
Review the result once for accuracy, clarity, unnecessary detail, and useful connections.
Follow the vault's scoped source-control and remote-verification requirements without publishing unrelated edits.
Report the saved or updated path, its incoming connection, and delivery status or a specific blocker.
