#!/usr/bin/env node
// Claude Code hook target: logs the interactive Orchestrator session into
// .loop/events.jsonl so the dashboard can show the top of the hierarchy too.
//
// Wired in .claude/settings.json for UserPromptSubmit, PostToolUse and Stop.
// Headless agents (spawned with LOOP_AGENT_ID set) are skipped here — their
// events already flow through scripts/event-pipe.js.
'use strict';

const { appendEvent, trim, summarizeToolInput } = require('./eventlog');

// Hooks inherit the claude process environment: for spawned children the
// spawn script sets LOOP_AGENT_ID, so this hook only logs the human session.
if (process.env.LOOP_AGENT_ID) process.exit(0);

let raw = '';
process.stdin.on('data', (chunk) => (raw += chunk));
process.stdin.on('end', () => {
  try {
    const payload = JSON.parse(raw || '{}');
    const base = { agent: 'orchestrator', role: 'orchestrator', model: 'opus' };

    switch (payload.hook_event_name) {
      case 'UserPromptSubmit':
        appendEvent({ ...base, type: 'user_prompt', detail: trim(payload.prompt, 300) });
        break;
      case 'PostToolUse':
        appendEvent({
          ...base,
          type: 'tool_use',
          tool: payload.tool_name,
          detail: summarizeToolInput(payload.tool_name, payload.tool_input),
        });
        break;
      case 'Stop':
        appendEvent({ ...base, type: 'agent_idle', detail: 'waiting for user' });
        break;
    }
  } catch {
    // A logging hook must never break the session.
  }
  process.exit(0);
});
