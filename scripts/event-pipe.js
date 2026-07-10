#!/usr/bin/env node
// Normalizes `claude -p --output-format stream-json` output into dashboard events.
//
// Usage (spawn scripts pipe headless agents through it):
//   claude -p "..." --output-format stream-json --verbose | node scripts/event-pipe.js
//
// One-off emit mode (used by /start and spawn scripts):
//   node scripts/event-pipe.js --emit '{"type":"mission_started","detail":"..."}'
//
// Agent identity comes from the environment set by the spawn script:
//   LOOP_AGENT_ID, LOOP_ROLE, LOOP_MODEL
'use strict';

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const {
  LOOP_DIR,
  ensureLoopDir,
  appendEvent,
  trim,
  summarizeToolInput,
  costFromUsage,
} = require('./eventlog');

const AGENT = process.env.LOOP_AGENT_ID || 'unknown';
const ROLE = process.env.LOOP_ROLE || 'unknown';
const MODEL = process.env.LOOP_MODEL || 'unknown';

function emit(event) {
  appendEvent({ agent: AGENT, role: ROLE, model: MODEL, ...event });
}

// --emit mode: append a single event and exit.
const emitIdx = process.argv.indexOf('--emit');
if (emitIdx !== -1) {
  emit(JSON.parse(process.argv[emitIdx + 1]));
  process.exit(0);
}

ensureLoopDir();
const rawLog = fs.createWriteStream(path.join(LOOP_DIR, 'logs', `${AGENT}.raw.jsonl`), { flags: 'a' });

let sawResult = false;

function handleLine(line) {
  line = line.trim();
  if (!line) return;
  rawLog.write(line + '\n');

  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return; // non-JSON noise on stdout — ignore
  }

  if (msg.type === 'system' && msg.subtype === 'init') {
    emit({ type: 'agent_started', detail: `session ${msg.session_id || ''}`.trim() });
    return;
  }

  if (msg.type === 'assistant' && msg.message && Array.isArray(msg.message.content)) {
    for (const block of msg.message.content) {
      if (block.type === 'text' && block.text && block.text.trim()) {
        emit({ type: 'text', detail: trim(block.text, 400) });
      } else if (block.type === 'tool_use') {
        emit({ type: 'tool_use', tool: block.name, detail: summarizeToolInput(block.name, block.input) });
      }
    }
    return;
  }

  if (msg.type === 'result') {
    sawResult = true;
    const usage = msg.usage || {};
    let cost = typeof msg.total_cost_usd === 'number' ? msg.total_cost_usd : null;
    if (cost === null && msg.modelUsage && typeof msg.modelUsage === 'object') {
      cost = 0;
      for (const [model, u] of Object.entries(msg.modelUsage)) {
        cost += typeof u.costUSD === 'number' ? u.costUSD : costFromUsage(model, u);
      }
    }
    if (cost === null) cost = costFromUsage(MODEL, usage);

    const tokensIn =
      (usage.input_tokens || 0) +
      (usage.cache_read_input_tokens || 0) +
      (usage.cache_creation_input_tokens || 0);
    const tokensOut = usage.output_tokens || 0;

    emit({
      type: 'result',
      subtype: msg.subtype || 'unknown',
      cost_usd: Math.round(cost * 10000) / 10000,
      tokens_in: tokensIn,
      tokens_out: tokensOut,
      duration_ms: msg.duration_ms || 0,
      num_turns: msg.num_turns || 0,
      detail: trim(msg.result || msg.subtype || '', 400),
    });
  }
}

const rl = readline.createInterface({ input: process.stdin, terminal: false });
rl.on('line', handleLine);
rl.on('close', () => {
  emit({ type: 'agent_exited', detail: sawResult ? 'finished' : 'stream ended without result' });
  rawLog.end();
});
