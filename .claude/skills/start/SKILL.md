---
name: start
description: Start the Loop Engineering demo — boots the live agent dashboard and begins the Orchestrator requirements interview. Use when the user says "start", "begin", "zaczynajmy" or wants to kick off a new mission.
---

# /start — boot the demo

Execute these steps in order, then hand control back to the conversation.

## 1. Prepare the runtime directories

```bash
mkdir -p .loop/status .loop/tasks .loop/logs workspace
```

If `.loop/report.md` or old task/status files exist from a previous mission, ask the
user whether to archive them (`mv .loop .loop.prev-$(date +%s)`) before starting fresh.

## 2. Start the dashboard (idempotent)

Check whether it is already running:

```bash
curl -s -o /dev/null -w "%{http_code}" http://localhost:3333/ || true
```

If the answer is not `200`, start it as a background task (use the Bash tool with
`run_in_background: true`):

```bash
node dashboard/server.js
```

## 3. Announce the Orchestrator on the event stream

```bash
node scripts/event-pipe.js --emit '{"agent":"orchestrator","role":"orchestrator","model":"opus","type":"agent_started","detail":"Orchestrator online — interviewing the human"}'
```

## 4. Greet and interview

Tell the user (in their language):
- the live dashboard is at **http://localhost:3333** — open it in a browser now,
- you will ask a few questions, estimate time and cost, and only start after approval.

Then begin the requirements interview exactly as specified in CLAUDE.md
(max 5 questions, steer toward a micro social app, mandatory estimate table).
