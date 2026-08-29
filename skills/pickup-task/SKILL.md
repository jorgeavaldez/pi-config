---
name: pickup-task
description: Pick up the active Obsidian task that matches the current repository and Herdr workspace, then continue in the current pane as its manager and delegate read-only planning. Resolves work versus personal-project context at runtime without fixed vault or repository routing. Invoke manually from the target repository or task workspace.
disable-model-invocation: true
---

# Pickup Task

Run this skill only when explicitly invoked with `/skill:pickup-task` from the
repository or repository workspace that should own the task. Optional arguments
may identify a task, ticket, PR, or intended outcome.

Unlike task dispatch, pickup does not create another Herdr workspace, repository
workspace, or manager. The current pane becomes the manager for the resolved
task and remains the sole coordination and approval surface.

An unambiguous invocation authorizes:

- assigning the current Herdr workspace to the resolved task when it is not
  already owned by another workstream;
- creating one fresh sibling planning tab in this Herdr workspace and cwd;
- starting one fresh Pi planning agent and sending its initial read-only prompt;
- waiting for that planner and presenting its plan here for approval.

It does not authorize repository or vault edits, source-control mutations,
implementation, external tracker or hosting changes, another workspace, any
agent beyond that single planner, or cleanup. If the user includes `dry run`,
resolve and report the proposed task and route without creating a tab or
starting an agent.

## Required skills

Always load and follow the available skills named:

- `herdr`
- `herdr-manager`
- `agent-prompt-drafting`

Load any external-system, repository-, or environment-specific skill required
by the resolved task and current project instructions, but inspect only enough
external context to route and brief planning. This skill owns task discovery and
the transition of the current pane into manager ownership.
`herdr-manager` owns live routing and workspace safety.
`agent-prompt-drafting` owns prompt wording and task sizing.

## 1. Establish the current target

Verify `HERDR_ENV=1`; otherwise stop. Inventory the live Herdr workspaces, tabs,
panes, and agents. Identify the current workspace, tab, pane, cwd, and session
from live state rather than remembered compact IDs.

Resolve the current repository root and inspect its state with read-only `jj`
commands. If the cwd is not inside a repository, stop and ask for the intended
repository; do not convert pickup into non-repository dispatch. Gather only the
routing anchors needed to identify the task:

- repository root and normalized repository identity from configured remotes;
- repository workspace name and path basename;
- current change description, associated bookmarks, and revision;
- current Herdr workspace and tab labels;
- explicit arguments supplied to this invocation;
- local project instructions and project-level configuration.

Do not fetch, move bookmarks, create a workspace, or otherwise mutate source
control. Do not investigate the implementation or choose a solution while
resolving the task.

If the current Herdr workspace or repository workspace is already clearly owned
by a different workstream, stop and report the collision. Do not silently
repurpose it merely because it uses the same repository.

## 2. Discover the vault and its task map

Resolve the Obsidian vault at runtime. Prefer an explicit path supplied by the
user, then a unique `vaultPath` from project/ancestor Pi configuration, then a
unique `vaultPath` from the active Pi agent configuration directory. Resolve
relative values against the configuration file that declares them and verify
that the result is a vault before reading it.

Do not embed or infer a personal absolute path, vault name, repository name,
organization name, repository-parent convention, domain directory, or task
filename. Do not scan the entire home directory to guess. If configuration is
missing, invalid, or ambiguous, ask the user for the vault instead.

Read the vault's own agent/context instructions and follow local context-file
indirections. Discover its current domain-to-task/focus map from those
instructions and top-level indexes. Treat that map as authoritative rather than
assuming fixed task or focus paths from this skill.

## 3. Resolve one active task

Search the discovered work and personal-project task/focus sources for open work
that matches the current target. Do not route a repository task to a home/life
queue merely because words overlap.

Use evidence in this order:

1. an explicit task key, PR, phrase, or outcome from the invocation;
2. an exact key or semantic task slug in the repository workspace, current
   change description, or Herdr label;
3. an exact normalized repository remote, repository name, project link, tag,
   or task metadata;
4. a directly linked task note that identifies the repository or current
   workstream;
5. focus status and task-file ordering as tie-breakers, never as substitutes for
   identity.

Prefer path, links, identifiers, and repository metadata over
technical-sounding wording. A repository-name match alone may identify a
project but not one task when several open tasks target that repository.

Read only the matching task entry and a small number of directly linked anchors
needed to brief the planner. Treat tasks, focus notes, tickets, plans, specs,
and comments as contextual evidence rather than binding decomposition.
Preserve explicit user corrections and already approved outcome constraints.
Do not edit the vault.

Continue automatically only when one active task is clearly identified. If
multiple tasks remain plausible, show the small candidate set with the evidence
for each and ask the user to choose. If no active task matches, report that and
ask which task should be picked up; do not invent an untracked task or fall back
to unrelated backlog work.

The domain is the owning domain of the resolved task, corroborated by current
repository context. If repository evidence and task placement disagree, stop
and ask instead of moving or reclassifying the task.

## 4. Claim manager ownership safely

Reinventory Herdr and verify the exact current workspace, pane, cwd, revision,
and task mapping immediately before orchestration. The current pane remains the
manager; do not start a second manager agent or switch this role to another tab.
Do not rename or restructure existing resources unless the user asks.

Inspect existing sibling tabs and agents. If a planning session already belongs
to this exact task, do not duplicate it. Reuse it only when its task, cwd,
revision, session, and status are all unambiguous; otherwise ask. A planning tab
owned by another task is a collision, not reusable capacity.

For `dry run`, stop after reporting:

- the repository/workspace identity and revision;
- the resolved task, owning domain, and decisive matching evidence;
- the current manager route;
- whether a new planning sibling would be created or an exact existing one
  would be resumed;
- any ambiguity or collision.

## 5. Delegate read-only planning

When no exact planning sibling exists, create one fresh sibling tab named
`planning` in the current Herdr workspace, using the current repository cwd and
without taking focus. Parse its tab and pane IDs from the creation response.
Start a fresh Pi agent in that pane using the supported Herdr agent lifecycle.

Draft the planner prompt with `agent-prompt-drafting`. Keep it bounded and adapt
this semantic template rather than copying it mechanically:

```text
Target: <current task-owned Herdr workspace, planning tab/pane, cwd, and exact
revision>. This fresh planning session is intentional.

Mode: PLANNING ONLY.
Edits: Do not modify repository, vault, task, or configuration files.
Source control: Do not run source-control mutations or push. Read-only
inspection is allowed.

Task: Plan the smallest complete outcome for <resolved task>.
Context: <one primary task/ticket anchor and at most two directly relevant
outcome or constraint anchors>. Treat internal artifacts as contextual evidence.
Reconcile them with actual current behavior rather than copying their proposed
scope or decomposition. Follow the repository's own instructions and identify
any environment-specific skill future implementation or validation must load.

Output: Return a concise evidence-backed implementation plan with key decisions,
the smallest complete seam, likely files or execution surfaces, focused
validation, blockers, and only genuine open questions.
Stop condition: Stop and ask the manager if the intended outcome is materially
ambiguous, the task conflicts with current state, or a required investigation
would cross the planning-only boundary.
```

Immediately before prompting, revalidate the planning pane, agent session, cwd,
revision, idle status, and clean input. Submit the prompt and require Herdr to
confirm that it entered `working`. If creation, startup, or prompt submission
fails, report the exact partial state and stop; do not create a replacement or
pretend planning is underway.

## 6. Continue as the manager

Remain in the current pane as the sole coordination and integration owner. Wait
for the exact planner, inspect its result, reconcile it with the resolved task,
and present the evidence-backed plan here for user approval. Do not edit files
or start implementation while waiting.

Report:

- resolved task and owning domain;
- manager and planner workspace/tab/pane mapping, cwd, and revision;
- the planner's concise plan and blockers;
- any material mismatch between the task source and current state;
- the explicit approval decision needed next.

Do not start implementation before approval. After approval, use a fresh sibling
session named `implementation` as the sole file editor when the outcome is
agent-executable, following `herdr-manager` and `agent-prompt-drafting`. Stop and
ask if implementation exceeds the approved seam, requires another workspace or
source-control mutation, or depends on an external action the agent cannot
perform.
