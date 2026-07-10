#!/usr/bin/env bash
# Spawns one Worker for one task file, headless and in the background.
# Called by the Team Lead, in parallel, once per task in the current phase.
#
# Usage: scripts/spawn-worker.sh <task-id> [attempt]
#   e.g. scripts/spawn-worker.sh task-01
#        scripts/spawn-worker.sh task-01 2     # retry
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

TASK_ID="${1:?usage: spawn-worker.sh <task-id> [attempt]}"
ATTEMPT="${2:-1}"
TASK_FILE="$ROOT/.loop/tasks/${TASK_ID}.md"

if [[ ! -f "$TASK_FILE" ]]; then
  echo "ERROR: $TASK_FILE not found." >&2
  exit 1
fi

mkdir -p .loop/status .loop/logs workspace

export LOOP_AGENT_ID="worker-${TASK_ID#task-}"
export LOOP_ROLE="worker"
export LOOP_MODEL="${LOOP_WORKER_MODEL:-haiku}"
PERMISSION_MODE="${LOOP_PERMISSION_MODE:-acceptEdits}"
MAX_TURNS="${LOOP_WORKER_MAX_TURNS:-50}"

node scripts/event-pipe.js --emit "{\"type\":\"spawned\",\"detail\":\"Worker for ${TASK_ID} (attempt ${ATTEMPT})\"}"

nohup bash -c "
  cd '$ROOT'
  claude -p '[WORKER] Your task file is .loop/tasks/${TASK_ID}.md (attempt ${ATTEMPT}). Read it and execute your Worker role as defined in your system prompt. Your agent id is ${LOOP_AGENT_ID}.' \
    --model '$LOOP_MODEL' \
    --append-system-prompt-file '$ROOT/agents/worker.md' \
    --output-format stream-json --verbose \
    --permission-mode '$PERMISSION_MODE' \
    --max-turns '$MAX_TURNS' \
    | node scripts/event-pipe.js
" > ".loop/logs/${LOOP_AGENT_ID}.out" 2> ".loop/logs/${LOOP_AGENT_ID}.err" &

echo $! > ".loop/${LOOP_AGENT_ID}.pid"
echo "Worker ${LOOP_AGENT_ID} started for ${TASK_ID} (attempt ${ATTEMPT}, pid $(cat ".loop/${LOOP_AGENT_ID}.pid"))."
