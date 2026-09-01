---
name: pr-review-comments
description: Fetches and triages PR review comments, then addresses the valid in-scope feedback in the smallest authorized batch. Pauses for the user only when scope, validity, or multiple substantive batches require a decision. Use when the user wants to address PR review feedback, fix review comments, or work through code review suggestions.
---

# PR Review Comments Skill

This skill helps you triage PR review comments and address the valid in-scope feedback with the least process needed for the actual change.

## Critical Safety Rule — No Source-Control Mutations or Offers

This skill is for triaging and editing PR review feedback only. It does **not** grant permission to mutate source control, and it must never offer to mutate source control on the user's behalf.

**Never run source-control mutation commands from this skill. Never ask whether the user wants you to run them. Never suggest that you can run them.** This includes, but is not limited to:

- `jj describe`, `jj commit`, `jj bookmark move/create/delete`, `jj git push`, `jj squash`, `jj rebase`, `jj new`
- `git add`, `git commit`, `git push`, branch creation, branch switching, rebases, amends
- Any command that moves a bookmark/branch, creates a commit, rewrites history, or pushes to a remote

Allowed GitHub-only actions when explicitly prompted:

- Update an existing PR title or description with `gh pr edit` when the user specifically asks for that.
- Resolve/acknowledge review comments after the fix is visible on the PR, or when the user specifically asks to resolve/acknowledge.

Important interpretation rules:

- User approval to **"proceed"** with a review-comment batch means: edit files, run checks, delete the processed comment files, then stop and report. It is **not** permission to commit, move bookmarks, push, update the PR branch, or offer to do so.
- After local fixes are complete, stop and report that changes are local. Do **not** ask whether to update the PR branch.
- Do not resolve GitHub review threads or acknowledge top-level review bodies until the corresponding fix is visible on the PR, unless the user explicitly asks you to resolve/acknowledge now.

## Workflow Overview

1. Fetch comments into generated `*-review-feedback.md` files
2. Analyze every comment and identify the smallest complete current-scope batch
3. If the user already authorized valid in-scope fixes and no decision is needed, proceed directly; otherwise present concise triage and wait
4. Implement one bounded batch, validate it, and delete its processed comment files
5. Pause only between multiple substantive batches or when the user must decide scope or validity
6. Report once when the final batch is complete

This workflow does not require separate planning, triage, implementation, or review agents. When operating through a manager, prefer one existing task owner for the bounded follow-up unless a real isolation or ownership boundary requires another agent.

## Step 1: Fetch PR Review Comments

### 1.1 Fetch PR Review Comments

Run the script to fetch unresolved PR review thread comments plus actionable top-level PR review bodies:

```bash
~/.pi/agent/skills/pr-review-comments/get_pr_review_comments
```

This will create individual `{comment-id}-review-feedback.md` files in the current directory. Top-level review body files use `PRR_...` IDs and include a note that they are not resolvable review threads. Top-level review bodies that you have acknowledged with the configured reaction (`EYES` by default) are skipped on subsequent fetches.

### 1.2 Read All Comment Files

List all the generated comment files:

```bash
ls -la *-review-feedback.md 2>/dev/null
```

Each file contains:
- The file path and line number where the comment applies
- The review comment content
- Instructions for verification

### 1.3 Pre-analyze Comments for Validity

Analyze every comment in the active session. Read its feedback file, inspect the referenced code and surrounding context, and determine:

- **Is it correct?** Does the suggestion actually apply? Is it based on a misunderstanding?
- **Is it appropriate for this PR?** Too minor? Too large/out of scope?
- **Is it already addressed?** Sometimes code has changed since the comment was made

Classify each comment as:
- ✅ **CURRENT**: Valid and required for this PR to be correct
- ➡️ **FOLLOW-UP**: Valid, but not required for this PR
- ⚠️ **QUESTIONABLE**: Might not be valid or appropriate (explain why)
- ❌ **EXCLUDE**: Incorrect or not applicable (explain why)

Use available read/search tools directly, batching independent read-only lookups when supported. Collect all classifications before proceeding to batching.

### 1.4 Batch Comments by Semantic Similarity

Group **CURRENT** comments into batches based on semantic similarity. Consider:

- Comments about the same type of issue (e.g., error handling, naming, performance)
- Comments in related files or the same module/feature area
- Comments that would benefit from being addressed together (shared context)

For each batch, note:
- Which comments are in the batch
- Why they were grouped together
- The files affected

A batch can be a single comment when it requires an independent design or validation path. Conversely, do not split comments that fit one bounded edit-and-validation seam merely to preserve workflow stages. Minimize the number of batches; batching is not an outcome by itself.

### 1.5 Prepare In-Session Triage Summary

Keep the triage summary in the active chat/session instead of writing progress or status files to disk. Include:

- **Triage Results**: Your analysis of each comment's validity
- **Batches**: List each batch with its comments and grouping reasoning (only CURRENT comments)
- **Follow-ups**: Valid comments that should not expand this PR; include impact, evidence, and recommended remediation for systemic issues
- **Excluded**: Comments you recommend excluding with reasoning
- **Status**: Which batch is currently being discussed or worked
- **Notes**: Observations, decisions, anything relevant

### 1.6 Choose the Direct or Approval Path

Proceed directly when all of these are true:

- the user already authorized addressing valid, reasonably in-scope review feedback;
- every item to be edited is clearly CURRENT;
- the CURRENT items fit one bounded implementation and validation seam;
- no FOLLOW-UP or QUESTIONABLE item must be promoted to make the fix complete; and
- the work does not introduce a materially different outcome or unapproved source-control/external action.

Before editing on the direct path, state one concise in-progress line with the comment IDs and the bounded outcome, then continue to [Working on a Batch](#working-on-a-batch). Do not add a redundant approval gate.

Stop for approval when validity or scope is genuinely ambiguous, the user requested review before editing, or more than one substantive batch is necessary. Use this concise format:

> **PR Review Triage**
>
> **Will address (N comments in M batches):**
> - Batch 1 - [Name]: [brief description] (N comments)
> - Batch 2 - [Name]: [brief description] (N comments)
>
> **Follow-ups (not part of this PR):**
> - [file:line] - [issue] — [why it can wait]
>
> **Questionable (need your input):**
> - [file:line] - [issue] — [your concern]
>
> **Recommending to skip:**
> - [file:line] - [issue] — [reason]
>
> Let me know if you want to exclude anything, promote a follow-up, or adjust the batches.

Wait only when this approval path applies.

### 1.7 Handle Triage Feedback

For the approval path, process user feedback:
- **Exclude comments**: Remove from batches, add to Excluded section with user's reasoning
- **Promote comments**: Add an explicitly approved FOLLOW-UP or QUESTIONABLE comment to an appropriate current batch
- **Adjust batches**: Merge, split, or reorder as requested
- **Approve as-is**: Proceed to work

If a material decision remains after the update, present the revised overview and ask once more. Otherwise proceed to the first batch.

### 1.8 Begin Working

Proceed to [Working on a Batch](#working-on-a-batch).

---

## Working on a Batch

### 2.1 Confirm Current Batch

Before starting work, state which batch is in progress in chat, including the comment IDs and files affected.

### 2.2 Address the Comments

Investigate each comment with the available read/search tools, then make code changes **sequentially** to avoid edit conflicts:

1. Read the relevant file(s)
2. Understand the feedback and the surrounding code
3. Think carefully about whether the feedback is valid
4. Make the appropriate code changes
5. Verify your changes:
   - For backend code: `cd backend && make lint`
   - For frontend code: `cd frontend && ENV=local bun run lint`

**Important**: The comment files contain specific instructions. Follow them, especially the verification steps. If a CURRENT comment proves to require a new outcome or redesign, stop and ask to rescope instead of expanding the PR.

### 2.3 Resolve Comments on GitHub

Only resolve or acknowledge comments after the corresponding fix is visible on the PR, or after the user explicitly instructs you to resolve/acknowledge now. Local unpushed edits are not enough.

After the fix is visible on the PR, resolve each threaded `PRRC_...` comment in the batch using the `resolve-pr-comment` skill. For top-level `PRR_...` review body files, add the acknowledgement reaction instead; GitHub does not expose those as resolvable review threads.

For a top-level review body:

```bash
~/.pi/agent/skills/pr-review-comments/ack_pr_review_comment PRR_...
# or pass the generated file:
~/.pi/agent/skills/pr-review-comments/ack_pr_review_comment PRR_...-review-feedback.md
```

The acknowledgement reaction defaults to `EYES`; set `PR_REVIEW_ACK_REACTION` to use another GitHub reaction enum. Acknowledged top-level review bodies are ignored by `get_pr_review_comments`.

1. Get the PR's review threads to find the thread ID for each comment:
   ```bash
   gh api graphql -f query='
   query {
     repository(owner: "OWNER", name: "REPO") {
       pullRequest(number: PR_NUMBER) {
         reviewThreads(first: 100) {
           nodes {
             id
             isResolved
             comments(first: 1) {
               nodes { id }
             }
           }
         }
       }
     }
   }'
   ```

2. Find the thread where `comments.nodes[0].id` matches your comment ID (e.g., `PRRC_...`). The parent `id` is the thread ID (`PRRT_...`).

3. Resolve the thread:
   ```bash
   gh api graphql -f query='
   mutation {
     resolveReviewThread(input: {threadId: "PRRT_..."}) {
       thread { isResolved }
     }
   }'
   ```

### 2.4 Delete Processed Comment Files

After completing the batch, delete the processed comment files for this batch:

```bash
rm {comment-id}-review-feedback.md
```

### 2.5 Continue or Complete

If another approved substantive batch remains, stop and ask:

> "Batch N complete. I [brief summary of changes made]. Changes are local and have not been committed, pushed, or resolved on GitHub.
>
> Any feedback on these changes, or should I proceed to Batch N+1?"

Wait before the next batch. Do not treat "proceed" as permission to commit, move bookmarks, push, update the PR branch, offer source-control actions, or resolve GitHub comments.

If this was the only or final batch, continue directly to [Completion](#completion) and report once. Do not create an extra approval gate or independent review pass unless the user requested it or a concrete delivery requirement demands it.

### 2.6 Handle User Response

When another batch remains:

- If user provides **feedback**: Address it, summarize what changed, then ask again if ready to proceed
- If user says to **proceed**: Go to the next pending batch and repeat from [Working on a Batch](#working-on-a-batch)
- If user says to **stop**: Stop without writing a progress/status file

---

## Completion

When all batches are done:

1. Inform the user: "All current-scope PR review comments have been addressed locally."
2. List any FOLLOW-UP comments separately
3. State clearly whether changes are only local or already visible on the PR
4. Do **not** ask to update the PR branch, push, commit, move bookmarks, or otherwise mutate source control
5. Optionally summarize what was done across all batches

---

## Key Reminders

- **Complete comment investigation before editing** - classify CURRENT work separately from FOLLOW-UP work
- **Make code edits sequentially** - actual edits should be done one at a time to avoid conflicts
- **Wait between multiple substantive batches or for real decisions** - do not add a pause before or after a single preauthorized bounded batch
- **Never mutate source control from this skill and never offer to do so** - no commits, bookmark moves, branch moves, pushes, rebases, amends, or prompts asking to update the PR branch
- **Resolve comments on GitHub only after fixes are visible on the PR or explicit user instruction** - use the `resolve-pr-comment` skill
- **Delete comment files after each batch** - not all at the end
- **Do not write progress/status files** - keep batching state in the active chat/session
