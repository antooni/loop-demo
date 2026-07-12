#!/usr/bin/env node
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { validateStatus } = require('../scripts/status');

const ROOT = path.resolve(__dirname, '..');

function parseStatus(text) {
  return validateStatus(JSON.parse(text));
}

function createDashboardServer(options = {}) {
  const loopDir = options.loopDir || path.join(ROOT, '.loop');
  const eventsFile = path.join(loopDir, 'events.jsonl');
  const tasksDir = path.join(loopDir, 'tasks');
  const statusDir = path.join(loopDir, 'status');
  const indexFile = options.indexFile || path.join(__dirname, 'index.html');
  const clients = new Set();
  const history = [];
  const invalidStatuses = new Map();
  let readOffset = 0;
  let partial = Buffer.alloc(0);
  let fileKey = null;
  let lastSnapshotJson = '';

  function send(res, event, data, id) {
    if (id) res.write(`id: ${id}\n`);
    res.write(`event: ${event}\ndata: ${data}\n\n`);
  }

  function broadcast(event, data, id) {
    for (const res of clients) send(res, event, data, id);
  }

  function reset() {
    readOffset = 0;
    partial = Buffer.alloc(0);
    history.length = 0;
    lastSnapshotJson = '';
    broadcast('reset', '{}', 'reset');
  }

  function ingestNewEvents() {
    let stat;
    try {
      stat = fs.statSync(eventsFile);
    } catch {
      if (fileKey) {
        reset();
        fileKey = null;
      }
      return;
    }
    const nextFileKey = `${stat.dev}:${stat.ino}`;
    if (fileKey && (fileKey !== nextFileKey || stat.size < readOffset)) reset();
    fileKey = nextFileKey;
    if (stat.size === readOffset) return;

    const length = stat.size - readOffset;
    const buffer = Buffer.alloc(length);
    const fd = fs.openSync(eventsFile, 'r');
    let bytesRead = 0;
    try {
      bytesRead = fs.readSync(fd, buffer, 0, length, readOffset);
    } finally {
      fs.closeSync(fd);
    }
    readOffset += bytesRead;
    const data = Buffer.concat([partial, buffer.subarray(0, bytesRead)]);
    let start = 0;
    for (let i = 0; i < data.length; i++) {
      if (data[i] !== 10) continue;
      const line = data.subarray(start, i).toString('utf8').trim();
      start = i + 1;
      if (!line) continue;
      let event;
      try {
        event = JSON.parse(line);
      } catch {
        continue;
      }
      const id = event.event_id || `${event.ts || 0}:${history.length}`;
      history.push({ id, line });
      broadcast('log', line, id);
    }
    partial = data.subarray(start);
  }

  function readBudget() {
    try {
      const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, "loop.config.json"), "utf8"));
      return {
        maxCostUsd: cfg.maxCostUsd ?? null,
        estimatedCostUsd: cfg.estimatedCostUsd ?? null,
      };
    } catch { return { maxCostUsd: null, estimatedCostUsd: null }; }
  }

  function readSnapshot() {
    const snapshot = { tasks: [], statuses: [], budget: readBudget() };
    try {
      for (const name of fs.readdirSync(tasksDir).sort()) {
        if (!name.endsWith('.md')) continue;
        const text = fs.readFileSync(path.join(tasksDir, name), 'utf8');
        const id = name.replace(/\.md$/, '');
        const title = (text.match(/^#\s*[\w-]+:\s*(.+)$/m) || [])[1] || id;
        const phase = Number((text.match(/^phase:\s*(\d+)/m) || [])[1] || 1);
        snapshot.tasks.push({ id, title: title.trim(), phase });
      }
    } catch {}

    try {
      for (const name of fs.readdirSync(statusDir).sort()) {
        if (!name.endsWith('.json')) continue;
        const file = path.join(statusDir, name);
        const text = fs.readFileSync(file, 'utf8');
        try {
          snapshot.statuses.push(parseStatus(text));
          invalidStatuses.delete(name);
        } catch (error) {
          const fingerprint = `${text}:${error.message}`;
          if (invalidStatuses.get(name) !== fingerprint) {
            invalidStatuses.set(name, fingerprint);
            const id = `status:${name}:${Date.now()}`;
            const event = JSON.stringify({
              ts: Date.now(), event_id: id,
              agent: 'controller', role: 'controller', model: 'deterministic',
              type: 'status_invalid', detail: `${name}: ${error.message}`,
            });
            history.push({ id, line: event });
            broadcast('log', event, id);
          }
        }
      }
    } catch {}
    return snapshot;
  }

  function pushSnapshotIfChanged() {
    const json = JSON.stringify(readSnapshot());
    if (json !== lastSnapshotJson) {
      lastSnapshotJson = json;
      broadcast('snapshot', json);
    }
  }

  const server = http.createServer((req, res) => {
    const url = (req.url || '/').split('?')[0];
    if (url === '/' || url === '/index.html') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(fs.readFileSync(indexFile));
      return;
    }
    if (url === '/events') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });
      res.write('retry: 2000\n\n');
      const lastId = req.headers['last-event-id'];
      let start = 0;
      if (lastId) {
        const found = history.findIndex((item) => item.id === lastId);
        if (found === -1) send(res, 'reset', '{}', 'reset');
        else start = found + 1;
      }
      for (const item of history.slice(start)) send(res, 'log', item.line, item.id);
      if (lastSnapshotJson) send(res, 'snapshot', lastSnapshotJson);
      clients.add(res);
      req.on('close', () => clients.delete(res));
      return;
    }
    if (url === '/favicon.ico') {
      res.writeHead(204).end();
      return;
    }
    if (url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ service: 'loop-dashboard', ok: true, clients: clients.size, events: history.length }));
      return;
    }
    res.writeHead(404).end('not found');
  });

  const intervals = [];
  function start(port = Number(process.env.PORT || 3333), host = process.env.HOST || '127.0.0.1') {
    ingestNewEvents();
    pushSnapshotIfChanged();
    intervals.push(setInterval(ingestNewEvents, 400));
    intervals.push(setInterval(pushSnapshotIfChanged, 1000));
    intervals.push(setInterval(() => broadcast('ping', '{}'), 15000));
    return new Promise((resolve) => server.listen(port, host, () => resolve(server.address())));
  }

  function close() {
    for (const interval of intervals) clearInterval(interval);
    return new Promise((resolve) => server.close(resolve));
  }

  return { server, start, close, ingestNewEvents, readSnapshot, history };
}

if (require.main === module) {
  const dashboard = createDashboardServer();
  dashboard.start().then((address) => {
    console.log(`Loop dashboard -> http://${address.address}:${address.port}`);
  });
}

module.exports = { createDashboardServer, parseStatus };
