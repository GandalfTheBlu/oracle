/**
 * Milestone 3.1 — Persona Evaluation
 * Simulates a structured session as "Maya Chen" and audits what Oracle learns.
 *
 * Usage: node tests/eval_persona.js [port]
 *   port defaults to 3002
 */

const PORT = process.argv[2] || 3002;
const BASE = `http://localhost:${PORT}`;

async function post(path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res.json();
}

async function get(path) {
  const res = await fetch(`${BASE}${path}`);
  return res.json();
}

function print(label, text) {
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`${label}`);
  console.log('─'.repeat(60));
  console.log(text);
}

async function send(message, label) {
  const data = await post('/message', { message });
  const stats = data.contextStats;
  print(
    `[${label}] USER: ${message.slice(0, 80)}${message.length > 80 ? '...' : ''}`,
    `ORACLE: ${data.reply}\n\n` +
    `  tools: ${stats.toolsUsed?.join(', ') || 'none'} | ` +
    `memories injected: ${stats.memoriesInjected} | ` +
    `tokens: ~${stats.estimatedContextTokens}`
  );
  return data;
}

// ── Reset eval environment ───────────────────────────────────────────────────
await post('/reset/full', {});
console.log('Eval environment reset.\n');
console.log('Persona: Maya Chen — senior backend engineer, Go/distributed systems,');
console.log('         terse communicator, hates over-explanation, 4th coffee today.\n');

// ── Session turns ────────────────────────────────────────────────────────────
await send(
  "Hey. I'm Maya, senior backend engineer. Mostly Go, some Python. Work on distributed systems.",
  'T1 — introduction'
);

await send(
  "I hate when people over-explain things. Just give me the answer.",
  'T2 — preference signal: brevity'
);

await send(
  "I'm building a job queue in Go. Workers pull tasks, process them, report back. What's the cleanest pattern for distributing work across N workers?",
  'T3 — technical question'
);

await send(
  "No channels, too much boilerplate. I want something more like a work-stealing pattern.",
  'T4 — correction / preference refinement'
);

await send(
  "On my fourth coffee today. This queue thing is taking longer than expected.",
  'T5 — casual / personal'
);

await send(
  "OK I went with a lock-free ring buffer approach. Each worker has its own local queue and can steal from neighbors. What are the typical pitfalls?",
  'T6 — technical follow-up'
);

await send(
  "That's still too long. 2-3 bullet points max, always.",
  'T7 — explicit correction on response length'
);

await send(
  "Good enough for now. I'll be back when the implementation breaks.",
  'T8 — closing'
);

// ── Wait for background memory extraction ────────────────────────────────────
console.log('\n\nWaiting 8s for background memory extraction...');
await new Promise(r => setTimeout(r, 8000));

// ── Audit ────────────────────────────────────────────────────────────────────
const memData = await get('/memory');
const stateData = await get('/state');

print('AUDIT — Memories stored', '');
console.log(`Total: ${memData.total}`);
for (const m of memData.memories) {
  console.log(`  [${m.type}] ${m.text}`);
}

print('AUDIT — User Model', JSON.stringify(stateData.userModel, null, 2));

print('AUDIT — Personality observations', '');
const obs = stateData.personality?.observations ?? [];
if (obs.length === 0) {
  console.log('  (none yet — evolution threshold not reached)');
} else {
  for (const o of obs) console.log(`  • ${o}`);
}

print('AUDIT — Personality traits + tone', '');
console.log(`  Traits: ${stateData.personality.traits.join(', ')}`);
console.log(`  Tone:   ${stateData.personality.tone}`);
console.log(`  Familiarity: ${stateData.personality.relationship?.familiarity}`);
console.log(`  Interactions: ${stateData.personality.relationship?.interactionCount}`);

// ── Recall test: fresh context ────────────────────────────────────────────────
print('RECALL TEST — ask about the user in a way that requires memory', '');

const recallRes = await post('/message', {
  message: "Do you remember my name and what I'm working on?",
});
console.log(`ORACLE: ${recallRes.reply}`);
console.log(`  memories injected: ${recallRes.contextStats.memoriesInjected}`);

// ── Grading ──────────────────────────────────────────────────────────────────
print('EVALUATION SUMMARY', '');

const grade = (label, pass, detail = '') => {
  const sym = pass ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m';
  console.log(`  ${sym} ${label}${detail ? ` — ${detail}` : ''}`);
};

const memories = memData.memories ?? [];
const um = stateData.userModel ?? {};

grade('Stored at least 3 memories', memories.length >= 3, `got ${memories.length}`);
grade(
  'Remembered name (Maya)',
  memories.some(m => /maya/i.test(m.text)) || /maya/i.test(recallRes.reply),
);
grade(
  'Remembered Go / backend engineer',
  memories.some(m => /go|golang|backend|engineer/i.test(m.text)) ||
  JSON.stringify(um).toLowerCase().includes('go'),
);
grade(
  'Stored brevity preference',
  memories.some(m => /brief|concise|short|verbose|over-explain|bullet/i.test(m.text)),
);
grade(
  'Stored job queue / distributed systems project',
  memories.some(m => /queue|worker|ring.buffer|distributed/i.test(m.text)),
);
grade(
  'Recall test returned name or project detail',
  /maya|queue|worker|distributed|ring|go/i.test(recallRes.reply),
);
grade(
  'User model has name or role',
  !!(um.facts?.name || um.facts?.occupation || um.facts?.role || Object.keys(um.facts ?? {}).length > 0),
);
grade(
  'Familiarity > 0',
  (stateData.personality?.relationship?.familiarity ?? 0) > 0,
  `got ${stateData.personality?.relationship?.familiarity}`,
);

console.log('');
