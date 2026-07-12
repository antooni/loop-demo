#!/usr/bin/env node
'use strict';

const { spawn } = require('child_process');
const { loadConfig } = require('./controller');

const model = loadConfig().orchestrator;
const runtimeConfig = { agent: { orchestrator: {
  model: model.id,
  ...(model.variant ? { variant: model.variant } : {}),
} } };
const child = spawn('opencode', ['--agent', 'orchestrator'], {
  stdio: 'inherit',
  env: { ...process.env, OPENCODE_CONFIG_CONTENT: JSON.stringify(runtimeConfig) },
});
child.on('error', (error) => {
  console.error(error.message);
  process.exit(1);
});
child.on('close', (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
