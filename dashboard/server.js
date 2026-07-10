#!/usr/bin/env node
// Loop Engineering live dashboard server. Zero dependencies.
//
//   node dashboard/server.js          → http://localhost:3333
//
// Streams two things to the browser over SSE (/events):
//   event: log       — each new line of .loop/events.jsonl (full replay on connect)
//   event: snapshot  — current tasks (.loop/tasks/*.md) + agent statuses (.loop/status/*.json)
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const LOOP_DIR = path.join(ROOT, '.loop');
const EVENTS_FILE = path.join(LOOP_DIR, 'events.jsonl');
const TASKS_DIR = path.join(LOOP_DIR, 'tasks');
const STATUS_DIR = path.join(LOOP_DIR, 'status');
const PORT = Number(process.env.PORT || 3333);

const clients = new Set();
const history = []; // every event line seen so far (strings)
let readOffset = 0; // bytes of EVENTS_FILE already consumed
let partial = ''; // trailing incomplete line between polls

function ingestNewEvents() {
  let stat;
  try {
    stat = fs.statSync(EVENTS_FILE);
  } catch {
    return; // file not created yet
  }
  if (stat.size < readOffset) {
    // file was truncated/rotated (new mission) — start over
    readOffset = 0;
    partial = '';
    history.length = 0;
    broadcast('reset', '{}');
  }
  if (stat.size === readOffset) return;

  const fd = fs.openSync(EVENTS_FILE, 'r');
  try {
    const buf = Buffer.alloc(stat.size - readOffset);
    fs.readSync(fd, buf, 0, buf.length, readOffset);
    readOffset = stat.size;
    const chunks = (partial + buf.toString('utf8')).split('\n');
    partial = chunks.pop() || '';
    for (const line of chunks) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      history.push(trimmed);
      broadcast('log', trimmed);
    }
  } finally {
    fs.closeSync(fd);
  }
}

function readSnapshot() {
  const snapshot = { tasks: [], statuses: [] };
  try {
    for (const name of fs.readdirSync(TASKS_DIR).sort()) {
      if (!name.endsWith('.md')) continue;
      const text = fs.readFileSync(path.join(TASKS_DIR, name), 'utf8');
      const id = name.replace(/\.md$/, '');
      const title = (text.match(/^#\s*[\w-]+:\s*(.+)$/m) || [])[1] || id;
      const phase = Number((text.match(/^phase:\s*(\d+)/m) || [])[1] || 1);
      snapshot.tasks.push({ id, title: title.trim(), phase });
    }
  } catch {}
  try {
    for (const name of fs.readdirSync(STATUS_DIR).sort()) {
      if (!name.endsWith('.json')) continue;
      try {
        snapshot.statuses.push(JSON.parse(fs.readFileSync(path.join(STATUS_DIR, name), 'utf8')));
      } catch {} // agent may be mid-write; next tick will catch it
    }
  } catch {}
  return snapshot;
}

let lastSnapshotJson = '';
function pushSnapshotIfChanged() {
  const json = JSON.stringify(readSnapshot());
  if (json !== lastSnapshotJson) {
    lastSnapshotJson = json;
    broadcast('snapshot', json);
  }
}

function broadcast(event, data) {
  for (const res of clients) {
    res.write(`event: ${event}\ndata: ${data}\n\n`);
  }
}

const server = http.createServer((req, res) => {
  const url = (req.url || '/').split('?')[0];

  if (url === '/' || url === '/index.html') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(fs.readFileSync(path.join(__dirname, 'index.html')));
    return;
  }

  if (url === '/events') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    });
    res.write('retry: 2000\n\n');
    for (const line of history) res.write(`event: log\ndata: ${line}\n\n`);
    if (lastSnapshotJson) res.write(`event: snapshot\ndata: ${lastSnapshotJson}\n\n`);
    clients.add(res);
    req.on('close', () => clients.delete(res));
    return;
  }

  if (url === '/favicon.ico') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, clients: clients.size, events: history.length }));
    return;
  }

  res.writeHead(404);
  res.end('not found');
});

ingestNewEvents(); // preload anything already on disk
setInterval(ingestNewEvents, 400);
setInterval(pushSnapshotIfChanged, 1000);
setInterval(() => broadcast('ping', '{}'), 15000);

server.listen(PORT, () => {
  console.log(`Loop dashboard → http://localhost:${PORT}`);
});
