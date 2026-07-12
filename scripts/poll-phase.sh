#!/usr/bin/env bash
# Polls the given worker status files until all reach a terminal state (done/failed).
# Usage: scripts/poll-phase.sh worker-01 worker-02 ...
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

WORKERS=("$@")

while true; do
  ALL_DONE=1
  for w in "${WORKERS[@]}"; do
    f=".loop/status/${w}.json"
    content=$(cat "$f" 2>/dev/null)
    echo "${w}: ${content}"
    if ! printf '%s' "$content" | grep -Eq '"state":"(done|failed)"'; then
      ALL_DONE=0
    fi
  done
  if [ "$ALL_DONE" -eq 1 ]; then
    echo "ALL_TERMINAL"
    break
  fi
  sleep 10
done
