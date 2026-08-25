---
name: pre-compaction-handoff
description: Creates a free-form, in-chat handoff from the active Pi session before the user manually runs /compact. Use when the user asks for a pre-compaction overview, sitrep, full rundown, context checkpoint, or briefing. Relays the important work and continuation context without imposing a fixed template, writing a document, or running compaction.
---

# Pre-Compaction Handoff

Give the user the best handoff you can from all context currently available so work can continue after they run `/compact` themselves.

Review the active conversation and relevant tool or delegated-agent results. Use read-only inspection only when it would materially improve the accuracy of mutable facts such as repository state. Do not turn the handoff into a new audit or resume the work.

Explain what the user is trying to accomplish, what you did, what you found, what was decided, what is happening now, what remains, what should happen next, and how to proceed. Include any constraints, evidence, changed files, validation results, identifiers, recovery details, blockers, risks, assumptions, or open questions that would prevent rediscovery or mistakes. This is guidance, not a checklist: include any other detail that matters and omit anything irrelevant.

Use your judgment to organize the response for the task. There is no required heading, order, or output shape. Use simplified technical English. Be concise, but thorough and explicit. Clearly distinguish facts from assumptions, completed work from planned work, and checks that passed from checks that were not run. Do not reproduce the transcript, raw tool output, hidden reasoning, or repetitive low-value detail.

Return only the handoff in chat. Do not write a document, run `/compact`, continue implementation, delegate work, mutate source control, or take external actions. If something important is unknown, say so rather than delaying the handoff for clarification. End when the handoff is complete.
