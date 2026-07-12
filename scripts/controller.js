#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { runAgent, abortAll } = require('./agent-runner');
const { LOOP_DIR, writeStatus } = require('./status');
const { appendEvent, ensureLoopDir } = require('./eventlog');

const ROOT = path.resolve(__dirname, '..');

function loadConfig(file = path.join(ROOT, 'loop.config.json')) {
  const config = JSON.parse(fs.readFileSync(file, 'utf8'));
  const role = (name, envName, variantEnvName) => {
    const value = config.models?.[name];
    return {
      id: process.env[envName] || (typeof value === 'string' ? value : value?.id),
      variant: process.env[variantEnvName] || (typeof value === 'object' ? value.variant : undefined),
    };
  };
  return {
    orchestrator: role('orchestrator', 'LOOP_ORCHESTRATOR_MODEL', 'LOOP_ORCHESTRATOR_VARIANT'),
    teamLead: role('teamLead', 'LOOP_TEAM_LEAD_MODEL', 'LOOP_TEAM_LEAD_VARIANT'),
    worker: role('worker', 'LOOP_WORKER_MODEL', 'LOOP_WORKER_VARIANT'),
    maxCostUsd: Number(process.env.LOOP_MAX_COST_USD || config.maxCostUsd || 3),
    timeoutMs: Number(process.env.LOOP_AGENT_TIMEOUT_MS || config.agentTimeoutMs || 600_000),
    retries: Number(process.env.LOOP_WORKER_RETRIES || config.workerRetries || 1),
  };
}

function listTasks(loopDir = LOOP_DIR) {
  const dir = path.join(loopDir, 'tasks');
  return fs.readdirSync(dir)
    .filter((name) => /^task-[a-z0-9-]+\.md$/.test(name))
    .map((name) => {
      const id = name.slice(0, -3);
      const text = fs.readFileSync(path.join(dir, name), 'utf8');
      const phase = Number(text.match(/^phase:\s*(\d+)\s*$/m)?.[1]);
      if (!Number.isInteger(phase) || phase < 1) throw new Error(`${name}: missing valid phase`);
      return { id, phase };
    })
    .sort((a, b) => a.phase - b.phase || a.id.localeCompare(b.id));
}

async function runController(options = {}) {
  const loopDir = options.loopDir || LOOP_DIR;
  const config = { ...loadConfig(options.configFile), ...options.config };
  const run = options.runAgent || runAgent;
  let totalCost = 0;
  ensureLoopDir(loopDir);

  const status = (role, state) => writeStatus({
    agent: role === 'orchestrator' ? 'orchestrator' : 'team-lead', role, state,
    model: role === 'team-lead' ? config.teamLead.id : config.orchestrator.id,
    variant: role === 'team-lead' ? config.teamLead.variant : config.orchestrator.variant,
  }, loopDir);
  const fail = (message) => {
    status('team-lead', 'failed');
    status('orchestrator', 'failed');
    appendEvent({ agent: 'controller', role: 'controller', model: 'deterministic', type: 'controller_error', detail: message }, loopDir);
  };

  try {
    if (!fs.existsSync(path.join(loopDir, 'mission.md'))) throw new Error('.loop/mission.md not found');
    status('orchestrator', 'monitoring');
    status('team-lead', 'starting');
    status('team-lead', 'planning');

    const lead = await run({
      agentId: 'team-lead', role: 'team-lead', model: config.teamLead.id, variant: config.teamLead.variant,
      prompt: '[PLAN] Read .loop/mission.md and create 3-8 precise task files grouped into phases. This invocation only plans. Do not spawn workers, poll, implement, verify the mission, or write the final report. Finish immediately after writing the task files.',
      timeoutMs: config.timeoutMs, loopDir, manageStatus: false,
    });
    totalCost += lead.cost || 0;
    if (!lead.success) throw new Error(`Team Lead planning failed: ${lead.subtype}`);

    const tasks = listTasks(loopDir);
    if (!tasks.length) throw new Error('Team Lead produced no tasks');
    const phases = [...new Set(tasks.map((task) => task.phase))];

    for (const phase of phases) {
      if (totalCost >= config.maxCostUsd) throw new Error(`budget reached before phase ${phase}`);
      const phaseTasks = tasks.filter((task) => task.phase === phase);
      status('team-lead', 'dispatching');
      const pending = phaseTasks.map(async (task) => {
        let result;
        for (let attempt = 1; attempt <= config.retries + 1; attempt++) {
          result = await run({
            agentId: `worker-${task.id.slice(5)}`, role: 'worker', model: config.worker.id, variant: config.worker.variant,
            task: task.id, attempt, timeoutMs: config.timeoutMs, loopDir,
            prompt: `[WORK] Read .loop/tasks/${task.id}.md and complete exactly that task. Run its Verify command before finishing.`,
          });
          totalCost += result.cost || 0;
          if (result.success) break;
        }
        return { task, result };
      });
      status('team-lead', 'waiting_workers');
      const results = await Promise.all(pending);
      status('team-lead', 'reviewing_results');
      const failed = results.filter(({ result }) => !result.success);
      if (failed.length) throw new Error(`failed tasks: ${failed.map(({ task }) => task.id).join(', ')}`);
      if (totalCost >= config.maxCostUsd) throw new Error(`budget reached after phase ${phase}`);
    }

    status('team-lead', 'integrating');
    status('orchestrator', 'verifying');
    const finalized = await run({
      agentId: 'team-lead', role: 'team-lead', model: config.teamLead.id, variant: config.teamLead.variant,
      sessionId: lead.sessionId, timeoutMs: config.timeoutMs, loopDir, manageStatus: false,
      prompt: '[FINALIZE] All workers are terminal. Read their statuses and task files, run the mission acceptance criteria, and write .loop/report.md. Do not spawn workers or poll. Report failure honestly if verification fails.',
      onEvent(event) {
        if (event.type === 'tool_use' && event.tool === 'bash') status('team-lead', 'verifying');
        if (event.type === 'tool_use' && event.detail?.includes('report.md')) status('team-lead', 'reporting');
      },
    });
    totalCost += finalized.cost || 0;
    if (!finalized.success || !fs.existsSync(path.join(loopDir, 'report.md'))) {
      throw new Error('Team Lead finalization failed or report is missing');
    }
    status('team-lead', 'done');
    status('orchestrator', 'reporting');
    status('orchestrator', 'done');
    return { success: true, totalCost, tasks };
  } catch (error) {
    fail(error.message);
    return { success: false, totalCost, error };
  }
}

if (require.main === module) {
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.once(signal, () => {
      abortAll();
      process.exit(1);
    });
  }
  runController().then((result) => process.exit(result.success ? 0 : 1));
}

module.exports = { loadConfig, listTasks, runController };
