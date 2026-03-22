/**
 * Oracle Unit Tests — pure logic, no network, no LLM.
 *
 * Tests: TOOLS_SCHEMA structure, requestApproval/resolveApproval,
 *        run_command.dangerous(), read_file.run(), edit_file.run()
 *
 * Usage: node tests/test_unit.js
 * (Can also be run by tests/run_tests.js)
 */

import { writeFileSync, mkdirSync, existsSync, readFileSync, unlinkSync } from 'fs';
import { join } from 'path';
import { TOOLS, TOOLS_SCHEMA } from '../agent/tools/index.js';
import { requestApproval, resolveApproval } from '../agent/approval.js';
import { runCommand } from '../agent/tools/run_command.js';
import { readFile } from '../agent/tools/read_file.js';
import { editFile } from '../agent/tools/edit_file.js';

// ── Harness ───────────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;
let section = '';

function describe(title) {
  section = title;
  console.log(`\n  ${title}`);
}

function pass(msg) {
  console.log(`    \x1b[32m✓\x1b[0m ${msg}`);
  passed++;
}

function fail(msg, detail = '') {
  console.error(`    \x1b[31m✗\x1b[0m ${msg}${detail ? `\n      ${detail}` : ''}`);
  failed++;
}

function expect(condition, msg, detail = '') {
  condition ? pass(msg) : fail(msg, detail);
}

async function expectThrows(fn, msg) {
  try {
    await fn();
    fail(msg, 'Expected an error to be thrown but nothing was thrown');
  } catch {
    pass(msg);
  }
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

const SANDBOX = 'C:/sandbox';
const FIXTURE = join(SANDBOX, 'unit_test_fixture.txt');
const EDIT_TARGET = join(SANDBOX, 'unit_test_edit.txt');

function setupFixtures() {
  if (!existsSync(SANDBOX)) mkdirSync(SANDBOX, { recursive: true });
  writeFileSync(FIXTURE, 'line one\nline two\nline three\nline four\nline five\n', 'utf8');
  writeFileSync(EDIT_TARGET, 'hello world\nfoo bar\nbaz\n', 'utf8');
}

function teardownFixtures() {
  for (const f of [FIXTURE, EDIT_TARGET]) {
    try { if (existsSync(f)) unlinkSync(f); } catch {}
  }
}

// ── TOOLS_SCHEMA ──────────────────────────────────────────────────────────────

describe('TOOLS_SCHEMA — structure');

const EXPECTED_TOOLS = ['read_file', 'write_file', 'edit_file', 'run_command', 'search_regex', 'code_symbols', 'web_fetch'];

{
  expect(Array.isArray(TOOLS_SCHEMA), 'TOOLS_SCHEMA is an array');
  expect(TOOLS_SCHEMA.length === EXPECTED_TOOLS.length, `has ${EXPECTED_TOOLS.length} tool definitions`);
}

{
  for (const name of EXPECTED_TOOLS) {
    const entry = TOOLS_SCHEMA.find(t => t.function?.name === name);
    expect(!!entry, `${name} is in TOOLS_SCHEMA`);
    expect(entry?.type === 'function', `${name} has type: 'function'`);
    expect(typeof entry?.function?.description === 'string', `${name} has a description`);
    expect(typeof entry?.function?.parameters === 'object', `${name} has parameters`);
    expect(Array.isArray(entry?.function?.parameters?.required), `${name} has required array`);
  }
}

describe('TOOLS_SCHEMA — required parameters');

{
  const schema = (name) => TOOLS_SCHEMA.find(t => t.function.name === name)?.function;

  expect(schema('read_file').parameters.required.includes('path'), 'read_file requires path');
  expect(schema('write_file').parameters.required.includes('path'), 'write_file requires path');
  expect(schema('write_file').parameters.required.includes('content'), 'write_file requires content');
  expect(schema('edit_file').parameters.required.includes('old_string'), 'edit_file requires old_string');
  expect(schema('edit_file').parameters.required.includes('new_string'), 'edit_file requires new_string');
  expect(schema('run_command').parameters.required.includes('command'), 'run_command requires command');
  expect(schema('search_regex').parameters.required.includes('pattern'), 'search_regex requires pattern');
  expect(schema('web_fetch').parameters.required.includes('url'), 'web_fetch requires url');
  expect(schema('web_fetch').parameters.required.includes('path'), 'web_fetch requires path');
}

describe('TOOLS registry — all schema entries have a run() implementation');

{
  for (const name of EXPECTED_TOOLS) {
    expect(typeof TOOLS[name]?.run === 'function', `${name} has a run() function`);
  }
}

// ── requestApproval / resolveApproval ─────────────────────────────────────────

describe('approval gate');

{
  const { id, promise } = requestApproval('write_file', { path: '/tmp/x.txt', content: 'hi' });
  expect(typeof id === 'string' && id.length > 0, 'requestApproval returns a string id');
  const resolved = resolveApproval(id, true);
  expect(resolved === true, 'resolveApproval returns true when id is found');
  const result = await promise;
  expect(result === true, 'approval promise resolves to true');
}

{
  const { id, promise } = requestApproval('edit_file', { path: '/tmp/y.txt' });
  resolveApproval(id, false);
  const result = await promise;
  expect(result === false, 'denial promise resolves to false');
}

{
  const notFound = resolveApproval('nonexistent-id-xyz', true);
  expect(notFound === false, 'resolveApproval returns false for unknown id');
}

// ── run_command.dangerous() ───────────────────────────────────────────────────

describe('run_command — dangerous() classification');

{
  const safe = [
    'git status',
    'git log --oneline -10',
    'git diff HEAD~1',
    'ls C:/oracle',
    'dir',
    'cat C:/sandbox/test.txt',
    'echo hello',
    'node --version',
    'npm list',
  ];
  for (const cmd of safe) {
    expect(!runCommand.dangerous({ command: cmd }), `safe: "${cmd}"`);
  }
}

{
  const dangerous = [
    'npm install express',
    'node script.js',
    'python main.py',
    'Remove-Item C:/foo',
    'del C:/foo.txt',
    'mkdir newdir',
    'cp file1 file2',
  ];
  for (const cmd of dangerous) {
    expect(runCommand.dangerous({ command: cmd }), `dangerous: "${cmd}"`);
  }
}

{
  // PowerShell subexpression injection — always dangerous
  expect(runCommand.dangerous({ command: 'echo $(rm -rf /)' }), '$(...) injection is dangerous');
  expect(runCommand.dangerous({ command: 'git log $(malicious)' }), '$(...) in safe prefix is still dangerous');
}

{
  // Empty/missing command — not dangerous (run() will throw "command is required" before executing)
  expect(!runCommand.dangerous({ command: '' }), 'empty command is not dangerous (run() will throw first)');
  expect(!runCommand.dangerous({}), 'missing command is not dangerous (run() will throw first)');
}

// ── read_file.run() ───────────────────────────────────────────────────────────

describe('read_file — error cases');

await expectThrows(
  () => readFile.run({}),
  'throws when path is missing'
);

await expectThrows(
  () => readFile.run({ path: 'C:/sandbox/does_not_exist_xyz.txt' }),
  'throws when file does not exist'
);

await expectThrows(
  () => readFile.run({ path: 'C:/sandbox' }),
  'throws when path is a directory'
);

describe('read_file — happy path');

setupFixtures();

{
  const content = await readFile.run({ path: FIXTURE });
  expect(content.includes('line one'), 'reads full file content');
  expect(content.includes('line five'), 'reads all lines');
}

{
  const content = await readFile.run({ path: FIXTURE, offset: 1, limit: 2 });
  const lines = content.split('\n').filter(Boolean);
  expect(lines[0] === 'line two', `offset=1 starts at line 2 (got: "${lines[0]}")`);
  expect(lines.length <= 2, `limit=2 returns at most 2 lines (got: ${lines.length})`);
}

{
  const content = await readFile.run({ path: FIXTURE, offset: 3 });
  expect(content.includes('line four'), 'offset=3 skips first 3 lines');
  expect(!content.includes('line one'), 'offset=3 does not include line one');
}

// ── edit_file.run() ───────────────────────────────────────────────────────────

describe('edit_file — error cases');

await expectThrows(
  () => editFile.run({}),
  'throws when path is missing'
);

await expectThrows(
  () => editFile.run({ path: EDIT_TARGET }),
  'throws when old_string is missing'
);

await expectThrows(
  () => editFile.run({ path: 'C:/sandbox/no_such_file.txt', old_string: 'x', new_string: 'y' }),
  'throws when file does not exist'
);

await expectThrows(
  () => editFile.run({ path: EDIT_TARGET, old_string: 'DOES NOT APPEAR', new_string: 'y' }),
  'throws when old_string not found in file'
);

describe('edit_file — happy path');

{
  // Reset the edit target before each write test
  writeFileSync(EDIT_TARGET, 'hello world\nfoo bar\nbaz\n', 'utf8');
  const result = await editFile.run({ path: EDIT_TARGET, old_string: 'hello world', new_string: 'goodbye world' });
  expect(result.includes('Edited'), `returns confirmation message (got: "${result}")`);
  const updated = readFileSync(EDIT_TARGET, 'utf8');
  expect(updated.includes('goodbye world'), 'new_string is present in file after edit');
  expect(!updated.includes('hello world'), 'old_string is gone after edit');
}

{
  // Duplicate old_string → should throw
  writeFileSync(EDIT_TARGET, 'dup dup\ndup\n', 'utf8');
  await expectThrows(
    () => editFile.run({ path: EDIT_TARGET, old_string: 'dup', new_string: 'rep' }),
    'throws when old_string matches multiple locations'
  );
}

teardownFixtures();

// ── Summary ───────────────────────────────────────────────────────────────────

console.log(`\n${'─'.repeat(50)}`);
console.log(`Unit tests: ${passed} passed, ${failed} failed`);
console.log('─'.repeat(50));

if (failed > 0) process.exit(1);
