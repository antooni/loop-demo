// Shared helpers for the Loop Engineering event log.
// Every agent action lands as one JSON line in .loop/events.jsonl,
// which the dashboard streams to the browser via SSE.
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const LOOP_DIR = path.join(ROOT, '.loop');
const EVENTS_FILE = path.join(LOOP_DIR, 'events.jsonl');

// USD per 1M tokens (input, output). Cache reads bill ~0.1x input,
// cache writes ~1.25x input. Used only when the CLI doesn't report cost itself.
const PRICING = [
  { match: 'opus', input: 5, output: 25 },
  { match: 'sonnet', input: 3, output: 15 },
  { match: 'haiku', input: 1, output: 5 },
];

function ensureLoopDir() {
  fs.mkdirSync(path.join(LOOP_DIR, 'status'), { recursive: true });
  fs.mkdirSync(path.join(LOOP_DIR, 'tasks'), { recursive: true });
  fs.mkdirSync(path.join(LOOP_DIR, 'logs'), { recursive: true });
}

function appendEvent(event) {
  ensureLoopDir();
  const line = JSON.stringify({ ts: Date.now(), ...event });
  // O_APPEND writes of a single small line are atomic enough for concurrent agents.
  fs.appendFileSync(EVENTS_FILE, line + '\n');
}

function trim(text, max = 300) {
  if (typeof text !== 'string') text = JSON.stringify(text);
  text = (text || '').replace(/\s+/g, ' ').trim();
  return text.length > max ? text.slice(0, max) + '…' : text;
}

// One-line human summary of a tool invocation, for the dashboard feed.
function summarizeToolInput(toolName, input) {
  if (!input || typeof input !== 'object') return '';
  switch (toolName) {
    case 'Bash':
      return trim(input.command, 200);
    case 'Read':
    case 'Write':
    case 'Edit':
      return trim(input.file_path, 200);
    case 'Glob':
    case 'Grep':
      return trim(input.pattern, 120);
    case 'Agent':
    case 'Task':
      return trim(input.description || input.prompt, 200);
    default:
      return trim(JSON.stringify(input), 160);
  }
}

function priceFor(model) {
  const m = (model || '').toLowerCase();
  return PRICING.find((p) => m.includes(p.match)) || null;
}

// Cost in USD for a usage block; used as fallback when the CLI
// result message carries no total_cost_usd.
function costFromUsage(model, usage) {
  const p = priceFor(model);
  if (!p || !usage) return 0;
  const inTok = usage.input_tokens || usage.inputTokens || 0;
  const outTok = usage.output_tokens || usage.outputTokens || 0;
  const cacheRead = usage.cache_read_input_tokens || usage.cacheReadInputTokens || 0;
  const cacheWrite = usage.cache_creation_input_tokens || usage.cacheCreationInputTokens || 0;
  return (
    (inTok * p.input +
      outTok * p.output +
      cacheRead * p.input * 0.1 +
      cacheWrite * p.input * 1.25) /
    1e6
  );
}

module.exports = {
  ROOT,
  LOOP_DIR,
  EVENTS_FILE,
  ensureLoopDir,
  appendEvent,
  trim,
  summarizeToolInput,
  costFromUsage,
};
