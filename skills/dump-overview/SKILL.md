---
name: dump-overview
description: Write a durable overview to Jorge's Obsidian vault. Use when the user wants to preserve a solved problem, completed task, implementation, investigation, technical discussion, learning, decision, or project context for future reference.
---

# Dump Overview

Turn the useful context from the conversation and relevant source material into a clear reference note in the Obsidian vault.

Use simplified technical English. Trust your judgment about organization and detail. Capture the meat of what matters for future understanding without reproducing the conversation or producing an exhaustive change log.

## Types of overview

Adapt the note to what the user is preserving. Common forms include:

- a problem or task that was solved;
- an implementation or change and why it was made;
- an investigation or technical discussion and its conclusions;
- a design decision and its trade-offs;
- a technical concept or lesson for future reference;
- a project or system overview;
- a durable handoff or current-state summary that belongs in the vault.

These are guides, not separate templates. Combine them when the conversation naturally spans more than one.

## Write for future understanding

Explain the problem or question, why it mattered, what was learned or changed, and the resulting outcome. Preserve decisions and their reasoning, the mental model needed to understand the solution, important constraints or trade-offs, and any remaining limitations or follow-up work.

Include code paths, commands, identifiers, validation results, or implementation details when they materially help future understanding. Summarize low-level specifics instead of cataloguing them. A files-changed table, fixed headings, or repository metadata are optional and should appear only when useful.

Clearly distinguish facts from assumptions, completed work from planned work, and checks that passed from checks that were not run. If something important is unknown, say so plainly.

## Vault placement and links

Resolve the vault from an explicit path or the `vaultPath` in the nearest `.pi/obsidian.json`, falling back to `~/.pi/agent/obsidian.json`. If the current directory is already inside that vault, use it directly. If the vault cannot be resolved, ask the user.

Choose the destination by the note's domain and purpose, using the vault's existing organization. Depending on the content, the right home may be project documentation, a work document, an overview, a reference or learning note, or a personal project area. Preserve work and personal boundaries. Inspect nearby notes and prefer updating a clear canonical note over creating a near-duplicate. Ask only when multiple placements are genuinely plausible.

Search the vault for directly relevant context. Use Obsidian wikilinks to connect the overview to existing plans, documentation, decisions, project notes, prompts, or reference material where those links help future navigation or understanding. Do not invent links merely to fill a related-notes section. Use normal Markdown links for external sources and inline code for repository paths.

Follow nearby vault conventions when useful, but do not force frontmatter, a rigid template, or reciprocal edits to other notes. Obsidian backlinks are usually enough.

## Finish

Review the note once for clarity, factual accuracy, missing context, unnecessary detail, and unexplained jargon. Fix material issues, then stop.

Tell the user where the overview was written, whether it was created or updated, and what it captures.
