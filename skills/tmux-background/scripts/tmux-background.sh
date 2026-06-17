#!/usr/bin/env bash
set -u

usage() {
  cat <<'USAGE'
Usage: tmux-background.sh --session NAME [options] -- COMMAND [ARGS...]

Run COMMAND in a detached tmux session with audit logs and explicit
readiness/completion waiting.

Required:
  --session NAME          tmux session name
  -- COMMAND [ARGS...]    command to run; use "bash -lc '...'" for complex shell

Options:
  --cwd DIR               working directory (default: current directory)
  --wait MODE             exit | http | port | log | none (default: exit)
  --timeout SEC           readiness timeout for http/port/log waits (default: 60)
  --replace               kill an existing session with the same name first
  --log-root DIR          root for audit directories (default: ~/.cache/pi/tmux-background)

HTTP wait options:
  --url URL               URL to wait for (required for --wait http)
  --expect-regex REGEX    require HTTP response body to match regex

Port wait options:
  --host HOST             host to check (default: 127.0.0.1)
  --port PORT             port to check (required for --wait port)

Log wait options:
  --pattern REGEX         pane-output regex to wait for (required for --wait log)

Examples:
  tmux-background.sh --session dev --cwd "$PWD" --wait http --url http://127.0.0.1:3000 -- npm run dev
  tmux-background.sh --session tests --wait exit -- bash -lc 'bun test'
USAGE
}

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)

session=
cwd=$PWD
wait_mode=exit
timeout=60
replace=0
log_root=${HOME}/.cache/pi/tmux-background
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
log_dir=${log_root}/${safe_session}-${timestamp}
pane_log=${log_dir}/pane.log
wait_log=${log_dir}/wait.log
run_script=${log_dir}/run.sh
metadata_file=${log_dir}/metadata.txt
exit_status_file=${log_dir}/exit.status
ready_status_file=${log_dir}/ready.status
exit_channel=pi-bg-${safe_session}-${timestamp}-exit
ready_channel=pi-bg-${safe_session}-${timestamp}-ready
target=${session}:0.0

mkdir -p "$log_dir"
: >"$pane_log"
: >"$wait_log"

quoted_command=
for arg in "$@"; do
  printf -v quoted_arg '%q' "$arg"
  if [ -z "$quoted_command" ]; then
    quoted_command=$quoted_arg
  else
    quoted_command="$quoted_command $quoted_arg"
  fi
done

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
exit_channel=$exit_channel
ready_channel=$ready_channel
META

cat >"$run_script" <<RUNNER
#!/usr/bin/env bash
set +e
cd $(printf '%q' "$cwd") || exit 127
printf '[%s] Starting command in tmux session: %s\n' "\$(date '+%Y-%m-%d %H:%M:%S')" $(printf '%q' "$session")
printf '[%s] Working directory: %s\n' "\$(date '+%Y-%m-%d %H:%M:%S')" "\$PWD"
printf '[%s] Command is recorded in metadata: %s\n' "\$(date '+%Y-%m-%d %H:%M:%S')" $(printf '%q' "$metadata_file")
printf '\n'
$quoted_command
rc=\$?
printf '\n[%s] Command exited with status %s\n' "\$(date '+%Y-%m-%d %H:%M:%S')" "\$rc"
printf '%s\n' "\$rc" >$(printf '%q' "$exit_status_file")
tmux wait-for -S $(printf '%q' "$exit_channel") 2>/dev/null || true
printf '[%s] Session left open for inspection. Exit or kill tmux when done.\n' "\$(date '+%Y-%m-%d %H:%M:%S')"
exec "\${SHELL:-/bin/zsh}" -l
RUNNER
chmod +x "$run_script"

if tmux has-session -t "$session" 2>/dev/null; then
  if [ "$replace" -eq 1 ]; then
    tmux kill-session -t "$session"
  else
    echo "tmux-background.sh: session already exists: $session" >&2
    echo "Use --replace to kill it first, or choose a new --session." >&2
    exit 3
  fi
fi

tmux new-session -d -s "$session" -c "$cwd" "zsh -f"

if [ "$wait_mode" = log ]; then
  tmux pipe-pane -t "$target" -o \
    "$(printf '%q' "$SCRIPT_DIR/pipe-pane-watch.sh") --log $(printf '%q' "$pane_log") --pattern $(printf '%q' "$pattern") --channel $(printf '%q' "$ready_channel") --status-file $(printf '%q' "$ready_status_file") --timeout $(printf '%q' "$timeout")"
else
  tmux pipe-pane -t "$target" -o "cat >> $(printf '%q' "$pane_log")"
fi

tmux send-keys -t "$target" "$run_script" C-m

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

wait_with_helper() {
  helper_name=$1
  shift
  (
    "$SCRIPT_DIR/$helper_name" "$@" >>"$wait_log" 2>&1
    rc=$?
    printf '%s\n' "$rc" >"$ready_status_file"
    tmux wait-for -S "$ready_channel" 2>/dev/null || true
    exit "$rc"
  ) &
  tmux wait-for "$ready_channel"
  if [ -f "$ready_status_file" ]; then
    read -r ready_rc <"$ready_status_file"
  else
    ready_rc=99
  fi
  return "$ready_rc"
}

case "$wait_mode" in
  none)
    printf '0\n' >"$ready_status_file"
    print_summary
    echo "ready_status=not-waited"
    exit 0
    ;;
  exit)
    tmux wait-for "$exit_channel"
    if [ -f "$exit_status_file" ]; then
      read -r exit_rc <"$exit_status_file"
    else
      exit_rc=99
    fi
    print_summary
    echo "exit_status=$exit_rc"
    exit "$exit_rc"
    ;;
  http)
    helper_args=(--url "$url" --timeout "$timeout")
    if [ -n "$expect_regex" ]; then
      helper_args=("${helper_args[@]}" --expect-regex "$expect_regex")
    fi
    if wait_with_helper wait-for-http.sh "${helper_args[@]}"; then
      print_summary
      echo "ready_status=0"
      exit 0
    else
      rc=$?
      print_summary
      echo "ready_status=$rc"
      echo "Readiness failed; tmux session may still be running for inspection." >&2
      exit "$rc"
    fi
    ;;
  port)
    if wait_with_helper wait-for-port.sh --host "$host" --port "$port" --timeout "$timeout"; then
      print_summary
      echo "ready_status=0"
      exit 0
    else
      rc=$?
      print_summary
      echo "ready_status=$rc"
      echo "Readiness failed; tmux session may still be running for inspection." >&2
      exit "$rc"
    fi
    ;;
  log)
    tmux wait-for "$ready_channel"
    if [ -f "$ready_status_file" ]; then
      read -r ready_rc <"$ready_status_file"
    else
      ready_rc=99
    fi
    print_summary
    echo "ready_status=$ready_rc"
    if [ "$ready_rc" -ne 0 ]; then
      echo "Readiness failed; tmux session may still be running for inspection." >&2
    fi
    exit "$ready_rc"
    ;;
esac
