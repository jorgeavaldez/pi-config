#!/usr/bin/env bash
set -u

usage() {
  cat <<'USAGE'
Usage: tmux-background.sh --session NAME [options] -- COMMAND [ARGS...]

Run COMMAND in a detached tmux session with audit logs and explicit
readiness/completion waiting. The session ends when COMMAND ends; pane.log and
exit.status stay in the audit directory. COMMAND gets this launcher's PATH and,
when mise is on that PATH, runs through "mise exec --" in the working directory.

Required:
  --session NAME          tmux session name
  -- COMMAND [ARGS...]    command to run; use "bash -c '...'" for complex shell

Options:
  --cwd DIR               working directory (default: current directory)
  --wait MODE             exit | http | port | log | none (default: exit)
  --timeout SEC           readiness timeout for http/port/log waits (default: 60)
  --replace               kill an existing session with the same name first
  --log-root DIR          root for audit directories (default: ~/.cache/pi/tmux-background)
  --log-dir DIR           exact audit directory (default: <log-root>/<session>-<timestamp>)
  --detach                return once the command is started; readiness keeps being
                          watched in the background. Poll ready.status and exit.status
                          in the audit directory instead of this launcher's exit code.

HTTP wait options:
  --url URL               URL to wait for (required for --wait http)
  --expect-regex REGEX    require HTTP response body to match regex

Port wait options:
  --host HOST             host to check (default: 127.0.0.1)
  --port PORT             port to check (required for --wait port)

Log wait options:
  --pattern REGEX         pane-output regex to wait for (required for --wait log)

Exit status when the command was not started:
  2    invalid arguments or missing --cwd; no session was created
  3    the session name is taken; no session was created
  4    tmux could not create the session; no session was created
  5    the session was created but setup failed; it was killed, but may remain
  127  tmux is not installed; no session was created

Examples:
  tmux-background.sh --session dev --cwd "$PWD" --wait http --url http://127.0.0.1:3000 -- npm run dev
  tmux-background.sh --session tests --wait exit -- bash -c 'bun test'
USAGE
}

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)

session=
cwd=$PWD
wait_mode=exit
timeout=60
replace=0
log_root=${HOME}/.cache/pi/tmux-background
log_dir=
detach=0
url=
expect_regex=
host=127.0.0.1
port=
pattern=

while [ "$#" -gt 0 ]; do
  case "$1" in
    --session)
      session=${2:?--session requires a value}; shift 2 ;;
    --cwd)
      cwd=${2:?--cwd requires a value}; shift 2 ;;
    --wait)
      wait_mode=${2:?--wait requires a value}; shift 2 ;;
    --timeout)
      timeout=${2:?--timeout requires a value}; shift 2 ;;
    --replace)
      replace=1; shift ;;
    --log-root)
      log_root=${2:?--log-root requires a value}; shift 2 ;;
    --log-dir)
      log_dir=${2:?--log-dir requires a value}; shift 2 ;;
    --detach)
      detach=1; shift ;;
    --url)
      url=${2:?--url requires a value}; shift 2 ;;
    --expect-regex)
      expect_regex=${2:?--expect-regex requires a value}; shift 2 ;;
    --host)
      host=${2:?--host requires a value}; shift 2 ;;
    --port)
      port=${2:?--port requires a value}; shift 2 ;;
    --pattern)
      pattern=${2:?--pattern requires a value}; shift 2 ;;
    -h|--help)
      usage; exit 0 ;;
    --)
      shift
      break ;;
    *)
      echo "tmux-background.sh: unknown argument before --: $1" >&2
      usage >&2
      exit 2 ;;
  esac
done

if [ -z "$session" ]; then
  echo "tmux-background.sh: --session is required" >&2
  usage >&2
  exit 2
fi

if [ "$#" -eq 0 ]; then
  echo "tmux-background.sh: command is required after --" >&2
  usage >&2
  exit 2
fi

case "$wait_mode" in
  exit|http|port|log|none) ;;
  *)
    echo "tmux-background.sh: --wait must be one of exit, http, port, log, none" >&2
    exit 2 ;;
esac

if [ ! -d "$cwd" ]; then
  echo "tmux-background.sh: --cwd does not exist or is not a directory: $cwd" >&2
  exit 2
fi

case "$wait_mode" in
  http)
    if [ -z "$url" ]; then
      echo "tmux-background.sh: --url is required for --wait http" >&2
      exit 2
    fi ;;
  port)
    if [ -z "$port" ]; then
      echo "tmux-background.sh: --port is required for --wait port" >&2
      exit 2
    fi ;;
  log)
    if [ -z "$pattern" ]; then
      echo "tmux-background.sh: --pattern is required for --wait log" >&2
      exit 2
    fi ;;
esac

if ! command -v tmux >/dev/null 2>&1; then
  echo "tmux-background.sh: tmux is required" >&2
  exit 127
fi

safe_session=$(printf '%s' "$session" | tr -c 'A-Za-z0-9_.-' '-')
timestamp=$(date '+%Y%m%d-%H%M%S')
log_dir=${log_dir:-${log_root}/${safe_session}-${timestamp}}
pane_log=${log_dir}/pane.log
wait_log=${log_dir}/wait.log
run_script=${log_dir}/run.sh
metadata_file=${log_dir}/metadata.txt
exit_status_file=${log_dir}/exit.status
ready_status_file=${log_dir}/ready.status
# The runner waits on start_channel until output logging is attached. Readiness verdicts and the
# command's exit signal channel, which the launcher waits on unless --detach.
start_channel=pi-bg-${safe_session}-${timestamp}-start
channel=pi-bg-${safe_session}-${timestamp}-signal

mkdir -p "$log_dir"
: >"$pane_log"
: >"$wait_log"

quoted_command=$(printf '%q ' "$@")
# Resolved against the PATH the job runs with, so the job does not depend on a shell finding mise.
if mise_bin=$(command -v mise); then
  quoted_command="$(printf '%q' "$mise_bin") exec -- $quoted_command"
fi

# HTTP and port readiness are watched from inside the session, so the watcher ends with it.
case "$wait_mode" in
  http)
    watcher=$(printf '%q ' "$BASH" "$SCRIPT_DIR/wait-for-http.sh" --url "$url" --timeout "$timeout")
    [ -z "$expect_regex" ] || watcher="$watcher$(printf '%q ' --expect-regex "$expect_regex")" ;;
  port)
    watcher=$(printf '%q ' "$BASH" "$SCRIPT_DIR/wait-for-port.sh" --host "$host" --port "$port" --timeout "$timeout") ;;
  *)
    watcher= ;;
esac
[ -z "$watcher" ] ||
  watcher="{ $watcher>>$(printf '%q' "$wait_log") 2>&1; printf '%s\n' \"\$?\" >$(printf '%q' "$ready_status_file"); tmux wait-for -S $(printf '%q' "$channel"); } &"

cat >"$metadata_file" <<META
session=$session
cwd=$cwd
wait_mode=$wait_mode
timeout=$timeout
started_at=$(date -Iseconds)
command=$quoted_command
pane_log=$pane_log
wait_log=$wait_log
exit_status_file=$exit_status_file
ready_status_file=$ready_status_file
channel=$channel
META

cat >"$run_script" <<RUNNER
PATH=$(printf '%q' "$PATH"); export PATH
tmux wait-for $(printf '%q' "$start_channel")
printf '[%s] Starting command in tmux session: %s\n' "\$(date '+%Y-%m-%d %H:%M:%S')" $(printf '%q' "$session")
printf '[%s] Working directory: %s\n' "\$(date '+%Y-%m-%d %H:%M:%S')" $(printf '%q' "$cwd")
printf '[%s] Command is recorded in metadata: %s\n\n' "\$(date '+%Y-%m-%d %H:%M:%S')" $(printf '%q' "$metadata_file")
$watcher
cd $(printf '%q' "$cwd") && $quoted_command
rc=\$?
printf '\n[%s] Command exited with status %s\n' "\$(date '+%Y-%m-%d %H:%M:%S')" "\$rc"
printf '%s\n' "\$rc" >$(printf '%q' "$exit_status_file")
tmux wait-for -S $(printf '%q' "$channel")
RUNNER

if tmux has-session -t "=$session" 2>/dev/null; then
  if [ "$replace" -eq 1 ]; then
    tmux kill-session -t "=$session"
  else
    echo "tmux-background.sh: session already exists: $session" >&2
    echo "Use --replace to kill it first, or choose a new --session." >&2
    exit 3
  fi
fi

# The session runs the runner itself: no shell reads the command. Address the pane tmux created, never an
# index: base-index and pane-base-index vary by host.
if ! created=$(tmux new-session -d -P -F '#{pane_id} #{socket_path}' -s "$session" -c "$cwd" "$BASH" "$run_script"); then
  echo "tmux-background.sh: tmux could not create session: $session" >&2
  exit 4
fi
read -r target socket <<<"$created"
# Later calls address this server, whatever TMUX_TMPDIR says then.
printf 'socket=%s\n' "$socket" >>"$metadata_file"

if [ "$wait_mode" = log ]; then
  pipe_command="$(printf '%q ' "$BASH" "$SCRIPT_DIR/pipe-pane-watch.sh" --log "$pane_log" --pattern "$pattern" --channel "$channel" --status-file "$ready_status_file" --timeout "$timeout")"
else
  pipe_command="cat >> $(printf '%q' "$pane_log")"
fi
if ! { tmux pipe-pane -t "$target" -o "$pipe_command" && tmux wait-for -S "$start_channel"; }; then
  tmux kill-session -t "=$session" 2>/dev/null
  echo "tmux-background.sh: could not attach output logging or release the command; session $session was killed" >&2
  exit 5
fi

print_summary() {
  cat <<SUMMARY
session=$session
attach=tmux attach -t $session
kill=tmux kill-session -t $session
log_dir=$log_dir
pane_log=$pane_log
wait_log=$wait_log
metadata=$metadata_file
wait_mode=$wait_mode
SUMMARY
}

print_summary
if [ "$detach" -eq 1 ] || [ "$wait_mode" = none ]; then
  exit 0
fi

tmux wait-for "$channel"
if [ "$wait_mode" = exit ]; then
  read -r rc <"$exit_status_file"
  echo "exit_status=$rc"
  exit "$rc"
fi
if [ -s "$ready_status_file" ]; then
  read -r rc <"$ready_status_file"
else
  echo "tmux-background.sh: the command exited before it was ready" >&2
  rc=1
fi
echo "ready_status=$rc"
[ "$rc" -eq 0 ] || echo "Readiness failed; see $wait_log and $pane_log." >&2
exit "$rc"
