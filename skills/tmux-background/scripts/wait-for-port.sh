#!/usr/bin/env bash
set -u

usage() {
  cat <<'USAGE'
Usage: wait-for-port.sh --port PORT [--host HOST] [--timeout SEC] [--interval SEC]

Wait until HOST:PORT accepts TCP connections.

Options:
  --host HOST       Host to check (default: 127.0.0.1)
  --port PORT       TCP port to check (required)
  --timeout SEC     Maximum seconds to wait (default: 60)
  --interval SEC    Seconds between attempts inside this helper (default: 0.25)
  -h, --help        Show this help
USAGE
}

host=127.0.0.1
port=
timeout=60
interval=0.25

while [ "$#" -gt 0 ]; do
  case "$1" in
    --host)
      host=${2:?--host requires a value}; shift 2 ;;
    --port)
      port=${2:?--port requires a value}; shift 2 ;;
    --timeout)
      timeout=${2:?--timeout requires a value}; shift 2 ;;
    --interval)
      interval=${2:?--interval requires a value}; shift 2 ;;
    -h|--help)
      usage; exit 0 ;;
    *)
      echo "wait-for-port.sh: unknown argument: $1" >&2
      usage >&2
      exit 2 ;;
  esac
done

if [ -z "$port" ]; then
  echo "wait-for-port.sh: --port is required" >&2
  usage >&2
  exit 2
fi

start=$(date +%s)
deadline=$((start + timeout))
attempts=0

printf 'Waiting for TCP %s:%s (timeout=%ss)\n' "$host" "$port" "$timeout"

while :; do
  attempts=$((attempts + 1))
  if nc -z -w 1 "$host" "$port" >/dev/null 2>&1; then
    elapsed=$(( $(date +%s) - start ))
    printf 'TCP %s:%s is accepting connections after %ss (%s attempts)\n' \
      "$host" "$port" "$elapsed" "$attempts"
    exit 0
  fi

  now=$(date +%s)
  if [ "$now" -ge "$deadline" ]; then
    echo "Timed out after ${timeout}s waiting for TCP ${host}:${port}" >&2
    if command -v lsof >/dev/null 2>&1; then
      echo "lsof diagnostic for :${port}:" >&2
      lsof -nP -iTCP:"$port" -sTCP:LISTEN >&2 || true
    fi
    exit 1
  fi

  sleep "$interval"
done
