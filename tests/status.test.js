'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { writeStatus, readStatus, validateStatus } = require('../scripts/status');

test('status writes are atomic and validated', () => {
  const loopDir = fs.mkdtempSync(path.join(os.tmpdir(), 'loop-status-'));
  writeStatus({ agent: 'worker-01', role: 'worker', state: 'running', task: 'task-01', attempt: 1 }, loopDir);
  const status = readStatus('worker-01', loopDir);
  assert.equal(status.state, 'running');
  assert.equal(typeof status.updatedAt, 'number');
  assert.deepEqual(fs.readdirSync(path.join(loopDir, 'status')), ['worker-01.json']);
  assert.throws(() => validateStatus({ agent: 'worker-01', role: 'worker', state: 'verifying' }), /invalid worker state/);
  assert.throws(() => validateStatus({ agent: 'worker-01', role: 'worker', state: 'done', note: 'hidden corruption' }), /unknown status fields/);
});
