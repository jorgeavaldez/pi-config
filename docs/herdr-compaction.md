# Herdr Compaction State for Pi

This repository makes Pi compaction visible in Herdr:

- the agent becomes semantically `working` while compaction runs;
- the Agent sidebar shows `compacting`;
- success, failure, and cancellation clear the state;
- completion outcomes produce explicit Herdr notifications.

## Requirements

- Pi `0.84.3` or newer, which provides `session_before_compact`, `session_compact`, and `session_compact_failed` events.
- The Herdr Pi lifecycle integration installed at `extensions/herdr-agent-state.ts`.

## Why two extensions are involved

Herdr gives each detected agent one lifecycle authority. For Pi, the official integration source `herdr:pi` owns semantic `idle`, `working`, and `blocked` state. A companion extension using another source can publish metadata, but its `pane.report_agent` calls do not replace the active official authority.

That distinction matters because semantic state controls Herdr's status icon, waits, notifications, and workspace rollups. Metadata can render `compacting` but cannot make an idle agent semantically working.

The implementation therefore has two owners:

| File | Responsibility |
| --- | --- |
| `extensions/herdr-agent-state.ts` | Authoritative `herdr:pi` lifecycle state, including the local compaction patch. |
| `extensions/herdr-compaction-state.ts` | Display-only `compaction` token, explicit outcome notifications, and metadata cleanup. |

Do not add another lifecycle source to the companion extension. It will not become authoritative while the official Pi integration owns the pane.

## Managed integration patch

`extensions/herdr-agent-state.ts` is installed and managed by Herdr. This repository intentionally carries a local patch in that file because Herdr integration v8 does not consume Pi's compaction events.

The patch is marked with a comment referencing [herdrdev/herdr#1853](https://github.com/herdrdev/herdr/issues/1853). It:

1. tracks `compactionActive`;
2. treats `agentActive || compactionActive` as semantic `working`;
3. activates compaction state on `session_before_compact`;
4. clears it on success, failure, or abort.

Blocked state retains precedence. When automatic compaction occurs during an active agent turn, clearing `compactionActive` leaves the agent `working` until the normal `agent_settled` event. Manual compaction transitions from `working` to `idle`; Herdr derives `done` when that completed state has not been seen.

### Overwrite warning

Running either of these can overwrite the local patch:

```bash
herdr integration install pi
herdr update
```

After a Herdr upgrade or Pi integration reinstall:

1. Inspect `extensions/herdr-agent-state.ts` for `session_before_compact` and `session_compact_failed` handlers.
2. If the bundled integration now handles compaction, use the upstream implementation and remove the obsolete local patch comment.
3. If it still does not, reconcile and reapply the tracked local patch rather than replacing the entire updated integration file.
4. Run `/reload` in active Pi sessions.
5. Repeat the validation below.

`herdr integration status` can report the integration as current even when the bundled integration still lacks compaction handling. "Current" only means the installed file matches Herdr's bundled integration version.

## Companion metadata and notifications

`extensions/herdr-compaction-state.ts` publishes metadata from `user:pi-compaction`:

- `compaction=compacting` at start;
- token clearing on success, failure, cancellation, startup, and shutdown;
- a 15-minute TTL as crash protection;
- monotonic report sequences so delayed start reports cannot overwrite cleanup;
- one retry for idempotent metadata reports;
- no notification retry, avoiding duplicate explicit notifications.

It also listens directly to the compaction abort signal so Escape clears the token immediately, before the terminal failure event arrives.

Notifications are:

- `Pi compaction complete`
- `Pi compaction canceled`
- `Pi compaction failed`

## Herdr sidebar configuration

The Herdr config is outside this repository at `~/.config/herdr/config.toml`:

```toml
[ui.sidebar.agents.rows_by_agent]
pi = [["state_icon", "workspace", "tab"], ["agent", "$compaction"]]
```

`state_icon` renders semantic lifecycle state from `herdr:pi`. `$compaction` renders the companion extension's metadata token.

Validate and reload changes with:

```bash
herdr config check
herdr server reload-config
```

## Validation

After changing either extension:

```bash
cd ~/.pi/agent/extensions
bun run type-check
herdr config check
```

Then run `/reload` in Pi and test a session with enough history to compact:

1. Run `/compact`.
2. Confirm Herdr changes the agent from `idle` to `working` and shows `compacting`.
3. Press Escape.
4. Confirm the agent returns to `idle` or derived `done`, the token clears, and a cancellation notification appears.
5. Run a successful compaction and confirm the same cleanup plus the completion notification.

The implementation was validated against a real isolated Herdr `0.8.0` server with Pi `0.84.3`, not only a mock socket. The observed cancellation path was:

```text
idle (state_change_seq 9)
→ working + compaction=compacting (state_change_seq 10)
→ idle + token cleared (state_change_seq 11)
```

Success, failure, and cancellation report ordering was also tested with a socket harness.

## Troubleshooting

### `compacting` appears but the status remains `idle`

The companion extension is running, but the authoritative managed patch is missing or was overwritten. Check:

```bash
rg -n 'session_before_compact|session_compact_failed|issues/1853' \
  ~/.pi/agent/extensions/herdr-agent-state.ts
```

Do not try to fix this by adding `pane.report_agent` with a different source to `herdr-compaction-state.ts`; Herdr keeps `herdr:pi` as the pane's lifecycle authority.

### The status or token remains active after Escape

Confirm both extensions loaded after `/reload`, then check that both contain abort or failure cleanup:

```bash
rg -n 'signal.addEventListener|session_compact_failed' \
  ~/.pi/agent/extensions/herdr-{agent,compaction}-state.ts
```

### `/compact` reports `Nothing to compact` or `Already compacted`

Pi can reject compaction before a real compaction starts. In that case there may be no `working` transition. Use a session with sufficient uncompacted history for lifecycle validation.
