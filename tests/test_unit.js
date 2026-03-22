/**
 * Oracle Unit Tests — pure logic, no network, no LLM.
 *
 * Tests: extractToolCalls, stripToolCalls, buildToolsPrompt,
 *        requestApproval/resolveApproval, run_command.dangerous(),
 *        read_file.run(), edit_file.run()
 *
 * Usage: node tests/test_unit.js
 * (Can also be run by tests/run_tests.js)
 */

import { writeFileSync, mkdirSync, existsSync, readFileSync, unlinkSync } from 'fs';
import { join } from 'path';
import { extractToolCalls, stripToolCalls, buildToolsPrompt, TOOLS } from '../agent/tools/index.js';
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

// ── extractToolCalls ──────────────────────────────────────────────────────────

describe('extractToolCalls — basic');

{
  const calls = extractToolCalls('<tool name="read_file"><path>/tmp/foo.txt</path></tool>');
  expect(calls.length === 1, 'parses a single tool call');
  expect(calls[0]?.name === 'read_file', 'correct tool name');
  expect(calls[0]?.args?.path === '/tmp/foo.txt', 'correct path arg');
}

describe('extractToolCalls — numeric/boolean coercion');

{
  const calls = extractToolCalls(`
    <tool name="read_file">
      <path>/tmp/file.txt</path>
      <offset>5</offset>
      <limit>20</limit>
    </tool>
  `);
  expect(calls.length === 1, 'parses one call');
  expect(calls[0]?.args?.offset === 5, 'offset coerced to number');
  expect(calls[0]?.args?.limit === 20, 'limit coerced to number');
}

{
  // write_file is in TOOLS so boolean dangerous flag parsing matters
  const calls = extractToolCalls(`
    <tool name="write_file">
      <path>/tmp/out.txt</path>
      <content>hello</content>
    </tool>
  `);
  expect(calls.length === 1, 'parses write_file');
  expect(calls[0]?.args?.content === 'hello', 'content arg correct');
}

describe('extractToolCalls — multiline arg value');

{
  const calls = extractToolCalls(`<tool name="write_file">
<path>/tmp/x.txt</path>
<content>line 1
line 2
line 3</content>
</tool>`);
  expect(calls.length === 1, 'parses multiline arg');
  expect(calls[0]?.args?.content?.includes('line 2'), 'multiline content preserved');
}

describe('extractToolCalls — multiple calls');

{
  const calls = extractToolCalls(`
    <tool name="read_file"><path>/a.txt</path></tool>
    some text in between
    <tool name="read_file"><path>/b.txt</path></tool>
  `);
  expect(calls.length === 2, 'parses two tool calls');
  expect(calls[0]?.args?.path === '/a.txt', 'first call path correct');
  expect(calls[1]?.args?.path === '/b.txt', 'second call path correct');
}

describe('extractToolCalls — unknown tool ignored');

{
  const calls = extractToolCalls('<tool name="nonexistent_tool"><arg>val</arg></tool>');
  expect(calls.length === 0, 'unknown tool is silently ignored');
}

describe('extractToolCalls — no tool calls in plain text');

{
  const calls = extractToolCalls('Just a normal response with no tool calls.');
  expect(calls.length === 0, 'returns empty array for plain text');
}

// ── stripToolCalls ────────────────────────────────────────────────────────────

describe('stripToolCalls');

{
  const stripped = stripToolCalls('Before <tool name="read_file"><path>/x</path></tool> After');
  expect(stripped === 'Before  After'.trim(), 'removes tool tag, preserves surrounding text',
    `got: "${stripped}"`);
}

{
  const stripped = stripToolCalls('<tool name="read_file"><path>/a</path></tool><tool name="read_file"><path>/b</path></tool>');
  expect(stripped === '', 'removes multiple tool tags, result is empty');
}

{
  const plain = 'Just a normal response.';
  expect(stripToolCalls(plain) === plain, 'no-op on text without tool tags');
}

// ── buildToolsPrompt ──────────────────────────────────────────────────────────

describe('buildToolsPrompt');

{
  const prompt = buildToolsPrompt(['read_file', 'write_file']);
  expect(prompt.includes('read_file'), 'includes read_file when in filter');
  expect(prompt.includes('write_file'), 'includes write_file when in filter');
  expect(!prompt.includes('run_command'), 'excludes run_command when not in filter');
}

{
  const prompt = buildToolsPrompt(); // all tools
  expect(prompt.includes('read_file'), 'all-tools prompt includes read_file');
  expect(prompt.includes('run_command'), 'all-tools prompt includes run_command');
  expect(prompt.includes('web_fetch'), 'all-tools prompt includes web_fetch');
}

{
  const prompt = buildToolsPrompt(['code_symbols']);
  expect(prompt.includes('code_symbols'), 'single-tool filter works');
  // The format example may mention read_file as a concrete example, but the args
  // list (format: "name: description") should only include the filtered tools.
  // Check that read_file's description doesn't appear (it won't be in the args list).
  const argsSection = prompt.slice(prompt.indexOf('Args:'));
  expect(!argsSection.includes('read_file:'), 'single-tool filter excludes others from args list');
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
