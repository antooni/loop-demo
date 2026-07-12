'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { ensureLoopDir } = require('../scripts/eventlog');
const { runController } = require('../scripts/controller');

test('controller waits outside the model and resumes Team Lead', async () => {
  const loopDir = fs.mkdtempSync(path.join(os.tmpdir(), 'loop-controller-'));
  ensureLoopDir(loopDir);
  fs.writeFileSync(path.join(loopDir, 'mission.md'), '# Mission\n');
  const calls = [];
  const fakeRun = async (options) => {
    calls.push(options);
    if (options.prompt.startsWith('[PLAN]')) {
      fs.writeFileSync(path.join(loopDir, 'tasks', 'task-01.md'), '# task-01: test\nphase: 1\n');
      return { success: true, sessionId: 'ses_lead', cost: 0.1 };
    }
    if (options.prompt.startsWith('[FINALIZE]')) {
      fs.writeFileSync(path.join(loopDir, 'report.md'), '# report\nstatus: success\n');
      return { success: true, sessionId: 'ses_lead', cost: 0.1 };
    }
    return { success: true, sessionId: 'ses_worker', cost: 0.01 };
  };
  const result = await runController({
    loopDir, runAgent: fakeRun,
    config: {
      orchestrator: { id: 'test/orchestrator' },
      teamLead: { id: 'test/lead', variant: 'max' },
      worker: { id: 'test/worker' },
      maxCostUsd: 3, timeoutMs: 1000, retries: 0,
    },
  });
  assert.equal(result.success, true);
  assert.deepEqual(calls.map((call) => call.prompt.split(' ')[0]), ['[PLAN]', '[WORK]', '[FINALIZE]']);
  assert.equal(calls[2].sessionId, 'ses_lead');
  assert.equal(calls[0].variant, 'max');
  assert.equal(calls.some((call) => /sleep|wait until/i.test(call.prompt)), false);
});
