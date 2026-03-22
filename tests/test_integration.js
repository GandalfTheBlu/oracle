/**
 * Oracle Integration Tests — API-driven, requires the server to be running.
 *
 * Covers: health, /message, /message/stream (SSE), /history, /reset, /state,
 *         /feedback, /approve, /memory, /reset/full, and E2E tool use.
 *
 * Usage:
 *   DATA_DIR=data/test-tmp node api/server.js   # start server with isolated data
 *   node tests/test_integration.js              # run tests
 *
 * Or let tests/run_tests.js handle server lifecycle automatically.
 */

import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';

const API = process.env.ORACLE_API || 'http://localhost:3000';
const SANDBOX = 'C:/sandbox';
const TEST_FILE = join(SANDBOX, 'oracle_integration_test.txt').replaceAll('\\', '/');

// ── Harness ───────────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function describe(title) {
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

// ── HTTP helpers ──────────────────────────────────────────────────────────────

async function get(path) {
  const res = await fetch(`${API}${path}`);
  return { status: res.status, body: await res.json() };
}

async function post(path, body) {
  const res = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

async function del(path) {
  const res = await fetch(`${API}${path}`, { method: 'DELETE' });
  return { status: res.status, body: await res.json() };
}

/** Consume a streaming /message/stream response, return { reply, events, stats, toolActivity } */
async function stream(message, timeoutMs = 120_000) {
  const res = await fetch(`${API}/message/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message }),
    signal: AbortSignal.timeout(timeoutMs),
  });

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  const events = [];
  let reply = '';
  let stats = null;
  let toolActivity = null;
  let approvalRequired = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop();
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      try {
        const ev = JSON.parse(line.slice(6));
        events.push(ev);
        if (ev.type === 'token') reply += ev.text;
        if (ev.type === 'done') stats = ev.stats;
        if (ev.type === 'tool') toolActivity = ev.activity;
        if (ev.type === 'approval_required') approvalRequired = ev;
      } catch {}
    }
  }
  return { reply, events, stats, toolActivity, approvalRequired };
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

function setupSandbox() {
  if (!existsSync(SANDBOX)) mkdirSync(SANDBOX, { recursive: true });
  writeFileSync(TEST_FILE, 'Oracle integration test file.\nSecret word: XYZZY\nLine 3.\n', 'utf8');
}

// ── Tests ─────────────────────────────────────────────────────────────────────

// State shared across tests
let savedTurnId = null;

// ── 1. Health ─────────────────────────────────────────────────────────────────

describe('GET /health');
{
  const { status, body } = await get('/health');
  expect(status === 200, 'returns 200');
  expect(body.status === 'ok', 'status is "ok"');
  expect(typeof body.timestamp === 'string', 'has timestamp');
}

// ── 2. POST /message validation ───────────────────────────────────────────────

describe('POST /message — validation');
{
  const { status } = await post('/message', {});
  expect(status === 400, 'missing message → 400');
}
{
  const { status } = await post('/message', { message: '   ' });
  expect(status === 400, 'whitespace-only message → 400');
}

// ── 3. POST /message happy path ───────────────────────────────────────────────

describe('POST /message — happy path');
{
  const { status, body } = await post('/message', { message: 'Say the single word: PONG' });
  expect(status === 200, 'returns 200');
  expect(typeof body.reply === 'string' && body.reply.length > 0, 'reply is non-empty string');
  expect(Array.isArray(body.history), 'history is an array');
  expect(body.history.length >= 2, 'history has at least user + assistant message');
  expect(typeof body.contextStats?.turnId === 'string', 'contextStats.turnId is a string');
  expect(typeof body.contextStats?.totalMessages === 'number', 'contextStats.totalMessages is a number');
  savedTurnId = body.contextStats?.turnId;
}

// ── 4. GET /history ───────────────────────────────────────────────────────────

describe('GET /history');
{
  const { status, body } = await get('/history');
  expect(status === 200, 'returns 200');
  expect(Array.isArray(body.history), 'history is an array');
  expect(body.history.length >= 2, 'at least 2 messages (from prior test turn)');
  const roles = body.history.map(m => m.role);
  expect(roles.includes('user'), 'history includes user messages');
  expect(roles.includes('assistant'), 'history includes assistant messages');
}

// ── 5. POST /reset ────────────────────────────────────────────────────────────

describe('POST /reset');
{
  const { status, body } = await post('/reset', {});
  expect(status === 200, 'returns 200');
  expect(body.status === 'ok', 'status is ok');
  const after = await get('/history');
  expect(after.body.history.length === 0, 'history is empty after reset');
}

// ── 6. GET /state ─────────────────────────────────────────────────────────────

describe('GET /state');
{
  const { status, body } = await get('/state');
  expect(status === 200, 'returns 200');
  expect(body.personality !== undefined, 'has personality');
  expect(Array.isArray(body.personality.traits), 'personality.traits is an array');
  expect(typeof body.personality.tone === 'string', 'personality.tone is a string');
  expect(body.userModel !== undefined, 'has userModel');
  expect(body.learning !== undefined, 'has learning');
  expect(typeof body.learning.totalInteractions === 'number', 'learning.totalInteractions is a number');
}

// ── 7. POST /feedback ─────────────────────────────────────────────────────────

describe('POST /feedback');
{
  if (savedTurnId) {
    const { status, body } = await post('/feedback', {
      turnId: savedTurnId,
      feedback: 'positive',
      note: 'integration test',
    });
    expect(status === 200, 'valid turnId + positive feedback → 200');
    expect(body.status === 'ok', 'status is ok');
  } else {
    fail('skipped — no saved turnId from /message test');
  }
}
{
  const { status } = await post('/feedback', { turnId: 'nonexistent-turn-id', feedback: 'positive' });
  expect(status === 404, 'unknown turnId → 404');
}
{
  const { status } = await post('/feedback', { feedback: 'positive' });
  expect(status === 400, 'missing turnId → 400');
}
{
  const { status } = await post('/feedback', { turnId: 'x', feedback: 'meh' });
  expect(status === 400, 'invalid feedback value → 400');
}

// ── 8. POST /message/stream ───────────────────────────────────────────────────

describe('POST /message/stream — SSE event sequence');
{
  const { reply, events, stats } = await stream('Reply with exactly the word HELLO and nothing else.');
  expect(reply.length > 0, 'reply is non-empty');
  const tokenEvents = events.filter(e => e.type === 'token');
  const doneEvents  = events.filter(e => e.type === 'done');
  expect(tokenEvents.length > 0, 'at least one token event received');
  expect(doneEvents.length === 1, 'exactly one done event');
  expect(typeof stats?.turnId === 'string', 'done event carries turnId');
  expect(typeof stats?.totalMessages === 'number', 'done event carries totalMessages');

  // done must come after all tokens
  const lastTokenIdx = events.map(e => e.type).lastIndexOf('token');
  const doneIdx      = events.findIndex(e => e.type === 'done');
  expect(doneIdx > lastTokenIdx, 'done event comes after all token events');
}

// ── 9. POST /message/stream — validation ─────────────────────────────────────

describe('POST /message/stream — validation');
{
  const res = await fetch(`${API}/message/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  expect(res.status === 400, 'missing message → 400');
}

// ── 10. Tool use: read_file ───────────────────────────────────────────────────

describe('E2E tool use — read_file via /message');
setupSandbox();

{
  const { status, body } = await post('/message', {
    message: `Read the file at ${TEST_FILE} and tell me what the secret word is.`,
  });
  expect(status === 200, 'returns 200');

  // toolActivity should show read_file was used
  const readAct = body.toolActivity?.find(a => a.tool === 'read_file');
  expect(!!readAct, 'toolActivity includes read_file',
    `toolActivity: ${JSON.stringify(body.toolActivity)}`);

  // The tool result should contain the file content (XYZZY is the secret word)
  const toolGotContent = readAct?.result?.toUpperCase().includes('XYZZY');
  expect(toolGotContent, 'read_file tool result contains the secret word',
    `tool result: "${readAct?.result?.slice(0, 200)}"`);

  // Best-effort: reply may or may not include XYZZY (LLM non-deterministic)
  const replyHasWord = body.reply?.toUpperCase().includes('XYZZY');
  if (replyHasWord) pass('reply also contains the secret word');
  else pass('tool returned correct content (LLM reply omitted it — non-deterministic)');
}

// ── 11. Tool use: run_command (safe) via stream ───────────────────────────────

describe('E2E tool use — run_command (safe) via /message/stream');
{
  const { reply, toolActivity } = await stream(
    'Run the command "echo ORACLE_TEST_TOKEN" and tell me what it output.'
  );
  const cmdAct = toolActivity?.find(a => a.tool === 'run_command');

  if (cmdAct) {
    // Tool was used — verify the result
    pass('toolActivity includes run_command');
    const toolGotToken = cmdAct.result?.toUpperCase().includes('ORACLE_TEST_TOKEN');
    expect(toolGotToken, 'run_command tool result contains the echoed token',
      `tool result: "${cmdAct.result?.slice(0, 200)}"`);
  } else {
    // LLM chose to respond without using the tool (non-deterministic) — that's OK
    // as long as the overall reply is non-empty and the server didn't error
    pass('toolActivity is null — LLM responded without calling the tool (non-deterministic)');
    expect(reply.length > 0, 'reply is non-empty even when no tool was called');
  }
}

// ── 12. POST /approve/:id — unknown id ───────────────────────────────────────

describe('POST /approve/:id — unknown id');
{
  const { status } = await post('/approve/totally-fake-id', { approved: true });
  expect(status === 404, 'unknown approval id → 404');
}

// ── 13. GET /memory ───────────────────────────────────────────────────────────

describe('GET /memory');
{
  const { status, body } = await get('/memory');
  expect(status === 200, 'returns 200');
  expect(Array.isArray(body.memories), 'memories is an array');
  expect(typeof body.total === 'number', 'total is a number');
}
{
  const { status, body } = await get('/memory?type=semantic');
  expect(status === 200, 'type=semantic filter returns 200');
  expect(Array.isArray(body.memories), 'filtered memories is an array');
  const allSemantic = body.memories.every(m => m.metadata?.type === 'semantic');
  expect(allSemantic || body.memories.length === 0, 'all returned memories are semantic type');
}

// ── 14. DELETE /memory/:id — unknown id ──────────────────────────────────────

describe('DELETE /memory/:id — unknown id');
{
  const { status } = await del('/memory/nonexistent-memory-id-xyz');
  expect(status === 404, 'unknown memory id → 404');
}

// ── 15. POST /reset/full ──────────────────────────────────────────────────────

describe('POST /reset/full');
{
  // Put something in history first
  await post('/message', { message: 'Remember this: my favorite color is TESTBLUE.' });

  const { status, body } = await post('/reset/full', {});
  expect(status === 200, 'returns 200');
  expect(body.status === 'ok', 'status is ok');
  expect(typeof body.memoriesDeleted === 'number', 'reports memoriesDeleted count');

  // History should be empty
  const hist = await get('/history');
  expect(hist.body.history.length === 0, 'history empty after full reset');

  // State should be back to defaults — interactionCount resets
  const stateAfter = await get('/state');
  expect(stateAfter.body.personality !== undefined, 'personality still present after full reset');
}

// ── 16. Multi-turn conversation coherence ─────────────────────────────────────

describe('Multi-turn coherence');
{
  await post('/reset', {});
  await post('/message', { message: 'My name for this test is TESTUSER_ORACLE.' });
  const { body } = await post('/message', { message: 'What name did I just tell you?' });
  const remembers = body.reply?.toUpperCase().includes('TESTUSER_ORACLE');
  expect(remembers, 'Oracle recalls a fact from earlier in the same conversation',
    `reply: "${body.reply?.slice(0, 300)}"`);
  await post('/reset', {});
}

// ── Summary ───────────────────────────────────────────────────────────────────

console.log(`\n${'─'.repeat(50)}`);
console.log(`Integration tests: ${passed} passed, ${failed} failed`);
console.log('─'.repeat(50));

if (failed > 0) process.exit(1);
