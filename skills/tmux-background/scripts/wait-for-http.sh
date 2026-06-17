#!/usr/bin/env bash
set -u

usage() {
  cat <<'USAGE'
Usage: wait-for-http.sh --url URL [--timeout SEC] [--interval SEC] [--expect-regex REGEX]

Wait until an HTTP endpoint returns success. By default, any curl -fsS success is
ready. With --expect-regex, the response body must also match REGEX.

Options:
  --url URL              URL to request (required)
  --timeout SEC          Maximum seconds to wait (default: 60)
  --interval SEC         Seconds between attempts inside this helper (default: 0.5)
  --expect-regex REGEX   Require response body to match this extended regex
  --curl-timeout SEC     Per-request curl timeout (default: 5)
  -h, --help             Show this help
USAGE
}

url=
timeout=60
interval=0.5
expect_regex=
curl_timeout=5

while [ "$#" -gt 0 ]; do
  case "$1" in
    --url)
      url=${2:?--url requires a value}; shift 2 ;;
    --timeout)
      timeout=${2:?--timeout requires a value}; shift 2 ;;
    --interval)
      interval=${2:?--interval requires a value}; shift 2 ;;
    --expect-regex)
      expect_regex=${2:?--expect-regex requires a value}; shift 2 ;;
    --curl-timeout)
      curl_timeout=${2:?--curl-timeout requires a value}; shift 2 ;;
    -h|--help)
      usage; exit 0 ;;
    *)
      echo "wait-for-http.sh: unknown argument: $1" >&2
      usage >&2
      exit 2 ;;
  esac
done

if [ -z "$url" ]; then
  echo "wait-for-http.sh: --url is required" >&2
  usage >&2
  exit 2
fi

start=$(date +%s)
deadline=$((start + timeout))
attempts=0
last_error_file=$(mktemp -t pi-wait-http-error.XXXXXX)
last_body_file=$(mktemp -t pi-wait-http-body.XXXXXX)
trap 'rm -f "$last_error_file" "$last_body_file"' EXIT

printf 'Waiting for HTTP %s (timeout=%ss)\n' "$url" "$timeout"
if [ -n "$expect_regex" ]; then
  printf 'Expecting response body to match regex: %s\n' "$expect_regex"
fi

while :; do
  attempts=$((attempts + 1))
  : >"$last_error_file"
  if curl -fsS --max-time "$curl_timeout" "$url" >"$last_body_file" 2>"$last_error_file"; then
    if [ -z "$expect_regex" ] || grep -Eq "$expect_regex" "$last_body_file"; then
      elapsed=$(( $(date +%s) - start ))
      printf 'HTTP %s is ready after %ss (%s attempts)\n' "$url" "$elapsed" "$attempts"
      exit 0
    fi
    printf 'HTTP succeeded but body did not match expected regex (attempt %s)\n' "$attempts" >&2
  fi

  now=$(date +%s)
  if [ "$now" -ge "$deadline" ]; then
    echo "Timed out after ${timeout}s waiting for HTTP ${url}" >&2
    echo "Last curl error:" >&2
    sed 's/^/  /' "$last_error_file" >&2 || true
    echo "Last response body preview:" >&2
    head -40 "$last_body_file" | sed 's/^/  /' >&2 || true
    exit 1
  fi

  sleep "$interval"
done
