#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const LOOP_DIR = path.join(ROOT, '.loop');

const STATES = {
  orchestrator: new Set([
    'interviewing', 'awaiting_approval', 'launching', 'monitoring',
    'verifying', 'reporting', 'done', 'failed',
  ]),
  'team-lead': new Set([
    'starting', 'planning', 'dispatching', 'waiting_workers',
    'reviewing_results', 'integrating', 'verifying', 'reporting',
    'done', 'failed',
  ]),
  worker: new Set(['queued', 'running', 'done', 'failed']),
};
const STATUS_FIELDS = new Set([
  'agent', 'role', 'state', 'model', 'task', 'attempt', 'pid', 'sessionId', 'updatedAt',
]);

function validateStatus(status) {
  if (!status || typeof status !== 'object') throw new Error('status must be an object');
  const unknown = Object.keys(status).filter((key) => !STATUS_FIELDS.has(key));
  if (unknown.length) throw new Error(`unknown status fields: ${unknown.join(', ')}`);
  if (!/^[a-z0-9-]+$/.test(status.agent || '')) throw new Error('invalid agent id');
  if (!STATES[status.role]?.has(status.state)) {
    throw new Error(`invalid ${status.role || 'unknown'} state: ${status.state || 'missing'}`);
  }
  if (status.task != null && !/^task-[a-z0-9-]+$/.test(status.task)) throw new Error('invalid task id');
  if (status.attempt != null && (!Number.isInteger(status.attempt) || status.attempt < 1)) {
    throw new Error('attempt must be a positive integer');
  }
  if (status.model != null && typeof status.model !== 'string') throw new Error('model must be a string');
  if (status.pid != null && (!Number.isInteger(status.pid) || status.pid < 1)) throw new Error('invalid pid');
  if (status.sessionId != null && typeof status.sessionId !== 'string') throw new Error('sessionId must be a string');
  if (status.updatedAt != null && (!Number.isInteger(status.updatedAt) || status.updatedAt < 1)) {
    throw new Error('invalid updatedAt');
  }
  return status;
}

function writeStatus(status, loopDir = LOOP_DIR) {
  const value = validateStatus({ ...status, updatedAt: Date.now() });
  const dir = path.join(loopDir, 'status');
  fs.mkdirSync(dir, { recursive: true });
  const target = path.join(dir, `${value.agent}.json`);
  const temporary = `${target}.${process.pid}.${Math.random().toString(16).slice(2)}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value)}\n`, 'utf8');
  fs.renameSync(temporary, target);
  return value;
}

function readStatus(agent, loopDir = LOOP_DIR) {
  const file = path.join(loopDir, 'status', `${agent}.json`);
  return validateStatus(JSON.parse(fs.readFileSync(file, 'utf8')));
}

if (require.main === module) {
  const [agent, role, state] = process.argv.slice(2);
  try {
    const config = JSON.parse(fs.readFileSync(path.join(ROOT, 'loop.config.json'), 'utf8'));
    const env = role === 'orchestrator' ? 'LOOP_ORCHESTRATOR_MODEL'
      : role === 'team-lead' ? 'LOOP_TEAM_LEAD_MODEL' : 'LOOP_WORKER_MODEL';
    writeStatus({ agent, role, state, model: process.env[env] || config.models?.[role === 'team-lead' ? 'teamLead' : role] });
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}

module.exports = { LOOP_DIR, STATES, validateStatus, writeStatus, readStatus };
