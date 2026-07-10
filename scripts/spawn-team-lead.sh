#!/usr/bin/env bash
# Spawns the Team Lead as a headless `claude -p` process in the background.
# Called by the Orchestrator after the mission is approved and written to
# .loop/mission.md. All output is normalized into .loop/events.jsonl.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

MISSION="$ROOT/.loop/mission.md"
if [[ ! -f "$MISSION" ]]; then
  echo "ERROR: $MISSION not found. The Orchestrator must write the mission first." >&2
  exit 1
fi

mkdir -p .loop/status .loop/tasks .loop/logs workspace

export LOOP_AGENT_ID="team-lead"
export LOOP_ROLE="team-lead"
export LOOP_MODEL="${LOOP_TEAM_LEAD_MODEL:-sonnet}"
PERMISSION_MODE="${LOOP_PERMISSION_MODE:-acceptEdits}"

node scripts/event-pipe.js --emit '{"type":"spawned","detail":"Team Lead process starting"}'

nohup bash -c "
  cd '$ROOT'
  claude -p '[TEAM-LEAD] Read .loop/mission.md and execute your Team Lead role as defined in your system prompt.' \
    --model '$LOOP_MODEL' \
    --append-system-prompt-file '$ROOT/agents/team-lead.md' \
    --output-format stream-json --verbose \
    --permission-mode '$PERMISSION_MODE' \
    | node scripts/event-pipe.js
" > .loop/logs/team-lead.out 2> .loop/logs/team-lead.err &

echo $! > .loop/team-lead.pid
echo "Team Lead started in background (pid $(cat .loop/team-lead.pid))."
echo "Live dashboard: http://localhost:3333"
