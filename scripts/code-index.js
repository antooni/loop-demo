#!/usr/bin/env node
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const INDEX_FILE = '.code-index/graph.json';
const EXTENSIONS = ['.js', '.cjs', '.mjs', '.jsx', '.ts', '.tsx'];
const IGNORED_DIRS = new Set(['.git', '.code-index', '.next', 'coverage', 'dist', 'node_modules']);

const slash = (value) => value.split(path.sep).join('/');
const fileId = (file) => `file:${file}`;

function walk(root, dir = root, files = [], tsconfigs = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) continue;
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!IGNORED_DIRS.has(entry.name) && entry.name !== '.loop' && !entry.name.startsWith('.loop.prev-')) {
        walk(root, absolute, files, tsconfigs);
      }
    } else if (entry.name === 'tsconfig.json') {
      tsconfigs.push(absolute);
    } else if (EXTENSIONS.includes(path.extname(entry.name))) {
      files.push(absolute);
    }
  }
  return { files, tsconfigs };
}

function loadAliases(tsconfigs) {
  const aliases = [];
  for (const file of tsconfigs.sort()) {
    const config = JSON.parse(fs.readFileSync(file, 'utf8'));
    const compiler = config.compilerOptions || {};
    const base = path.resolve(path.dirname(file), compiler.baseUrl || '.');
    for (const [pattern, targets] of Object.entries(compiler.paths || {})) {
      if (!pattern.endsWith('*') || !Array.isArray(targets)) continue;
      for (const target of targets) {
        if (typeof target === 'string' && target.endsWith('*')) {
          aliases.push({ root: path.dirname(file), prefix: pattern.slice(0, -1), base, target: target.slice(0, -1) });
        }
      }
    }
  }
  return aliases.sort((a, b) => b.root.length - a.root.length || b.prefix.length - a.prefix.length);
}

function importsFrom(text) {
  const found = [];
  const strings = [];
  const masked = [...text];
  for (let index = 0; index < text.length;) {
    if (text[index] === '/' && text[index + 1] === '/') {
      while (index < text.length && text[index] !== '\n') masked[index++] = ' ';
    } else if (text[index] === '/' && text[index + 1] === '*') {
      masked[index++] = masked[index++] = ' ';
      while (index < text.length && !(text[index] === '*' && text[index + 1] === '/')) {
        if (text[index] !== '\n') masked[index] = ' ';
        index++;
      }
      if (index < text.length) masked[index++] = masked[index++] = ' ';
    } else if (text[index] === "'" || text[index] === '"' || text[index] === '`') {
      const start = index;
      const quote = text[index];
      masked[index++] = ' ';
      let value = '';
      while (index < text.length && text[index] !== quote) {
        if (text[index] === '\\' && index + 1 < text.length) {
          value += text[index + 1];
          masked[index++] = masked[index++] = ' ';
        } else {
          value += text[index];
          if (text[index] !== '\n') masked[index] = ' ';
          index++;
        }
      }
      if (index < text.length) masked[index++] = ' ';
      strings.push({ start, end: index, value, quote });
    } else {
      index++;
    }
  }
  const code = masked.join('');
  const add = (string, position) => {
    if (string && string.quote !== '`') found.push({ specifier: string.value, line: text.slice(0, position).split('\n').length });
  };

  for (const match of code.matchAll(/\b(?:require|import)\s*\(/g)) {
    add(strings.find((string) => string.start >= match.index + match[0].length && !code.slice(match.index + match[0].length, string.start).trim()), match.index);
  }
  for (const match of code.matchAll(/^\s*(?:import|export)\b/gm)) {
    const end = code.indexOf(';', match.index);
    const limit = end < 0 ? Math.min(code.length, match.index + 2000) : end;
    const statement = code.slice(match.index, limit);
    const fromMatch = /\bfrom\b/g;
    let sourceAt = null;
    for (const candidate of statement.matchAll(fromMatch)) sourceAt = match.index + candidate.index + candidate[0].length;
    if (sourceAt != null) {
      add(strings.find((string) => string.start >= sourceAt && string.start < limit), match.index);
    } else if (match[0].trim() === 'import') {
      add(strings.find((string) => string.start >= match.index + match[0].length && string.start < limit && !code.slice(match.index + match[0].length, string.start).trim()), match.index);
    }
  }
  return found.sort((a, b) => a.line - b.line || a.specifier.localeCompare(b.specifier));
}

function resolveFile(base, sourceFiles) {
  const candidates = [base, ...EXTENSIONS.map((extension) => `${base}${extension}`), ...EXTENSIONS.map((extension) => path.join(base, `index${extension}`))];
  return candidates.find((candidate) => sourceFiles.has(path.normalize(candidate)));
}

function resolveSpecifier(specifier, source, sourceFiles, aliases) {
  if (specifier.startsWith('.')) return resolveFile(path.resolve(path.dirname(source), specifier), sourceFiles);
  const alias = aliases.find((item) => source.startsWith(`${item.root}${path.sep}`) && specifier.startsWith(item.prefix));
  if (alias) return resolveFile(path.resolve(alias.base, alias.target + specifier.slice(alias.prefix.length)), sourceFiles);
  return null;
}

function buildGraph(root = ROOT) {
  root = path.resolve(root);
  const scanned = walk(root);
  const sourceFiles = new Set(scanned.files.map(path.normalize));
  const aliases = loadAliases(scanned.tsconfigs);
  const nodes = [];
  const edges = [];
  const unresolved = [];
  const packages = new Set();

  for (const absolute of [...sourceFiles].sort()) {
    const relative = slash(path.relative(root, absolute));
    const text = fs.readFileSync(absolute, 'utf8');
    nodes.push({
      id: fileId(relative), kind: 'file', label: relative, source_file: relative,
      language: ['.ts', '.tsx'].includes(path.extname(absolute)) ? 'typescript' : 'javascript',
      sha256: crypto.createHash('sha256').update(text).digest('hex'),
    });
    for (const item of importsFrom(text)) {
      const resolved = resolveSpecifier(item.specifier, absolute, sourceFiles, aliases);
      if (resolved) {
        edges.push({
          source: fileId(relative), target: fileId(slash(path.relative(root, resolved))), relation: 'imports',
          specifier: item.specifier, source_file: relative, source_location: `L${item.line}`, confidence: 'EXTRACTED',
        });
      } else if (item.specifier.startsWith('.') || aliases.some((alias) => item.specifier.startsWith(alias.prefix))) {
        unresolved.push({ source: fileId(relative), specifier: item.specifier, source_location: `L${item.line}` });
      } else {
        packages.add(item.specifier);
        edges.push({
          source: fileId(relative), target: `package:${item.specifier}`, relation: 'imports',
          specifier: item.specifier, source_file: relative, source_location: `L${item.line}`, confidence: 'EXTRACTED',
        });
      }
    }
  }

  for (const name of [...packages].sort()) nodes.push({ id: `package:${name}`, kind: 'package', label: name });
  const byJson = (a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b));
  edges.sort(byJson);
  unresolved.sort(byJson);
  return { schema: 1, root: '.', nodes, edges, unresolved };
}

function writeGraph(root = ROOT) {
  const graph = buildGraph(root);
  const target = path.join(root, INDEX_FILE);
  const content = `${JSON.stringify(graph, null, 2)}\n`;
  fs.mkdirSync(path.dirname(target), { recursive: true });
  if (fs.existsSync(target) && fs.readFileSync(target, 'utf8') === content) return graph;
  const temporary = `${target}.${process.pid}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(temporary, content);
  fs.renameSync(temporary, target);
  return graph;
}

function readGraph(root = ROOT) {
  const file = path.join(root, INDEX_FILE);
  if (!fs.existsSync(file)) throw new Error(`index not found; run: node scripts/code-index.js build`);
  const graph = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (graph.schema !== 1 || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) throw new Error('unsupported code index');
  return graph;
}

function resolveNode(graph, value) {
  const normalized = slash(value.replace(/^file:/, '').replace(/^\.\//, ''));
  const id = fileId(normalized);
  if (!graph.nodes.some((node) => node.id === id)) throw new Error(`file not indexed: ${value}`);
  return id;
}

function subgraph(graph, ids) {
  return {
    nodes: [...ids].sort(),
    edges: graph.edges.filter((edge) => ids.has(edge.source) && ids.has(edge.target)).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
  };
}

function neighbors(graph, value, direction = 'both', depth = 1) {
  if (!['in', 'out', 'both'].includes(direction)) throw new Error('direction must be in, out, or both');
  if (!Number.isInteger(depth) || depth < 1) throw new Error('depth must be a positive integer');
  const start = resolveNode(graph, value);
  const seen = new Set([start]);
  let frontier = [start];
  for (let level = 0; level < depth; level++) {
    const next = [];
    for (const id of frontier) {
      for (const edge of graph.edges) {
        const candidates = [];
        if (direction !== 'in' && edge.source === id) candidates.push(edge.target);
        if (direction !== 'out' && edge.target === id) candidates.push(edge.source);
        for (const candidate of candidates) {
          if (!seen.has(candidate)) {
            seen.add(candidate);
            if (candidate.startsWith('file:')) next.push(candidate);
          }
        }
      }
    }
    frontier = next;
  }
  return subgraph(graph, seen);
}

function impact(graph, values) {
  const seen = new Set(values.map((value) => resolveNode(graph, value)));
  const queue = [...seen];
  for (let index = 0; index < queue.length; index++) {
    for (const edge of graph.edges) {
      if (edge.target === queue[index] && edge.source.startsWith('file:') && !seen.has(edge.source)) {
        seen.add(edge.source);
        queue.push(edge.source);
      }
    }
  }
  return subgraph(graph, seen);
}

function shortestPath(graph, from, to) {
  const start = resolveNode(graph, from);
  const end = resolveNode(graph, to);
  const previous = new Map([[start, null]]);
  const queue = [start];
  for (let index = 0; index < queue.length && !previous.has(end); index++) {
    const current = queue[index];
    for (const edge of graph.edges) {
      const next = edge.source === current ? edge.target : edge.target === current ? edge.source : null;
      if (next?.startsWith('file:') && !previous.has(next)) { previous.set(next, current); queue.push(next); }
    }
  }
  if (!previous.has(end)) return { nodes: [], edges: [] };
  const ids = new Set();
  for (let current = end; current; current = previous.get(current)) ids.add(current);
  return subgraph(graph, ids);
}

function summary(graph) {
  const incoming = new Map();
  for (const edge of graph.edges) incoming.set(edge.target, (incoming.get(edge.target) || 0) + 1);
  return graph.nodes.filter((node) => node.kind === 'file').map((node) => ({
    file: node.label,
    imports: graph.edges.filter((edge) => edge.source === node.id && edge.target.startsWith('file:')).map((edge) => edge.target.slice(5)).sort(),
    importedBy: incoming.get(node.id) || 0,
  }));
}

function main(args = process.argv.slice(2), root = ROOT) {
  const [command, ...values] = args;
  if (command === 'build') {
    const graph = writeGraph(root);
    console.log(JSON.stringify({ files: graph.nodes.filter((node) => node.kind === 'file').length, edges: graph.edges.length, unresolved: graph.unresolved.length }));
    return;
  }
  const graph = readGraph(root);
  let result;
  if (command === 'summary') result = summary(graph);
  else if (command === 'neighbors') result = neighbors(graph, values[0], values[1] || 'both', Number(values[2] || 1));
  else if (command === 'impact') result = impact(graph, values);
  else if (command === 'path') result = shortestPath(graph, values[0], values[1]);
  else throw new Error('usage: code-index.js build|summary|neighbors <file> [in|out|both] [depth]|impact <files...>|path <from> <to>');
  console.log(JSON.stringify(result, null, 2));
}

if (require.main === module) {
  try { main(); } catch (error) { console.error(`ERROR: ${error.message}`); process.exit(1); }
}

module.exports = { buildGraph, impact, importsFrom, neighbors, shortestPath, summary, writeGraph };
