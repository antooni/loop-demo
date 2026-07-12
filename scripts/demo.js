#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { ROOT, LOOP_DIR, EVENTS_FILE, ensureLoopDir, appendEvent } = require('./eventlog');
const { writeStatus } = require('./status');

const SPEED = Number(process.env.DEMO_SPEED || 1);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms / SPEED));
const models = {
  orchestrator: 'openrouter/openai/example-orchestrator',
  'team-lead': 'openrouter/anthropic/example-team-lead',
  worker: 'openrouter/anthropic/example-worker',
};

function controllerAlive() {
  const file = path.join(LOOP_DIR, 'controller.pid');
  if (!fs.existsSync(file)) return false;
  try {
    process.kill(Number(fs.readFileSync(file, 'utf8')), 0);
    return true;
  } catch {
    return false;
  }
}

if (controllerAlive()) throw new Error('A real mission controller is running');
if (fs.existsSync(EVENTS_FILE) && fs.statSync(EVENTS_FILE).size > 0) {
  const backup = path.join(ROOT, `.loop.prev-${Date.now()}`);
  fs.renameSync(LOOP_DIR, backup);
  console.log(`Previous .loop moved to ${path.basename(backup)}`);
}
ensureLoopDir();

const event = (agent, role, type, extra = {}) => appendEvent({ agent, role, model: models[role], type, ...extra });
const status = (agent, role, state, extra = {}) => writeStatus({ agent, role, state, model: models[role], ...extra });
const task = (id, title, phase, file) => fs.writeFileSync(
  path.join(LOOP_DIR, 'tasks', `${id}.md`),
  `# ${id}: ${title}\nphase: ${phase}\nfiles: ${file}\n\n## Objective\nBuild the requested piece.\n\n## Verify\n\`\`\`bash\nnode --check ${file}\n\`\`\`\n`,
);

async function worker(number, taskId, file, fail = false) {
  const id = `worker-${String(number).padStart(2, '0')}`;
  status(id, 'worker', 'queued', { task: taskId, attempt: 1 });
  event(id, 'worker', 'spawned', { task: taskId, attempt: 1 });
  await sleep(400);
  status(id, 'worker', 'running', { task: taskId, attempt: 1 });
  event(id, 'worker', 'agent_started', { task: taskId, session_id: `demo-${id}` });
  event(id, 'worker', 'tool_use', { task: taskId, tool: 'edit', detail: file });
  await sleep(1000);
  event(id, 'worker', 'tool_use', { task: taskId, tool: 'bash', detail: `node --check ${file}` });
  await sleep(600);
  status(id, 'worker', fail ? 'failed' : 'done', { task: taskId, attempt: 1 });
  event(id, 'worker', 'result', {
    task: taskId, subtype: fail ? 'error' : 'success', cost_usd: 0.03,
    tokens_in: 12000, tokens_out: 1800, detail: fail ? 'verification failed' : 'verified',
  });
  event(id, 'worker', 'agent_exited', { task: taskId, detail: fail ? 'exit 1' : 'exit 0' });
}

(async () => {
  console.log('Replaying demo mission at http://127.0.0.1:3333');
  status('orchestrator', 'orchestrator', 'interviewing');
  event('orchestrator', 'orchestrator', 'agent_started', { detail: 'requirements interview' });
  await sleep(700);
  status('orchestrator', 'orchestrator', 'awaiting_approval');
  event('orchestrator', 'orchestrator', 'text', { detail: 'Plan ready; awaiting budget approval' });
  await sleep(700);
  status('orchestrator', 'orchestrator', 'launching');
  status('team-lead', 'team-lead', 'starting');
  event('team-lead', 'team-lead', 'spawned', { detail: 'planning session' });
  await sleep(500);
  status('team-lead', 'team-lead', 'planning');
  task('task-01', 'Build server', 1, 'workspace/server.js');
  task('task-02', 'Build UI', 1, 'workspace/index.html');
  task('task-03', 'Integrate', 2, 'workspace/app.js');
  await sleep(700);
  status('orchestrator', 'orchestrator', 'monitoring');
  status('team-lead', 'team-lead', 'dispatching');
  const phaseOne = [worker(1, 'task-01', 'workspace/server.js'), worker(2, 'task-02', 'workspace/index.html')];
  status('team-lead', 'team-lead', 'waiting_workers');
  await Promise.all(phaseOne);
  status('team-lead', 'team-lead', 'reviewing_results');
  await sleep(500);
  status('team-lead', 'team-lead', 'dispatching');
  const phaseTwo = worker(3, 'task-03', 'workspace/app.js');
  status('team-lead', 'team-lead', 'waiting_workers');
  await phaseTwo;
  status('team-lead', 'team-lead', 'integrating');
  await sleep(500);
  status('orchestrator', 'orchestrator', 'verifying');
  status('team-lead', 'team-lead', 'verifying');
  event('team-lead', 'team-lead', 'tool_use', { tool: 'bash', detail: 'node --test' });
  await sleep(700);
  status('team-lead', 'team-lead', 'reporting');
  fs.writeFileSync(path.join(LOOP_DIR, 'report.md'), '# Demo report\nstatus: success\n');
  status('team-lead', 'team-lead', 'done');
  event('team-lead', 'team-lead', 'result', { subtype: 'success', cost_usd: 0.12, tokens_in: 40000, tokens_out: 5000, detail: 'mission verified' });
  status('orchestrator', 'orchestrator', 'reporting');
  await sleep(400);
  status('orchestrator', 'orchestrator', 'done');
  console.log('Demo finished.');
})();
