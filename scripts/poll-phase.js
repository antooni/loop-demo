#!/usr/bin/env node
// Polls .loop/status/<worker>.json files until all reach a terminal state (done/failed).
// Usage: node scripts/poll-phase.js worker-01 worker-02 ...
const fs = require('fs');
const path = require('path');

const workers = process.argv.slice(2);
const root = path.join(__dirname, '..');

function readStatus(w) {
  const f = path.join(root, '.loop', 'status', `${w}.json`);
  try {
    return fs.readFileSync(f, 'utf8').trim();
  } catch {
    return '';
  }
}

function isTerminal(content) {
  return /"state":"(done|failed)"/.test(content);
}

function tick() {
  let allDone = true;
  for (const w of workers) {
    const content = readStatus(w);
    console.log(`${w}: ${content}`);
    if (!isTerminal(content)) allDone = false;
  }
  if (allDone) {
    console.log('ALL_TERMINAL');
    process.exit(0);
  } else {
    setTimeout(tick, 10000);
  }
}

tick();
