#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { LOOP_DIR, writeStatus } = require('./status');
const { appendEvent, ensureLoopDir } = require('./eventlog');
const { loadConfig } = require('./controller');

const ROOT = path.resolve(__dirname, '..');
const mission = path.join(LOOP_DIR, 'mission.md');

if (!fs.existsSync(mission)) {
  console.error('ERROR: .loop/mission.md not found');
  process.exit(1);
}

ensureLoopDir();
const pidFile = path.join(LOOP_DIR, 'controller.pid');
if (fs.existsSync(pidFile)) {
  const pid = Number(fs.readFileSync(pidFile, 'utf8'));
  try {
    process.kill(pid, 0);
    console.error(`ERROR: controller is already running (pid ${pid})`);
    process.exit(1);
  } catch {}
}

const errorFd = fs.openSync(path.join(LOOP_DIR, 'logs', 'controller.err'), 'a');
const child = spawn(process.execPath, [path.join(__dirname, 'controller.js')], {
  cwd: ROOT,
  detached: true,
  stdio: ['ignore', 'ignore', errorFd],
});
fs.closeSync(errorFd);
fs.writeFileSync(pidFile, `${child.pid}\n`);
const config = loadConfig();
writeStatus({
  agent: 'orchestrator', role: 'orchestrator', state: 'launching',
  model: config.orchestrator.id, variant: config.orchestrator.variant,
}, LOOP_DIR);
appendEvent({ agent: 'controller', role: 'controller', model: 'deterministic', type: 'controller_started', detail: `pid ${child.pid}` });
child.unref();
console.log(`Mission controller started (pid ${child.pid}).`);
