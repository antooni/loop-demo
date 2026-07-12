#!/usr/bin/env node
'use strict';

const { spawn } = require('child_process');
const { loadConfig } = require('./controller');

const model = loadConfig().orchestrator;
const args = [
  '--agent', 'orchestrator', '--model', model.id,
  ...(model.variant ? ['--variant', model.variant] : []),
];
const child = spawn('opencode', args, { stdio: 'inherit', env: process.env });
child.on('error', (error) => {
  console.error(error.message);
  process.exit(1);
});
child.on('close', (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
