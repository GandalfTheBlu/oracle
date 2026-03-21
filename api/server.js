/**
 * Oracle Agent API — Express HTTP server.
 * Exposes the agent for use by the web UI and by Claude Code for evaluation.
 */

import express from 'express';
import cors from 'cors';
import { Agent } from '../agent/index.js';

const PORT = process.env.PORT || 3000;
const app = express();
const agent = new Agent();

app.use(cors());
app.use(express.json());

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

// ── Start ─────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`Oracle API running on http://localhost:${PORT}`);
});
