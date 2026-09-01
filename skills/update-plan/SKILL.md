---
name: update-plan
description: Update an existing implementation plan after work is completed so it remains a concise, accurate handoff. Use when the user asks to update or refresh a plan's status, progress, completed work, or next steps.
---

# Update Plan

Update the plan file to reflect the work just completed.

This is a targeted update, not an append-only dump. The plan must stay concise and useful as a handoff document. If it balloons with noise, it loses its value as directed context for agents and humans coming up to speed.

## What to change

- **Current status:** Update it to reflect where things stand now—what is done, in progress, blocked, and next.
- **Progress checklist:** Check off completed items. Add new deliverables only when they are real work items, not merely things touched during implementation.
- **Completed phases:** Do not rewrite or pad completed phase details. They serve as a record of what was done. If implementation revealed something important, add a brief note without restructuring the section.
- **Upcoming phases:** If the work caused meaningful drift, such as changed contracts, shifted dependencies, or invalidated assumptions, surgically update the affected details. Do not rewrite unaffected phases.
- **Cascading changes:** If a contract, interface, or assumption changed, update the specific line where it is referenced instead of duplicating the information in a new section.
- **New context:** Add information a future implementer needs in the most relevant existing section, near the phase or contract it concerns. Create a top-level section only when the information genuinely has no existing home.

## What not to do

- Do not append a large “changes from phase N” narrative section.
- Do not duplicate information already present in the plan.
- Do not add verbose commentary or an implementation journal. Keep it factual and terse.
- Do not pad sections with filler. Leave unchanged sections alone.
- Do not grow the plan unnecessarily. When adding lines, look for outdated or redundant material that can be removed or tightened.

Provide useful guidance, notes, or feedback for implementers of the remaining phases inline where relevant, not as a separate block.

After the update, the plan should read as if it were always written that way: clean, integrated, and seamless.
