#!/usr/bin/env bash
# Run a CI command; on failure, publish its last lines as an error annotation.
# Annotations are readable without signing in to GitHub, unlike job logs.
#   scripts/ci-step.sh "<title>" <command...>
title="$1"
shift
log="$(mktemp)"
"$@" 2>&1 | tee "$log"
status=${PIPESTATUS[0]}
if [ "$status" -ne 0 ]; then
  # Prefer compiler/test error lines; fall back to the tail of the output.
  body="$(grep -E -A12 '^(error|FAIL|thread .* panicked)' "$log" | head -n 60)"
  [ -z "$body" ] && body="$(tail -n 40 "$log")"
  body="${body//'%'/'%25'}"
  body="${body//$'\r'/}"
  body="${body//$'\n'/'%0A'}"
  echo "::error title=${title}::${body}"
else
  # Test summaries (e.g. "webdriver on linux: 14/14 passed, 1 skipped") as a notice.
  summary="$(grep -E '^(SKIP |.* passed, [0-9]+ skipped)' "$log" | head -n 20)"
  if [ -n "$summary" ]; then
    summary="${summary//$'\r'/}"
    echo "::notice title=${title}::${summary//$'\n'/'%0A'}"
  fi
fi
exit "$status"
