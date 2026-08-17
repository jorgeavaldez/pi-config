---
name: resource-cleanup
description: Inventory and triage stale local Jujutsu workspaces, Herdr workspaces/tabs/live agent sessions, and tmux sessions. Uses task and project context available from the invocation environment without assuming a particular notes repository, classifies resources as safe, questionable, or not safe to clean, and performs only explicitly approved cleanup.
---

# Resource Cleanup

Inventory local operational resources, determine what owns them, and help the user decide what can be removed.

Default to an inventory and proposal only. Do not mutate or close anything until the user approves the resulting resource list.

Ownership:

- this skill owns cross-system cleanup decisions;
- `herdr` owns Herdr command mechanics;
- `herdr-manager` owns live workspace, pane, task, and session mapping;
- task and project records provide context but may be stale.

When `HERDR_ENV=1`, load `herdr` and `herdr-manager` before inspecting or controlling Herdr. Otherwise skip Herdr, continue with the other resource types, and report that limitation.

## Invocation context

Determine the invocation mode from the current directory, repository root, project instructions, available project-scoped skills, and the user's requested scope. Do not infer a private directory layout or task system from path names alone.

### Task/context repository

Use this mode only when the user or repository-local instructions identify the current repository as a task, notes, project-management, or delegation context. Its records may coordinate resources in many external repositories.

Follow its local instructions and project-scoped skills to discover the canonical active-task, focus, project, plan, or handoff sources. Do not assume filenames, directory names, domains, or hierarchy. Map delegated work to operational resources through documented repository paths, workspace names, task identifiers, pane metadata, or links.

The context repository's own Herdr, tmux, or JJ resources are not automatically cleanup candidates. Include them only when requested or when the inventory independently identifies them as resources owned by the selected work.

### Operational repository

Use this mode when the current repository owns the code, service, or other resources being inspected. Treat its repository state, local instructions, linked task references, and processes as the nearest context. Do not search for a separate notes or task repository unless the user or local instructions explicitly identify one.

### Neutral location

When the invocation is outside a relevant repository, derive ownership from the requested scope and live resource metadata such as cwd, repository roots, revisions, process commands, labels, and task identifiers. Do not scan the user's home directory looking for a task store. Missing task records are absence of evidence, not proof that a resource is stale.

If more than one mode appears plausible and the choice would materially change scope, ask the user before inventorying broadly.

## Boundaries

In scope:

- registered Jujutsu workspaces and registration/path mismatches;
- Herdr named sessions, workspaces, tabs, panes, and live agents;
- tmux sessions and pane processes;
- task, focus, plan, PR, and ticket context needed for classification.

Out of scope:

- Pi session files;
- tmux log/cache deletion;
- standalone repository deletion;
- remote resources unless the user explicitly scopes a remote machine;
- task/context record edits or unrelated source-control/hosting mutations.

Never enumerate, read, move, or delete Pi session JSONL files. Herdr may report a session path as live identity metadata, but do not access it. Closing a Herdr resource leaves its saved Pi session untouched.

Do not create replacement resources during cleanup.

## Scope arguments

With no argument, audit all supported local resource types. Use the invocation mode to determine which context sources are available; do not manufacture task context when invoked outside a task/context repository.

Accept narrower requests such as:

- `jj`, `tmux`, or `herdr`;
- a task, project, domain, or workstream identified by the user's context system;
- a repository or workspace path.

A narrow request limits both inspection and cleanup. Never touch an idle sibling task, project, domain, or workstream merely because it is visible.

## 1. Inventory resources first

Discover resources before reading task status. Names, age, and task-file absence are weak evidence.

### Herdr and live agents

When inside Herdr, run:

```bash
herdr session list --json
herdr workspace list
herdr pane list
herdr tab list --workspace <workspace-id>
```

List tabs for every workspace. Record the current IDs, labels, status, cwd, revision, focus, and Herdr-reported live session identity.

Use `herdr pane read <pane> --source recent-unwrapped --lines 80` only when ownership, completion, or result consumption is unclear. Do not broadly reproduce pane output; redact sensitive content.

Status alone never proves safety:

- `working` and `blocked` must be kept;
- `done` is an unviewed result and must be kept until its owner consumes it;
- `idle` may still be a coordinator, waiting agent, or valuable continuation.

The current pane and its containing tab, workspace, and named Herdr session are always **KEEP / NOT SAFE**.

### Tmux

Run:

```bash
tmux list-sessions -F '#{session_name}\tattached=#{session_attached}\tcreated=#{t:session_created}\tactivity=#{t:session_activity}\twindows=#{session_windows}'
tmux list-panes -a -F '#{session_name}\t#{window_index}:#{pane_index}\tdead=#{pane_dead}\tcmd=#{pane_current_command}\tpid=#{pane_pid}\tcwd=#{pane_current_path}\tstart=#{pane_start_command}'
```

For each candidate, check pane descendants and inspect only enough recent output to distinguish an idle prompt from active or failed work. Use existing `tmux-background` completion/readiness status when available.

Detachment, age, or a shell process name is insufficient. Keep attached sessions, active descendants, servers, workers, watchers, port-forwards, unknown commands, and task-required interactive state.

Killing a tmux session never authorizes deleting its logs or cache.

### Jujutsu

Discover repository families under the requested path or local source roots, plus repositories referenced by Herdr/tmux cwd values. Prefer registered state over directory names:

```bash
jj -R <repository> --ignore-working-copy workspace list --no-pager
```

Deduplicate sibling listings. Assess registered non-default workspaces and registration/path mismatches. A standalone repository with only its canonical `default` workspace is not a cleanup candidate.

For each workspace record:

- repository, registered name, exact path, and apparent size;
- whether it is the canonical/default checkout;
- recorded revision, description, bookmarks, conflicts, empty state, and diff;
- non-empty revisions reachable from it but not from the repository's trustworthy trunk;
- Herdr, tmux, or other process cwd references beneath its path.

Use `--ignore-working-copy` throughout proposal-only inspection so JJ does not snapshot or update state. A stale checkout is questionable until approved preflight.

Do not assume `main`, `main@origin`, or any hosting provider. If no trustworthy trunk can be established, classify the workspace as questionable.

An empty working-copy revision is not enough: inspect non-empty ancestors outside trunk. Unique implementation, unpublished review fixes, conflicts, or other local-only state are high-loss-risk.

## 2. Correlate by workstream

After inventory, consult only context sources warranted by the invocation mode:

- in a task/context repository, use the canonical active-task, focus, project, plan, delegation, and handoff sources identified by its local instructions or project-scoped skills;
- in an operational repository, use its local instructions, source-control state, and explicitly linked task, plan, ticket, PR, or handoff context;
- in a neutral location, rely on requested scope and resource metadata unless the user supplies another context source.

Never assume conventional context filenames or directories, and never recursively search unrelated repositories or the user's home directory for them. Respect the project, domain, and workstream boundaries defined by the owning context system. A scope selecting one boundary excludes its siblings.

A task/context repository may describe delegated work whose operational resources live elsewhere. Resolve those external resources from explicit paths, identifiers, links, and live metadata rather than requiring their cwd to sit beneath the invocation repository.

Group resources using, in descending strength:

1. exact cwd or registered workspace path;
2. task, ticket, or project identifier;
3. revision description, bookmark, or PR head;
4. Herdr label and targeted pane output;
5. tmux name, cwd, command, and completion evidence;
6. linked plan or durable handoff.

A task match is useful but not required. Outside a task/context repository, missing task records are neutral; use the remaining evidence and classify unresolved ownership as questionable rather than assuming safety.

When task/context records conflict with local source or live ownership, retain the resource or investigate the specific conflict. For code work, inspect linked PR/ticket state only when needed to resolve a candidate; do not expand cleanup into general work triage.

An ongoing but externally blocked task may be safe to clean when useful state is pushed or recorded durably and recovery is easy. If the only handoff remains in a pane or local workspace, propose recording it as a prerequisite.

Do not keep generic spare workspaces. Reuse matters only for the same current workstream; never recommend reusing an unrelated task-owned workspace.

## 3. Classify and propose

Use exactly these groups:

### SAFE TO CLEAN

All applicable evidence agrees:

- no active/waiting owner or process needs it;
- no unviewed agent result would be lost;
- no source changes, conflicts, unique revisions, unpublished fixes, or local-only implementation remain;
- delivered, obsolete, superseded, or externally waiting state is durable elsewhere;
- recovery is straightforward;
- it is not a canonical checkout or standalone repository.

### QUESTIONABLE / NEEDS DECISION

Use for any material uncertainty: stale JJ state, unclear idle-agent value, non-persisted command output, blocked/validating work with uncertain recovery, task/live-state contradiction, no reliable correlation, dirty or unique work the user may intentionally discard, or cross-workstream/remote ambiguity.

Name the exact question or prerequisite.

### KEEP / NOT SAFE TO CLEAN

Use for the current coordinator, working/blocked/unviewed-done agents, attached or live processes, canonical/default workspaces, unapproved local-only source state, another active workstream's resources, and resources needed for a concrete next action or difficult recovery.

Report by workstream:

```markdown
## Resource snapshot

## Safe to clean
| Workstream | Resources | Evidence | Exact cleanup action |

## Questionable / needs decision
| Workstream | Resources | Uncertainty | Decision needed |

## Keep / not safe to clean
| Workstream | Resources | Reason |

## Context and handoff prerequisites
```

Use exact registered names, paths, tmux names, and current Herdr labels/IDs. State whether each action closes a tab/workspace, kills tmux, forgets a JJ workspace, or permanently deletes a directory. Disk usage is an estimate.

End by stating that nothing changed and asking the user to approve exact rows or the complete **SAFE TO CLEAN** group.

## Approval rules

The audit itself authorizes nothing.

- `remove all safe`, `proceed`, or equivalent approves only listed **SAFE TO CLEAN** rows.
- Questionable, dirty, unique, unpublished, cross-owned, or discard actions require exact names and explicit approval.
- Approval for one workstream does not include siblings.
- Closing live resources does not include JJ deletion unless the approved row said so.
- JJ removal is permanent only when the proposal explicitly said so.

If the response can reasonably refer to multiple groups, ask once before acting.

## 4. Revalidate and apply

Immediately before each approved action, repeat the relevant inventory and resolve current Herdr IDs again.

For every approved workstream:

1. Verify the same task, cwd, revision, and resource names still map together.
2. Verify no agent became `working`, `blocked`, or newly `done`.
3. Verify child results were consumed or recorded durably.
4. Recheck tmux attachment, descendants, command, cwd, and completion.
5. Verify the JJ target is the exact registered non-default workspace and a surviving canonical workspace exists.
6. Stop if any material fact changed.

### Approved JJ preflight

Only after approval and when no process is writing the workspace:

- update stale state if needed;
- run normal `jj status` to snapshot filesystem changes;
- inspect final diff, conflicts, bookmarks, and non-empty revisions outside trustworthy trunk;
- refuse cleanup if unexpected state appears.

A safe-row approval never authorizes discarding newly discovered work. Move it to questionable and ask.

Do not run `jj abandon`, operation-log abandonment, garbage collection, bookmark deletion, rebase, commit, or push.

### Cleanup order

After preflight succeeds:

1. Close exact approved Herdr tabs or the whole task-owned workspace. Prefer the whole workspace only when that complete workstream is done.
2. Kill exact approved tmux sessions.
3. Confirm no process cwd remains under a workspace path.
4. Forget the exact JJ workspace from a surviving workspace in the same repository.
5. Permanently remove only the exact approved directory after verifying its path matches the registered workspace root.

Reread Herdr IDs after every close. Use explicit names and strict path guards for deletion; never use globs or inferred ticket-like paths.

## Verify and report

Re-list affected Herdr, tmux, and JJ state. Verify removed paths are gone and retained resources remain.

Report completed, refused, and changed candidates plus estimated apparent space removed. Confirm that Pi session files, tmux logs/caches, task/context records, and unrelated workstreams were untouched.

If task/context records are stale, report the contradiction and recommend updating them through their owning workflow; do not edit them as a cleanup side effect.
