---
name: start
description: Start the Loop Engineering dashboard and requirements interview.
---

# Start

1. If an old `.loop/report.md`, task, or status exists, ask before archiving `.loop` to
   `.loop.prev-<timestamp>`. Never archive while `.loop/controller.pid` is alive.
2. Ensure `.loop/status`, `.loop/tasks`, `.loop/logs`, and `workspace` exist.
3. Check `http://127.0.0.1:3333/health`. It is the dashboard only when JSON contains
   `"service":"loop-dashboard"`. Otherwise start `node dashboard/server.js` in the
   background.
4. Run `node scripts/status.js orchestrator orchestrator interviewing`.
5. Tell the user the dashboard is at `http://127.0.0.1:3333`, then perform the short
   requirements interview and mandatory budget approval from `CLAUDE.md`.

After approval, write `.loop/mission.md`, run `node scripts/start-mission.js`, and return
to the conversation. The deterministic controller owns all waiting and retries.
