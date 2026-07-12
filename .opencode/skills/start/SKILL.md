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

## Estimated cost

Before presenting the budget for approval, compute an estimated cost:

1. Fetch current per-token pricing from `https://openrouter.ai/api/v1/models` for the
   three configured models (orchestrator, teamLead, worker).
2. Estimate token usage: Team Lead planning (~10k in / ~8k out), each worker task
   (~50k in / ~15k out, multiply by `workerRetries + 1`), Team Lead finalize
   (~80k in / ~10k out).
3. Present the itemised breakdown, the estimated total, and a 2x worst-case buffer.
4. Write the estimated total into `loop.config.json` as `estimatedCostUsd` so the
   dashboard can display it alongside real cost and the cap.

The dashboard Cost tile turns amber when real spend reaches the estimate, and red
when it reaches the cap (`maxCostUsd`). The "Est. / Cap" tile shows both values.

After approval, write `.loop/mission.md`, run `node scripts/start-mission.js`, and return
to the conversation. The deterministic controller owns all waiting and retries.
