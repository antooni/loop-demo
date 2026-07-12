'use strict';

const mode = process.argv[2];

if (mode === 'crash') process.exit(7);
if (mode === 'hang') setInterval(() => {}, 1000);

if (mode === 'success') {
  const sessionID = 'ses_fake';
  console.log(JSON.stringify({ type: 'step_start', timestamp: Date.now(), sessionID, part: { type: 'step-start' } }));
  console.log(JSON.stringify({
    type: 'tool_use', timestamp: Date.now(), sessionID,
    part: { type: 'tool', tool: 'bash', state: { status: 'completed', input: { command: 'true' }, title: 'true' } },
  }));
  setTimeout(() => {
    console.log(JSON.stringify({ type: 'text', timestamp: Date.now(), sessionID, part: { type: 'text', text: 'finished' } }));
    console.log(JSON.stringify({
      type: 'step_finish', timestamp: Date.now(), sessionID,
      part: { type: 'step-finish', reason: 'stop', tokens: { input: 10, output: 2, reasoning: 1, cache: { read: 5, write: 0 } }, cost: 0.01 },
    }));
  }, 60);
}
