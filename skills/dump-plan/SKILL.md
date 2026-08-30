---
name: dump-plan
description: Create or update a clear implementation plan in Jorge's Obsidian vault. Use when the user asks to dump, draft, save, or revise a plan for future work, execution, or delegation.
---

# Dump Plan

Turn the available context into a concise, implementation-ready plan and write it to the appropriate place in the Obsidian vault.

Use simplified technical English. Trust your judgment about structure and depth. Focus on the problem, the intended outcome, and the safest practical path to get there rather than filling out a fixed template.

## Understand the work

Reconstruct the goal from the conversation, the actual code or system state, and relevant project material. Treat existing plans, tickets, and notes as evidence rather than automatically copying their framing.

Inspect enough of the source and related vault notes to make the plan accurate. If a missing answer would materially change the outcome, scope, or implementation seam, ask before writing. Otherwise state the uncertainty briefly and proceed.

## Synthesize the plan

Explain what is being changed, why it matters, and the current state. Capture the decisions, constraints, assumptions, source references, and validation that an engineer needs in order to start safely without rediscovering the core context.

Give particular care to how the work is divided and ordered:

- Split work at real ownership, API, data, deployment, or review boundaries.
- Prefer small, atomic outcomes that are independently reviewable and useful when completed.
- Make dependencies and required ordering clear.
- Identify work that can safely happen in parallel.
- Describe delegation boundaries clearly enough that another agent or engineer can take a chunk without hidden context.
- Keep each chunk achievable in one focused implementation session when practical.
- Separate required enabling work from optional future goals.
- When a future direction matters, make the hard change easier now through a clean seam or canonical owner without building speculative architecture.

Use whatever headings best fit the work. A useful plan will usually make the goal, relevant context, scope, execution sequence, completion checks, risks, and unresolved decisions easy to find, but not every plan needs a section for each.

Do not include full implementations or turn the plan into a research transcript. Include concrete file or component references and short examples only when they remove meaningful ambiguity.

## Vault placement and links

Resolve the vault from an explicit path or the `vaultPath` in the nearest `.pi/obsidian.json`, falling back to `~/.pi/agent/obsidian.json`. If the current directory is already inside that vault, use it directly. If the vault cannot be resolved, ask the user.

After resolving it, locate and read the vault's applicable agent/context instructions, following local context-file indirections, before choosing personal-project placement or links. Treat those local instructions as authoritative.

Choose the destination by inspecting how the same project and kind of work are already organized. Keep work and personal material separate. Prefer updating a clearly related existing plan over creating a duplicate; otherwise choose a concise topic-based filename. Ask only when multiple placements are genuinely plausible.

Search for useful internal context and use Obsidian wikilinks to connect the plan to existing project documentation, prior plans, overviews, decisions, or reference notes. Link only material that helps explain or execute the work. Use normal Markdown links for external sources and inline code for repository paths.

For a scoped personal-project plan, use the local instructions and nearby organization to find the existing stable project home. Place the plan in the project's established area and add a useful wikilink from the plan back to that home. Use the home—not the scoped plan—for links that express generic project identity; keep the plan as task-specific evidence. Backlinks are enough for normal discovery, so do not require a complete manually synchronized plan index or a reciprocal home edit.

Update the home only when the new plan changes the project's durable identity or stable mental model/navigation, or is a genuinely foundational record. Do not update it for volatile status, task lists, roadmaps, or every new plan. Do not create a home just to satisfy this convention for a one-off project; ask when project identity or placement is genuinely ambiguous.

Follow nearby vault conventions when they are useful, but do not add metadata or sections merely for consistency.

## Finish

Review the result once for incorrect assumptions, missing dependencies, unsafe sequencing, unclear delegation seams, and blocker-level gaps. Fix material issues, then stop.

Tell the user where the plan was written, whether it was created or updated, what it prepares, and any unresolved blocker.
