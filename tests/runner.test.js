'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { runAgent } = require('../scripts/agent-runner');
const { readStatus } = require('../scripts/status');

const fixture = path.join(__dirname, 'fixtures', 'fake-runtime.js');
const base = (loopDir, mode, timeoutMs = 1000) => ({
  agentId: 'worker-01', role: 'worker', model: 'test/fake', prompt: 'ignored',
  task: 'task-01', loopDir, timeoutMs, binary: process.execPath,
  buildArgs: () => [fixture, mode],
});

test('process crash becomes failed', async () => {
  const loopDir = fs.mkdtempSync(path.join(os.tmpdir(), 'loop-crash-'));
  const result = await runAgent(base(loopDir, 'crash'));
  assert.equal(result.success, false);
  assert.equal(readStatus('worker-01', loopDir).state, 'failed');
});

test('timeout becomes failed', async () => {
  const loopDir = fs.mkdtempSync(path.join(os.tmpdir(), 'loop-timeout-'));
  const result = await runAgent(base(loopDir, 'hang', 50));
  assert.equal(result.subtype, 'timeout');
  assert.equal(readStatus('worker-01', loopDir).state, 'failed');
});

test('retry replaces a prior terminal status before running', async () => {
  const loopDir = fs.mkdtempSync(path.join(os.tmpdir(), 'loop-retry-'));
  await runAgent(base(loopDir, 'crash'));
  assert.equal(readStatus('worker-01', loopDir).state, 'failed');
  const retry = runAgent({ ...base(loopDir, 'success'), attempt: 2 });
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(readStatus('worker-01', loopDir).state, 'running');
  assert.equal((await retry).success, true);
  assert.equal(readStatus('worker-01', loopDir).state, 'done');
});
