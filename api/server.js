/**
 * Oracle Agent API — Express HTTP server.
 * Exposes the agent for use by the web UI and by Claude Code for evaluation.
 */

import express from 'express';
import cors from 'cors';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { Agent } from '../agent/index.js';
import { resolveApproval } from '../agent/approval.js';
import { chatCompletion } from '../agent/llm.js';
import { runAnalysis } from '../agent/codebase_analyzer.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const PORT = process.env.PORT || 3000;
const app = express();
const agent = new Agent();

app.use(cors());
app.use(express.json());
app.use(express.static(join(__dirname, '../ui')));

// ── Health check ─────────────────────────────────────────────────────────────

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ── Send a message to Oracle ──────────────────────────────────────────────────

/**
 * POST /message
 * Body: { "message": "..." }
 * Response: { "reply": "...", "history": [...] }
 */
app.post('/message', async (req, res) => {
  const { message } = req.body;

  if (!message || typeof message !== 'string' || !message.trim()) {
    return res.status(400).json({ error: 'message field is required and must be a non-empty string' });
  }

  try {
    const result = await agent.chat(message.trim());
    res.json(result);
  } catch (err) {
    console.error('[POST /message]', err.message);
    res.status(502).json({ error: 'LLM request failed', detail: err.message });
  }
});

// ── Streaming message (SSE) ───────────────────────────────────────────────────

/**
 * POST /message/stream
 * Body: { "message": "..." }
 * Response: SSE stream of events:
 *   data: {"type":"token","text":"..."}
 *   data: {"type":"tool","activity":[...]}
 *   data: {"type":"done","stats":{...}}
 *   data: {"type":"error","message":"..."}
 */
app.post('/message/stream', async (req, res) => {
  const { message } = req.body;

  if (!message || typeof message !== 'string' || !message.trim()) {
    return res.status(400).json({ error: 'message field is required' });
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const send = (obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`);

  await agent.chatStream(message.trim(), {
    onToken:            (text)     => send({ type: 'token', text }),
    onTool:             (activity) => send({ type: 'tool', activity }),
    onApprovalRequired: (request)  => send({ type: 'approval_required', ...request }),
    onDone:             (stats)    => { send({ type: 'done', stats }); res.end(); },
    onError:            (err)      => { send({ type: 'error', message: err.message }); res.end(); },
  });
});

// ── Tool approval ─────────────────────────────────────────────────────────────

/**
 * POST /approve/:id
 * Body: { "approved": true|false }
 * Resolves a pending tool approval request.
 */
app.post('/approve/:id', (req, res) => {
  const { approved } = req.body;
  const ok = resolveApproval(req.params.id, !!approved);
  if (!ok) return res.status(404).json({ error: 'Approval request not found or already resolved' });
  res.json({ status: 'ok' });
});

// ── Get conversation history ──────────────────────────────────────────────────

/**
 * GET /history
 * Response: { "history": [...] }
 */
app.get('/history', (_req, res) => {
  res.json({ history: agent.getHistory() });
});

// ── Reset conversation ────────────────────────────────────────────────────────

/**
 * POST /reset
 * Clears the in-memory conversation history.
 */
app.post('/reset', (_req, res) => {
  agent.reset();
  res.json({ status: 'ok', message: 'Conversation reset.' });
});

// ── Feedback ──────────────────────────────────────────────────────────────────

/**
 * POST /feedback
 * Body: { "turnId": "...", "feedback": "positive"|"negative", "note": "..." }
 */
app.post('/feedback', (req, res) => {
  const { turnId, feedback, note } = req.body;
  if (!turnId || !['positive', 'negative'].includes(feedback)) {
    return res.status(400).json({ error: 'turnId and feedback ("positive"|"negative") are required' });
  }
  const ok = agent.feedback(turnId, feedback, note || '');
  if (!ok) return res.status(404).json({ error: `Turn ${turnId} not found` });
  res.json({ status: 'ok' });
});

// ── State inspection ──────────────────────────────────────────────────────────

/**
 * GET /state
 * Returns personality + user model for inspection/evaluation.
 */
app.get('/state', (_req, res) => {
  res.json(agent.getState());
});

// ── Memory management ─────────────────────────────────────────────────────────

/**
 * GET /memory?type=episodic|semantic
 * List all memories. Optional ?type filter.
 */
app.get('/memory', async (req, res) => {
  try {
    const { type } = req.query;
    const memories = await agent.listMemories(type || null);
    res.json({ memories, total: memories.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /memory/:id
 * Get a specific memory by ID.
 */
app.get('/memory/:id', async (req, res) => {
  try {
    const memory = await agent.getMemory(req.params.id);
    if (!memory) return res.status(404).json({ error: 'Memory not found' });
    res.json(memory);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * DELETE /memory/:id
 * Delete a specific memory by ID.
 */
app.delete('/memory/:id', async (req, res) => {
  try {
    const deleted = await agent.deleteMemory(req.params.id);
    if (!deleted) return res.status(404).json({ error: 'Memory not found' });
    res.json({ status: 'ok', deleted: req.params.id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * DELETE /memory
 * Clear all memories.
 */
app.delete('/memory', async (_req, res) => {
  try {
    const count = await agent.clearMemories();
    res.json({ status: 'ok', deleted: count });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /reset/full
 * Wipe everything: history, memories, personality, user model, learning log.
 */
app.post('/reset/full', async (_req, res) => {
  try {
    const result = await agent.fullReset();
    res.json({ status: 'ok', ...result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Codebase analysis ─────────────────────────────────────────────────────────

/** Last analysis result — persists for status queries. */
let _lastAnalysis = null;

/**
 * POST /analyze
 * Triggers a codebase analysis pass immediately.
 * Returns { analyzed, total, issueCount, outputPath } or { error }.
 */
app.post('/analyze', async (_req, res) => {
  try {
    const result = await runAnalysis(chatCompletion);
    if (!result) return res.json({ status: 'skipped', reason: 'disabled or nothing to analyze' });
    _lastAnalysis = { timestamp: Date.now(), analyzed: result.analyzed, total: result.issues.length === 0 ? result.analyzed : result.analyzed, issueCount: result.issues.length, outputPath: result.outputPath };
    res.json({ status: 'ok', analyzed: result.analyzed, issueCount: result.issues.length, outputPath: result.outputPath });
  } catch (err) {
    console.error('[POST /analyze]', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /analyze/status
 * Returns the last analysis result metadata (no re-run).
 */
app.get('/analyze/status', (_req, res) => {
  if (!_lastAnalysis) return res.json({ status: 'none' });
  res.json({ status: 'ok', ..._lastAnalysis });
});

// ── Force evolution (testing / manual trigger) ────────────────────────────────

/**
 * POST /evolve
 * Forces a personality evolution pass immediately.
 * Returns { before, updates, after } for inspection.
 */
app.post('/evolve', async (_req, res) => {
  try {
    const result = await agent.forceEvolve();
    res.json(result);
  } catch (err) {
    console.error('[POST /evolve]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Start ─────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`Oracle API running on http://localhost:${PORT}`);

  // Run initial codebase analysis after a short delay to avoid blocking startup.
  setTimeout(() => {
    runAnalysis(chatCompletion)
      .then(r => {
        if (!r) return;
        _lastAnalysis = { timestamp: Date.now(), analyzed: r.analyzed, issueCount: r.issues.length, outputPath: r.outputPath };
        console.log(`[analyzer] Startup pass: ${r.analyzed} analyzed, ${r.issues.length} issues`);
      })
      .catch(err => console.warn('[analyzer] Startup pass failed:', err.message));
  }, 5000);
});
