const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const parser = require('@babel/parser');

const ROOT = path.resolve(__dirname, '..');
const FEATURE_BASE = '43f46fd';
const MAX_FILE_LINES = 300;
const MAX_FUNCTION_LINES = 50;
const MAX_PARAMETERS = 3;
const MAX_NESTING = 3;
const MAX_COMPLEXITY = 10;
const FUNCTION_TYPES = new Set([
  'FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression',
  'ObjectMethod', 'ClassMethod',
]);
const CONTROL_TYPES = new Set([
  'IfStatement', 'ForStatement', 'ForInStatement', 'ForOfStatement',
  'WhileStatement', 'DoWhileStatement', 'SwitchStatement', 'TryStatement', 'CatchClause',
]);

function changedProductionFiles() {
  const output = childProcess.execFileSync(
    'git', ['diff', '--name-only', `${FEATURE_BASE}..HEAD`], { cwd: ROOT, encoding: 'utf8' },
  );
  return output.trim().split('\n').filter((file) => {
    if (!file || /^(?:test|e2e|docs|app|\.github)\//.test(file)) return false;
    return /\.(?:js|mjs|cjs|vue|html|css)$/.test(file) && fs.existsSync(path.join(ROOT, file));
  });
}

function scriptSource(file) {
  const source = fs.readFileSync(path.join(ROOT, file), 'utf8');
  if (!file.endsWith('.vue')) return source;
  const match = source.match(/<script(?:\s+setup)?[^>]*>([\s\S]*?)<\/script>/);
  return match?.[1] || '';
}

function functionMetrics(node) {
  let nesting = 0;
  let complexity = 1;
  function visit(current, depth) {
    if (!current || typeof current !== 'object') return;
    if (current !== node && FUNCTION_TYPES.has(current.type)) return;
    let nextDepth = depth;
    if (CONTROL_TYPES.has(current.type)) {
      nextDepth += 1;
      nesting = Math.max(nesting, nextDepth);
      if (current.type !== 'TryStatement') complexity += 1;
    }
    if (current.type === 'SwitchCase' && current.test) complexity += 1;
    if (current.type === 'ConditionalExpression') complexity += 1;
    for (const value of Object.values(current)) {
      if (Array.isArray(value)) value.forEach((item) => visit(item, nextDepth));
      else if (value?.type) visit(value, nextDepth);
    }
  }
  visit(node.body, 0);
  return { nesting, complexity };
}

function inspectFunctions(ast, file) {
  const violations = [];
  function visit(node) {
    if (!node || typeof node !== 'object') return;
    if (FUNCTION_TYPES.has(node.type)) {
      const lines = node.loc.end.line - node.loc.start.line + 1;
      const metrics = functionMetrics(node);
      if (lines > MAX_FUNCTION_LINES) violations.push(`${file}:${node.loc.start.line} lines=${lines}`);
      if (node.params.length > MAX_PARAMETERS) violations.push(`${file}:${node.loc.start.line} params=${node.params.length}`);
      if (metrics.nesting > MAX_NESTING) violations.push(`${file}:${node.loc.start.line} nesting=${metrics.nesting}`);
      if (metrics.complexity > MAX_COMPLEXITY) violations.push(`${file}:${node.loc.start.line} complexity=${metrics.complexity}`);
    }
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) value.forEach(visit);
      else if (value?.type) visit(value);
    }
  }
  visit(ast);
  return violations;
}

describe('multi-storage changed production code metrics', function () {
  it('keeps every changed production file and function within hard limits', function () {
    const violations = [];
    for (const file of changedProductionFiles()) {
      const source = fs.readFileSync(path.join(ROOT, file), 'utf8');
      const lines = source.split('\n').length;
      if (lines > MAX_FILE_LINES) violations.push(`${file} lines=${lines}`);
      if (!/\.(?:js|mjs|cjs|vue)$/.test(file)) continue;
      const script = scriptSource(file);
      if (!script) continue;
      const ast = parser.parse(script, { sourceType: 'unambiguous' });
      violations.push(...inspectFunctions(ast, file));
    }
    assert.deepEqual(violations, []);
  });
});
