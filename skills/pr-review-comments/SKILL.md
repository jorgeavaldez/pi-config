---
name: pr-review-comments
description: Fetches PR review comments from GitHub, batches similar comments together using semantic analysis, and walks through each batch one at a time with user confirmation between each. Use when the user wants to address PR review feedback, fix review comments, or work through code review suggestions.
---

# PR Review Comments Skill

This skill helps you systematically work through PR review comments by batching similar ones together and addressing them one batch at a time with user feedback between each.

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
2. Analyze and batch comments in the active chat/session
3. Present the triage overview and wait for user approval
4. Work through batches ONE AT A TIME
5. After each batch: delete processed comment files, ask for feedback
6. WAIT for user response before proceeding to next batch

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
- ✅ **INCLUDE**: Valid and should be addressed
- ⚠️ **QUESTIONABLE**: Might not be valid or appropriate (explain why)
- ❌ **EXCLUDE**: Incorrect or not applicable (explain why)

Use available read/search tools directly, batching independent read-only lookups when supported. Collect all classifications before proceeding to batching.

### 1.4 Batch Comments by Semantic Similarity

Group **INCLUDE** comments into batches based on semantic similarity. Consider:

- Comments about the same type of issue (e.g., error handling, naming, performance)
- Comments in related files or the same module/feature area
- Comments that would benefit from being addressed together (shared context)

For each batch, note:
- Which comments are in the batch
- Why they were grouped together
- The files affected

**Important**: A batch can be a single comment if it's unique. Don't force unrelated comments together.

### 1.5 Prepare In-Session Triage Summary

Keep the triage summary in the active chat/session instead of writing progress or status files to disk. Include:

- **Triage Results**: Your analysis of each comment's validity
- **Batches**: List each batch with its comments and grouping reasoning (only INCLUDE comments)
- **Excluded**: Comments you recommend excluding with reasoning
- **Status**: Which batch is currently being discussed or worked
- **Notes**: Observations, decisions, anything relevant

### 1.6 Present Triage Overview and Get Approval

**STOP and present a CONCISE overview to the user.** Format:

> **PR Review Triage**
> 
> **Will address (N comments in M batches):**
> - Batch 1 - [Name]: [brief description] (N comments)
> - Batch 2 - [Name]: [brief description] (N comments)
> 
> **Questionable (need your input):**
> - [file:line] - [issue] — [your concern]
> 
> **Recommending to skip:**
> - [file:line] - [issue] — [reason]
>
> Let me know if you want to exclude anything, include something I flagged, or adjust the batches.

**WAIT for user response.** Do not proceed until they approve or provide feedback.

### 1.7 Handle Triage Feedback

Process user feedback:
- **Exclude comments**: Remove from batches, add to Excluded section with user's reasoning
- **Include comments**: Add to appropriate batch (or create new batch), move from Excluded/Questionable
- **Adjust batches**: Merge, split, or reorder as requested
- **Approve as-is**: Proceed to work

If changes were made, present the updated overview and ask for approval again.

Once approved, proceed to the first batch.

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

**Important**: The comment files contain specific instructions. Follow them, especially the verification steps.

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

### 2.5 Ask for Feedback

**STOP and ask the user**:

> "Batch N complete. I [brief summary of changes made]. Changes are local and have not been committed, pushed, or resolved on GitHub.
> 
> Any feedback on these changes, or should I proceed to Batch N+1?"

**WAIT for the user's response.** Do not proceed until they respond. Do not treat "proceed" as permission to commit, move bookmarks, push, update the PR branch, offer source-control actions, or resolve GitHub comments.

### 2.6 Handle User Response

- If user provides **feedback**: Address it, summarize what changed, then ask again if ready to proceed
- If user says to **proceed**: Go to the next pending batch and repeat from [Working on a Batch](#working-on-a-batch)
- If user says to **stop**: Stop without writing a progress/status file

---

## Completion

When all batches are done:

1. Inform the user: "All PR review comments have been addressed locally."
2. State clearly whether changes are only local or already visible on the PR
3. Do **not** ask to update the PR branch, push, commit, move bookmarks, or otherwise mutate source control
4. Optionally summarize what was done across all batches

---

## Key Reminders

- **Complete comment investigation before editing** - batch independent read-only lookups when supported
- **Make code edits sequentially** - actual edits should be done one at a time to avoid conflicts
- **Always WAIT for user response between batches** - never auto-proceed
- **Never mutate source control from this skill and never offer to do so** - no commits, bookmark moves, branch moves, pushes, rebases, amends, or prompts asking to update the PR branch
- **Resolve comments on GitHub only after fixes are visible on the PR or explicit user instruction** - use the `resolve-pr-comment` skill
- **Delete comment files after each batch** - not all at the end
- **Do not write progress/status files** - keep batching state in the active chat/session
