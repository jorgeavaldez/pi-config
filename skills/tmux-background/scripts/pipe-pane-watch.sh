#!/usr/bin/env bash
set -u

usage() {
  cat <<'USAGE'
Usage: pipe-pane-watch.sh --log FILE --pattern REGEX --channel CHANNEL --status-file FILE [--timeout SEC]

Consume tmux pipe-pane output from stdin, append it to FILE, and signal CHANNEL
when REGEX appears in the output. ANSI escape sequences are stripped for regex
matching. The script keeps logging after readiness so pane output remains
auditable.

Options:
  --log FILE          Output log to append raw pane text to (required)
  --pattern REGEX     Extended regex to match after ANSI stripping (required)
  --channel CHANNEL   tmux wait-for channel to signal on success/failure (required)
  --status-file FILE  File that receives readiness status code (required)
  --timeout SEC       Maximum seconds before signaling failure (default: 60)
  -h, --help          Show this help
USAGE
}

log_file=
pattern=
channel=
status_file=
timeout=60

while [ "$#" -gt 0 ]; do
  case "$1" in
    --log)
      log_file=${2:?--log requires a value}; shift 2 ;;
    --pattern)
      pattern=${2:?--pattern requires a value}; shift 2 ;;
    --channel)
      channel=${2:?--channel requires a value}; shift 2 ;;
    --status-file)
      status_file=${2:?--status-file requires a value}; shift 2 ;;
    --timeout)
      timeout=${2:?--timeout requires a value}; shift 2 ;;
    -h|--help)
      usage; exit 0 ;;
    *)
      echo "pipe-pane-watch.sh: unknown argument: $1" >&2
      usage >&2
      exit 2 ;;
  esac
done

if [ -z "$log_file" ] || [ -z "$pattern" ] || [ -z "$channel" ] || [ -z "$status_file" ]; then
  echo "pipe-pane-watch.sh: --log, --pattern, --channel, and --status-file are required" >&2
  usage >&2
  exit 2
fi

mkdir -p "$(dirname "$log_file")" "$(dirname "$status_file")"

timestamp() { date '+%Y-%m-%d %H:%M:%S'; }

strip_ansi() {
  perl -pe 's/\e\[[0-9;?]*[ -\/]*[@-~]//g; s/\r//g'
}

signal_once() {
  code=$1
  message=$2
  if [ ! -e "$status_file" ]; then
    printf '%s\n' "$code" >"$status_file"
    printf '[%s] %s\n' "$(timestamp)" "$message" >>"$log_file"
    tmux wait-for -S "$channel" 2>/dev/null || true
  fi
}

(
  sleep "$timeout"
  signal_once 1 "Timed out after ${timeout}s waiting for log pattern: ${pattern}"
) &
timer_pid=$!

trap 'kill "$timer_pid" 2>/dev/null || true' EXIT

printf '[%s] Watching pane output for regex: %s\n' "$(timestamp)" "$pattern" >>"$log_file"

while IFS= read -r line; do
  printf '%s\n' "$line" >>"$log_file"
  if [ ! -e "$status_file" ]; then
    clean_line=$(printf '%s\n' "$line" | strip_ansi)
    if printf '%s\n' "$clean_line" | grep -Eq "$pattern"; then
      signal_once 0 "Matched log readiness pattern: ${pattern}"
    fi
  fi
done

signal_once 2 "Pane output ended before matching log pattern: ${pattern}"
