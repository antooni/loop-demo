#!/usr/bin/env node
// Replays a scripted fake mission into .loop/ so you can watch the dashboard
// without spending a single token. Great for demos and UI development.
//
//   node dashboard/server.js        # terminal 1
//   node scripts/demo.js            # terminal 2, then watch http://localhost:3333
//
// DEMO_SPEED=3 node scripts/demo.js   → 3x faster
'use strict';

const fs = require('fs');
const path = require('path');
const { ROOT, LOOP_DIR, EVENTS_FILE, ensureLoopDir, appendEvent } = require('./eventlog');

const SPEED = Number(process.env.DEMO_SPEED || 1);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms / SPEED));

// Archive a previous real mission instead of mixing demo data into it.
if (fs.existsSync(EVENTS_FILE) && fs.statSync(EVENTS_FILE).size > 0) {
  const backup = path.join(ROOT, `.loop.prev-${Date.now()}`);
  fs.renameSync(LOOP_DIR, backup);
  console.log(`Previous .loop moved to ${path.basename(backup)}`);
}
ensureLoopDir();

const ev = (agent, role, model, type, extra = {}) =>
  appendEvent({ agent, role, model, type, ...extra });

const status = (agent, obj) =>
  fs.writeFileSync(
    path.join(LOOP_DIR, 'status', `${agent}.json`),
    JSON.stringify({ agent, ts: Date.now(), ...obj }) + '\n'
  );

const task = (id, title, phase, files, objective) =>
  fs.writeFileSync(
    path.join(LOOP_DIR, 'tasks', `${id}.md`),
    `# ${id}: ${title}\nphase: ${phase}\nfiles: ${files}\n\n## Objective\n${objective}\n\n## Definition of Done\n- it works\n\n## Verify\n\`\`\`bash\nnode --check ${files.split(',')[0]}\n\`\`\`\n`
  );

const orch = (type, extra) => ev('orchestrator', 'orchestrator', 'opus', type, extra);
const lead = (type, extra) => ev('team-lead', 'team-lead', 'sonnet', type, extra);
const worker = (n, type, extra) => ev(`worker-0${n}`, 'worker', 'haiku', type, extra);

async function workerRun(n, taskId, file, note, { fail = false } = {}) {
  const id = `worker-0${n}`;
  worker(n, 'spawned', { detail: `Worker for ${taskId} (attempt 1)` });
  await sleep(600);
  worker(n, 'agent_started', { detail: 'session demo' });
  status(id, { task: taskId, state: 'started', note: 'reading task file' });
  await sleep(900);
  status(id, { task: taskId, state: 'working', note });
  worker(n, 'tool_use', { tool: 'Write', detail: file });
  await sleep(1400);
  worker(n, 'tool_use', { tool: 'Bash', detail: `node --check ${file}` });
  status(id, { task: taskId, state: 'verifying', note: 'running verify command' });
  await sleep(1000);
  if (fail) {
    status(id, { task: taskId, state: 'failed', note: 'verify failed: SyntaxError line 12' });
    worker(n, 'result', { subtype: 'error', cost_usd: 0.021, tokens_in: 18400, tokens_out: 2100, detail: 'verify failed' });
    worker(n, 'agent_exited', { detail: 'finished' });
    return;
  }
  status(id, { task: taskId, state: 'done', note: `built ${file}` });
  worker(n, 'result', { subtype: 'success', cost_usd: 0.034, tokens_in: 26100, tokens_out: 3900, duration_ms: 121000, num_turns: 9, detail: `Implemented ${taskId}` });
  worker(n, 'agent_exited', { detail: 'finished' });
}

(async () => {
  console.log('Replaying demo mission… watch http://localhost:3333');

  // --- Orchestrator interviews the human -----------------------------------
  orch('agent_started', { detail: 'Orchestrator online — interviewing the human' });
  await sleep(1200);
  orch('user_prompt', { detail: 'Build me a tiny social feed: posts, likes, usernames' });
  await sleep(1500);
  orch('text', { detail: 'Estimate: 4 tasks, ~12 min, ~$0.80. Proposing scope: single page + Node server + JSON storage.' });
  await sleep(1500);
  orch('user_prompt', { detail: 'Approved, go!' });
  await sleep(800);
  orch('tool_use', { tool: 'Write', detail: '.loop/mission.md' });
  await sleep(700);
  orch('tool_use', { tool: 'Bash', detail: 'bash scripts/spawn-team-lead.sh' });

  // --- Team Lead plans -------------------------------------------------------
  await sleep(1000);
  lead('spawned', { detail: 'Team Lead process starting' });
  lead('agent_started', { detail: 'session demo' });
  status('team-lead', { state: 'planning', detail: 'splitting mission into tasks' });
  lead('tool_use', { tool: 'Read', detail: '.loop/mission.md' });
  await sleep(1800);

  task('task-01', 'Build the Node server with JSON storage', 1, 'workspace/server.js', 'HTTP server, GET/POST /posts, POST /posts/:id/like, JSON file storage.');
  task('task-02', 'Build the feed page UI', 1, 'workspace/public/index.html', 'Single page: post composer, feed list, like buttons.');
  task('task-03', 'Seed data + shared JSON shapes', 1, 'workspace/data/posts.json', 'Seed posts matching the interface contract.');
  task('task-04', 'Wire UI to API + smoke test', 2, 'workspace/public/app.js', 'Fetch calls per contract; end-to-end smoke test.');
  lead('tool_use', { tool: 'Write', detail: '.loop/tasks/task-01.md … task-04.md' });
  await sleep(1200);

  status('team-lead', { state: 'supervising', detail: 'phase 1: 3 workers in parallel' });
  lead('tool_use', { tool: 'Bash', detail: 'bash scripts/spawn-worker.sh task-01 & task-02 & task-03' });

  // --- Phase 1: three workers in parallel, one fails and is retried ---------
  await sleep(500);
  await Promise.all([
    workerRun(1, 'task-01', 'workspace/server.js', 'implementing POST /posts'),
    (async () => { await sleep(400); await workerRun(2, 'task-02', 'workspace/public/index.html', 'building the feed layout', { fail: true }); })(),
    (async () => { await sleep(800); await workerRun(3, 'task-03', 'workspace/data/posts.json', 'writing seed posts'); })(),
  ]);

  // Retry of the failed task
  lead('text', { detail: 'task-02 failed verify — appending feedback and retrying (attempt 2)' });
  lead('tool_use', { tool: 'Edit', detail: '.loop/tasks/task-02.md' });
  await sleep(900);
  await workerRun(2, 'task-02', 'workspace/public/index.html', 'fixing the syntax error from feedback');

  // --- Phase 2: integration --------------------------------------------------
  status('team-lead', { state: 'supervising', detail: 'phase 2: integration task' });
  lead('tool_use', { tool: 'Bash', detail: 'bash scripts/spawn-worker.sh task-04' });
  await sleep(400);
  await workerRun(4, 'task-04', 'workspace/public/app.js', 'wiring fetch calls to the API');

  // --- Team Lead verifies and reports ---------------------------------------
  status('team-lead', { state: 'integrating', detail: 'running acceptance criteria' });
  lead('tool_use', { tool: 'Bash', detail: 'node workspace/server.js & curl localhost:4000/posts' });
  await sleep(1600);
  fs.writeFileSync(path.join(LOOP_DIR, 'report.md'), '# Mission report: micro social feed\nstatus: success\n(demo replay)\n');
  lead('tool_use', { tool: 'Write', detail: '.loop/report.md' });
  status('team-lead', { state: 'done', detail: 'mission report written' });
  lead('result', { subtype: 'success', cost_usd: 0.19, tokens_in: 148000, tokens_out: 11200, duration_ms: 540000, num_turns: 31, detail: 'Mission success: 4/4 tasks done (1 retry)' });
  lead('agent_exited', { detail: 'finished' });

  // --- Orchestrator closes the loop ------------------------------------------
  await sleep(1200);
  orch('tool_use', { tool: 'Read', detail: '.loop/report.md' });
  await sleep(800);
  orch('text', { detail: 'Mission complete ✅ 4 tasks, 1 retry, ~$0.45 total vs $0.80 estimated. Run it: node workspace/server.js' });
  orch('agent_idle', { detail: 'waiting for user' });

  console.log('Demo finished. The dashboard now shows a full mission history.');
})();
