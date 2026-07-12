'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { appendEvent, ensureLoopDir } = require('../scripts/eventlog');
const { createDashboardServer } = require('../dashboard/server');

function readEvents(port, headers, until) {
  return new Promise((resolve, reject) => {
    let body = '';
    const req = http.get({ host: '127.0.0.1', port, path: '/events', headers }, (res) => {
      res.on('data', (chunk) => {
        body += chunk;
        if (body.includes(until)) {
          req.destroy();
          resolve(body);
        }
      });
    });
    req.on('error', (error) => error.code === 'ECONNRESET' ? resolve(body) : reject(error));
    setTimeout(() => { req.destroy(); reject(new Error(`SSE timeout: ${body}`)); }, 1000).unref();
  });
}

test('SSE reconnect resumes after Last-Event-ID', async () => {
  const loopDir = fs.mkdtempSync(path.join(os.tmpdir(), 'loop-dashboard-'));
  ensureLoopDir(loopDir);
  appendEvent({ agent: 'worker-01', role: 'worker', model: 'test/fake', type: 'text', detail: 'first-event' }, loopDir);
  const dashboard = createDashboardServer({ loopDir });
  const address = await dashboard.start(0, '127.0.0.1');
  try {
    const first = await readEvents(address.port, {}, 'first-event');
    const id = first.match(/^id: (.+)$/m)?.[1];
    assert.ok(id);
    appendEvent({ agent: 'worker-01', role: 'worker', model: 'test/fake', type: 'text', detail: 'second-event' }, loopDir);
    dashboard.ingestNewEvents();
    const second = await readEvents(address.port, { 'Last-Event-ID': id }, 'second-event');
    assert.doesNotMatch(second, /first-event/);
    assert.match(second, /second-event/);
  } finally {
    await dashboard.close();
  }
});

test('removing the event log resets dashboard history', () => {
  const loopDir = fs.mkdtempSync(path.join(os.tmpdir(), 'loop-dashboard-reset-'));
  ensureLoopDir(loopDir);
  appendEvent({ agent: 'worker-01', role: 'worker', model: 'test/fake', type: 'text', detail: 'old-event' }, loopDir);
  const dashboard = createDashboardServer({ loopDir });
  dashboard.ingestNewEvents();

  fs.unlinkSync(path.join(loopDir, 'events.jsonl'));
  dashboard.ingestNewEvents();

  assert.deepEqual(dashboard.history, []);
});

test('malformed status is rejected and surfaced once', () => {
  const loopDir = fs.mkdtempSync(path.join(os.tmpdir(), 'loop-invalid-'));
  ensureLoopDir(loopDir);
  fs.writeFileSync(path.join(loopDir, 'status', 'worker-01.json'), '{broken');
  const dashboard = createDashboardServer({ loopDir });
  assert.deepEqual(dashboard.readSnapshot().statuses, []);
  assert.equal(dashboard.history.filter((item) => item.line.includes('status_invalid')).length, 1);
  dashboard.readSnapshot();
  assert.equal(dashboard.history.filter((item) => item.line.includes('status_invalid')).length, 1);
});
