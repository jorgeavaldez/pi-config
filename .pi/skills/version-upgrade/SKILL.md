---
name: version-upgrade
description: Comprehensive review of the entire pi agent configuration after a version upgrade. Detects breaking changes, incompatibilities, deprecations, and regressions across all extensions, settings, keybindings, skills, and shared modules. Reports findings with full context before any modifications are made. Use when pi has been upgraded and you need to audit the configuration for compatibility.
---

# Version Upgrade Review

Perform a deep, comprehensive audit of this pi agent configuration to identify
all breaking changes, incompatibilities, deprecations, and potential regressions
introduced by a pi version upgrade.

## Prerequisites

Before running this skill, determine the version transition:

1. Read `settings.json` to get the current `lastChangelogVersion` (the version we upgraded TO).
2. Use `jj diff` on `settings.json` (check both working copy and staged changes) to find
   the previous `lastChangelogVersion` (the version we upgraded FROM). Do NOT modify the
   file or jj history.

```bash
jj diff -- settings.json
```

If the diff is not in the working copy, check the latest change:

```bash
jj diff -r @ -- settings.json
```

## Step 1: Read the Changelog

Read the full CHANGELOG.md from the installed pi version to understand ALL changes
between the old and new versions — not just breaking changes, but also fixes, new
features, and behavioral changes that may interact with custom extensions.

```bash
PI_BIN="$(which pi)"
PI_CLI_PATH="$(node -e "const fs=require('fs'); console.log(fs.realpathSync(process.argv[1]))" "$PI_BIN")"
PI_PACKAGE_ROOT="$(node -e "const path=require('path'); console.log(path.dirname(path.dirname(process.argv[1])))" "$PI_CLI_PATH")"
cat "$PI_PACKAGE_ROOT/CHANGELOG.md"
```

Extract every entry between the new version and the old version (inclusive of the new,
exclusive of the old).

## Step 2: Audit Extensions

Read every extension file. Use subagents or parallel tasks for breadth:

### Files to audit

- All `.ts` files directly under `extensions/`
- All `.ts` files under `extensions/shared/`
- All `.ts` files under `extensions/task/`
- All `.ts` files under `extensions/subagent/`
- `extensions/package.json`

### What to check in each file

For each extension file, check for:

1. **Removed or renamed APIs**: Any import or usage of types/functions/classes that were
   removed, renamed, or had their signatures changed.
2. **Changed type signatures**: Fields that changed type (e.g., `number` → `number | null`),
   new required parameters, removed optional parameters.
3. **Monkey-patching fragility**: Extensions that patch prototype methods of pi internals
   (e.g., `CombinedAutocompleteProvider.prototype`) are extremely fragile. Compare the
   patched method's expected signature and behavior against the new version's actual
   implementation. Check:
   - Has the method signature changed?
   - Has the internal implementation changed in ways the patch doesn't account for?
   - Does the patch bypass new features (scoped queries, scoring, path display)?
   - Would the built-in implementation now be sufficient, making the patch unnecessary?
4. **Deprecated patterns**: Usage of APIs marked for removal or replaced by newer alternatives.
5. **Behavioral changes**: Even if APIs are the same, check if behavioral changes in pi
   (e.g., how autocomplete works, how sessions are managed, how tools are rendered) would
   cause regressions.

### How to compare implementations

When an extension monkey-patches or overrides a pi internal, compare against both the
old and new versions:

```bash
# Find old version path
OLD="/Users/jorge/.local/share/mise/installs/npm-mariozechner-pi-coding-agent/<OLD_VERSION>/lib/node_modules/@mariozechner/pi-coding-agent/"

# Find new version path  
NEW="/Users/jorge/.local/share/mise/installs/npm-mariozechner-pi-coding-agent/<NEW_VERSION>/lib/node_modules/@mariozechner/pi-coding-agent/"

# Compare specific implementations
diff <(grep -A50 'methodName' "$OLD/node_modules/@mariozechner/pi-tui/dist/autocomplete.js") \
     <(grep -A50 'methodName' "$NEW/node_modules/@mariozechner/pi-tui/dist/autocomplete.js")
```

## Step 3: Audit Configuration Files

### settings.json

- Check all keys against the current pi version's supported settings schema.
- Check for removed, renamed, or deprecated settings keys.
- Verify provider/model names are still valid.
- Check the `packages` array (if present) for git source patterns that need `git:` prefix.
- Check `enabledModels` entries for format changes.

### keybindings.json

- Verify all keybinding names are still recognized.
- Check for new default keybindings that might conflict.
- Check for removed keybinding slots.

### package.json (extensions/)

- Verify peer dependency package names are still correct.
- Check if any packages were renamed or split.

## Step 4: Audit Skills

Read each skill under `skills/` and check:

- References to CLI flags or commands that may have changed.
- References to `gh` CLI patterns that interact with pi workflows.
- Any hardcoded version assumptions.

## Step 5: Compile the Report

Present findings organized as:

### Critical (Will Break)

Issues that will cause runtime errors, crashes, or completely broken functionality.
Include:
- **What**: The specific issue
- **Where**: Exact file and line(s)
- **Why**: Which changelog entry or API change causes it
- **Impact**: What breaks at runtime
- **Options**: Remediation approaches (ranked by preference)

### Warning (May Break or Regress)

Issues that won't crash but may cause subtle bugs, degraded behavior, or missed
improvements. Include same detail as Critical.

### Info (Recommended)

Optional improvements, cleanups, or opportunities to leverage new features.
Include same detail as Critical.

## Rules

- **DO NOT modify any files.** This skill is read-only / investigation-only.
- **DO NOT commit, stage, push, or alter jj/git history.**
- Use subagents and parallel tasks liberally for thorough coverage.
- Read actual source code — do not guess or assume API compatibility.
- Compare old vs new pi source when relevant.
- Report even minor or cosmetic issues — completeness over brevity.
