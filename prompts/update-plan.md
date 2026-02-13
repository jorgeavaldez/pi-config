---
description: Update plan file status
---
update the plan file to reflect the work you just completed.

this is a TARGETED update, not an append-only dump.
the plan must stay concise and useful as a handoff document — if it balloons with noise, it loses its value as directed context for agents and humans coming up to speed.

guidelines for what to change:

- **current status section**: update to reflect where things stand now — what's done, what's in progress, what's blocked, and what's next.
- **progress checklist**: check off completed items. add new deliverables ONLY if they are real work items, not just things you happened to touch.
- **completed phases**: do NOT rewrite or pad completed phase details. they serve as a record of what was done. if you discovered something important during implementation, add a brief note — don't restructure the section.
- **upcoming phases**: if your work caused meaningful drift (changed contracts, shifted dependencies, invalidated assumptions), surgically update the affected details in those phases. do NOT rewrite phases you didn't affect.
- **cascading changes**: if a contract, interface, or assumption changed, update the specific line where it's referenced. don't duplicate the information in a new section.
- **new context**: if you learned something that a future implementer needs to know, add it in the most relevant existing section — near the phase or contract it relates to. avoid creating new top-level sections unless there's genuinely no home for the information.

what NOT to do:
- do NOT append a big "changes from phase N" narrative section at the bottom.
- do NOT duplicate information that already exists in the plan.
- do NOT add verbose commentary or implementation journals — keep it factual and terse.
- do NOT pad sections with filler. if nothing changed in a section, leave it alone.
- do NOT grow the plan. if you're adding lines, ask yourself whether you're also removing or tightening lines elsewhere to compensate.

provide any guidance, notes, or feedback that may be useful for the implementer of the remaining phases — but do it inline where relevant, not as a separate block.

the goal: after your update, the plan should read as if it was always written this way. clean, integrated, no seams.
