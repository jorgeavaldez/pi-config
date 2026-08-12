---
description: Implement one approved batch from a plan file
argument-hint: "<plan-file> <phase-and-batch>"
---
read @$1 carefully and implement only $2.
before editing, verify $2 still fits one agent session and one independently reviewable, mergeable outcome; its plan label alone is not proof. if independently mergeable caller migrations are bundled, stop and propose corrected phase or batch boundaries. treat an unavailable validation environment as a gate rather than permission to add setup work.
verify its dependencies instead of assuming earlier work is complete.
follow the plan's locked behavior and scope decisions.
investigate implementation mechanics as needed, but stop for behavior-changing ambiguity or required work outside the approved seam.
complete the seam with focused tests. report optional or adjacent work as follow-up instead of implementing it.
do not use Any or suppress lint/type errors unless absolutely necessary.
