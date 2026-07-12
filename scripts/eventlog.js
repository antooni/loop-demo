// Shared helpers for the Loop Engineering event log.
// Every agent action lands as one JSON line in .loop/events.jsonl,
// which the dashboard streams to the browser via SSE.
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const LOOP_DIR = path.join(ROOT, '.loop');
const EVENTS_FILE = path.join(LOOP_DIR, 'events.jsonl');

function ensureLoopDir(loopDir = LOOP_DIR) {
  fs.mkdirSync(path.join(loopDir, 'status'), { recursive: true });
  fs.mkdirSync(path.join(loopDir, 'tasks'), { recursive: true });
  fs.mkdirSync(path.join(loopDir, 'logs'), { recursive: true });
}

function appendEvent(event, loopDir = LOOP_DIR) {
  fs.mkdirSync(path.join(loopDir, 'status'), { recursive: true });
  fs.mkdirSync(path.join(loopDir, 'tasks'), { recursive: true });
  fs.mkdirSync(path.join(loopDir, 'logs'), { recursive: true });
  const line = JSON.stringify({ ts: Date.now(), event_id: crypto.randomUUID(), ...event });
  // O_APPEND writes of a single small line are atomic enough for concurrent agents.
  fs.appendFileSync(path.join(loopDir, 'events.jsonl'), line + '\n');
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

module.exports = {
  ROOT,
  LOOP_DIR,
  EVENTS_FILE,
  ensureLoopDir,
  appendEvent,
  trim,
  summarizeToolInput,
};
