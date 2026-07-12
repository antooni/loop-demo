#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { spawn } = require('child_process');
const { appendEvent, ensureLoopDir, LOOP_DIR, trim } = require('./eventlog');
const { writeStatus } = require('./status');

const MODEL_RE = /^[a-z0-9._~-]+\/[a-z0-9._~:/-]+$/i;
const activeChildren = new Set();

function assertModel(model) {
  if (!MODEL_RE.test(model || '')) throw new Error(`model must be a full provider/model id: ${model || 'missing'}`);
}

function toolDetail(part = {}) {
  const state = part.state || {};
  if (state.title) return trim(state.title, 200);
  return trim(JSON.stringify(state.input || {}), 200);
}

function runAgent(options) {
  const {
    agentId,
    role,
    model,
    prompt,
    task,
    attempt = 1,
    sessionId,
    timeoutMs = 10 * 60_000,
    loopDir = LOOP_DIR,
    binary = 'opencode',
    extraArgs = [],
    buildArgs,
    manageStatus = role === 'worker',
    onEvent = () => {},
  } = options;

  assertModel(model);
  if (!/^[a-z0-9-]+$/.test(agentId || '')) throw new Error('invalid agent id');
  if (!['orchestrator', 'team-lead', 'worker'].includes(role)) throw new Error('invalid role');
  if (task && !/^task-[a-z0-9-]+$/.test(task)) throw new Error('invalid task id');

  ensureLoopDir(loopDir);
  const startedAt = Date.now();
  const base = { agent: agentId, role, model, attempt, task };
  const emit = (event) => {
    const value = { ...base, ...event };
    appendEvent(value, loopDir);
    onEvent(value);
  };

  if (manageStatus) writeStatus({ ...base, state: 'queued' }, loopDir);
  emit({ type: 'spawned', detail: `${role} attempt ${attempt}` });

  const defaultArgs = [
    'run', '--format', 'json', '--model', model, '--agent', role,
    '--title', `${agentId} attempt ${attempt}`,
    ...(sessionId ? ['--session', sessionId] : []),
    ...extraArgs,
    prompt,
  ];
  const args = buildArgs ? buildArgs({ role, model, prompt, sessionId, attempt }) : defaultArgs;
  const logsDir = path.join(loopDir, 'logs');
  fs.mkdirSync(logsDir, { recursive: true });
  const stderr = fs.createWriteStream(path.join(logsDir, `${agentId}-attempt-${attempt}.err`), { flags: 'a' });
  const raw = process.env.LOOP_RAW_LOGS === '1'
    ? fs.createWriteStream(path.join(logsDir, `${agentId}-attempt-${attempt}.raw.jsonl`), { flags: 'a' })
    : null;

  return new Promise((resolve) => {
    const child = spawn(binary, args, { cwd: path.resolve(__dirname, '..'), env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
    activeChildren.add(child);
    let actualSessionId = sessionId;
    let timedOut = false;
    let started = false;
    let finalText = '';
    let tokensIn = 0;
    let tokensOut = 0;
    let cost = 0;

    if (manageStatus) writeStatus({ ...base, state: 'running', pid: child.pid }, loopDir);
    child.stderr.pipe(stderr);

    let killTimer;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      killTimer = setTimeout(() => child.kill('SIGKILL'), 2000);
    }, timeoutMs);

    const lines = readline.createInterface({ input: child.stdout });
    lines.on('line', (line) => {
      raw?.write(`${line}\n`);
      let event;
      try {
        event = JSON.parse(line);
      } catch {
        emit({ type: 'runtime_warning', detail: trim(line, 300) });
        return;
      }
      actualSessionId ||= event.sessionID;
      if (!started && actualSessionId) {
        started = true;
        emit({ type: 'agent_started', session_id: actualSessionId });
      }
      if (event.type === 'tool_use') {
        emit({ type: 'tool_use', tool: event.part?.tool || 'tool', detail: toolDetail(event.part) });
      } else if (event.type === 'text' && event.part?.text?.trim()) {
        finalText = event.part.text;
        emit({ type: 'text', detail: trim(finalText, 400) });
      } else if (event.type === 'step_finish') {
        const tokens = event.part?.tokens || {};
        tokensIn += (tokens.input || 0) + (tokens.cache?.read || 0) + (tokens.cache?.write || 0);
        tokensOut += (tokens.output || 0) + (tokens.reasoning || 0);
        cost += event.part?.cost || 0;
      }
    });

    child.on('error', (error) => stderr.write(`${error.stack || error.message}\n`));
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      clearTimeout(killTimer);
      activeChildren.delete(child);
      stderr.end();
      raw?.end();
      const success = code === 0 && !timedOut;
      const subtype = timedOut ? 'timeout' : success ? 'success' : 'error';
      if (manageStatus) writeStatus({ ...base, state: success ? 'done' : 'failed', sessionId: actualSessionId }, loopDir);
      emit({
        type: 'result', subtype, session_id: actualSessionId,
        cost_usd: cost, tokens_in: tokensIn, tokens_out: tokensOut,
        duration_ms: Date.now() - startedAt,
        detail: success ? trim(finalText || 'finished', 400) : `exit ${code ?? signal ?? 'unknown'}`,
      });
      emit({ type: 'agent_exited', detail: timedOut ? 'timeout' : `exit ${code ?? signal ?? 'unknown'}` });
      resolve({ success, subtype, code, signal, sessionId: actualSessionId, cost, tokensIn, tokensOut, finalText });
    });
  });
}

function abortAll() {
  for (const child of activeChildren) child.kill('SIGTERM');
}

module.exports = { MODEL_RE, assertModel, runAgent, toolDetail, abortAll };
