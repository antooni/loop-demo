'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { buildGraph, impact, neighbors, shortestPath, summary, writeGraph } = require('../scripts/code-index');

test('code index builds a deterministic queryable module graph', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'code-index-'));
  const write = (file, content) => {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), content);
  };
  write('tsconfig.json', JSON.stringify({ compilerOptions: { paths: { '@/*': ['src/*'] } } }));
  write('src/shared.ts', 'export const value = 1;\n');
  write('src/b.ts', "import lib from 'shared-package';\nimport { value } from '@/shared';\nexport { value, lib };\n");
  write('src/a.js', "module.exports = require('./b');\n");
  write('src/consumer.mjs', "import value from './a.js';\n");
  write('src/missing.js', "require('./absent');\n");
  write('src/unrelated.js', "require('shared-package');\n");
  write('node_modules/ignored/index.js', "require('../../src/a');\n");

  const graph = buildGraph(root);
  assert.equal(summary(graph).length, 6);
  assert.deepEqual(neighbors(graph, 'src/b.ts', 'out').nodes, ['file:src/b.ts', 'file:src/shared.ts', 'package:shared-package']);
  assert.equal(neighbors(graph, 'src/b.ts', 'both', 2).nodes.includes('file:src/unrelated.js'), false);
  assert.deepEqual(impact(graph, ['src/b.ts']).nodes, ['file:src/a.js', 'file:src/b.ts', 'file:src/consumer.mjs']);
  assert.deepEqual(shortestPath(graph, 'src/consumer.mjs', 'src/shared.ts').nodes, [
    'file:src/a.js', 'file:src/b.ts', 'file:src/consumer.mjs', 'file:src/shared.ts',
  ]);
  assert.equal(graph.unresolved[0].specifier, './absent');

  writeGraph(root);
  const first = fs.readFileSync(path.join(root, '.code-index/graph.json'), 'utf8');
  writeGraph(root);
  assert.equal(fs.readFileSync(path.join(root, '.code-index/graph.json'), 'utf8'), first);
});
