/**
 * Oracle Vector Memory — long-term semantic storage using Vectra + local embeddings.
 *
 * Memory types:
 *   - episodic: things that happened (events, interactions)
 *   - semantic: facts about the user or world
 *
 * Storage: data/memory/ (Vectra local index)
 * Retrieval: top-K by cosine similarity to current query
 */

import { LocalIndex } from 'vectra';
import { join } from 'path';
import { rmSync, existsSync } from 'fs';
import config from '../config.json' with { type: 'json' };
import { getDataDir } from './data-dir.js';

// ── Config ────────────────────────────────────────────────────────────────────

const INDEX_PATH = join(getDataDir(), 'memory');

const { serverHost, port } = config.embedding;
const EMBED_URL = `http://${serverHost}:${port}/v1/embeddings`;

/** Number of memories to retrieve per query. */
const TOP_K = 3;

/** Minimum similarity score to include a memory (0–1). */
const MIN_SCORE = 0.3;

// ── Embedding ─────────────────────────────────────────────────────────────────

/**
 * Embed a string using the local embedding endpoint.
 * @param {string} text
 * @returns {Promise<number[]>}
 */
async function embed(text) {
  const res = await fetch(EMBED_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'local', input: text }),
  });
  if (!res.ok) {
    const msg = await res.text();
    throw new Error(`Embedding request failed (${res.status}): ${msg}`);
  }
  const data = await res.json();
  return data.data[0].embedding;
}

// ── Index management ──────────────────────────────────────────────────────────

let _index = null;

async function getIndex() {
  if (_index) return _index;
  _index = new LocalIndex(INDEX_PATH);
  if (!(await _index.isIndexCreated())) {
    await _index.createIndex();
  }
  return _index;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Store a memory in the vector index.
 * @param {string} text        The memory content (will be embedded).
 * @param {'episodic'|'semantic'} type
 * @param {object} [extra]     Any extra metadata to store alongside.
 * @returns {Promise<void>}
 */
export async function storeMemory(text, type = 'episodic', extra = {}) {
  const index = await getIndex();
  const vector = await embed(text);
  await index.insertItem({
    vector,
    metadata: {
      text,
      type,
      timestamp: new Date().toISOString(),
      ...extra,
    },
  });
}

/**
 * Retrieve memories relevant to a query.
 * @param {string} query
 * @returns {Promise<Array<{text: string, type: string, timestamp: string, score: number}>>}
 */
export async function retrieveMemories(query) {
  const index = await getIndex();
  const count = await index.getIndexStats();
  if (count.items === 0) return [];

  const vector = await embed(query);
  const results = await index.queryItems(vector, TOP_K);

  // Vectra doesn't always honour the topK limit — enforce it manually.
  // Sort by score descending, filter by min score, then take topK.
  return results
    .filter(r => typeof r.score === 'number' && !isNaN(r.score) && r.score >= MIN_SCORE)
    .sort((a, b) => b.score - a.score)
    .slice(0, TOP_K)
    .map(r => ({
      text: r.item.metadata.text,
      type: r.item.metadata.type,
      timestamp: r.item.metadata.timestamp,
      score: r.score,
    }));
}

/**
 * Extract and store memories from a completed conversation turn.
 *
 * Uses a single LLM pass with a two-gate filter:
 *   Gate 1 — category: only extract if the content clearly belongs to a
 *             high-value category (preference, fact, correction, decision).
 *   Gate 2 — score: only store if the future utility score is 4 or 5 out of 5.
 *
 * Episodic "copy of conversation" storage has been removed — the persistent
 * history file already covers this. Only genuinely cross-session facts are kept.
 *
 * @param {string} userMessage
 * @param {string} assistantReply
 * @param {Function} llmCall  chatCompletion function reference (to avoid circular import)
 * @returns {Promise<void>}
 */
export async function extractAndStore(userMessage, assistantReply, llmCall) {
  try {
    const extraction = await llmCall(
      [
        {
          role: 'system',
          content:
            'You extract memories about the USER worth keeping for future conversations.\n' +
            'CRITICAL: Only store facts/preferences/corrections/decisions that the USER expressed. ' +
            'NEVER store what the assistant said, general technical knowledge, or summaries of the conversation.\n\n' +
            'Only extract if content clearly fits one of these categories:\n' +
            '- USER_PREFERENCE: how the user wants things done (tone, format, brevity, workflow, tools, style)\n' +
            '- USER_FACT: personal info the user stated (name, job, projects, constraints, goals, background)\n' +
            '- BEHAVIORAL_CORRECTION: the user corrected or redirected the assistant\'s approach\n' +
            '- PROJECT_DECISION: a technical/design decision the USER made and the reason they gave\n\n' +
            'The memory text must be written as a fact ABOUT THE USER, not about the topic.\n' +
            'Good: "User prefers 2-3 bullet points max" / "User is named Maya, senior backend engineer"\n' +
            'Bad: "Work-stealing is a technique where..." / "Lock-free ring buffers have pitfall X"\n\n' +
            'Score 1–5: how useful in a new conversation months from now? Only include score 4 or 5.\n\n' +
            'Output ONLY valid JSON: [{"category":"USER_PREFERENCE","text":"...","score":5}]\n' +
            'If nothing qualifies, output [].',
        },
        {
          role: 'user',
          content: `User: ${userMessage}\nAssistant: ${assistantReply}`,
        },
      ],
      { maxTokens: 256, temperature: 0.1 }
    );

    let candidates = [];
    try {
      const cleaned = extraction.replace(/```[a-z]*\n?/gi, '').trim();
      candidates = JSON.parse(cleaned);
    } catch {
      return; // non-JSON output — skip silently
    }

    if (!Array.isArray(candidates)) return;

    for (const item of candidates) {
      if (typeof item.text === 'string' && item.text.trim() && (item.score ?? 0) >= 4) {
        await storeMemory(item.text.trim(), 'semantic', { category: item.category });
        console.log(`[memory] Stored (${item.category}, score=${item.score}): ${item.text.slice(0, 80)}`);
      }
    }
  } catch (err) {
    console.warn('[memory] Extraction failed:', err.message);
  }
}

// ── Memory management ─────────────────────────────────────────────────────────

/**
 * List all stored memories (without their vectors).
 * @param {'episodic'|'semantic'|null} [type]  Optionally filter by type.
 * @returns {Promise<Array<{id, text, type, timestamp}>>}
 */
export async function listMemories(type = null) {
  const index = await getIndex();
  const items = await index.listItems();
  return items
    .filter(item => !type || item.metadata?.type === type)
    .map(item => ({
      id: item.id,
      text: item.metadata?.text ?? '',
      type: item.metadata?.type ?? 'unknown',
      category: item.metadata?.category ?? null,
      timestamp: item.metadata?.timestamp ?? null,
    }))
    .sort((a, b) => (a.timestamp ?? '').localeCompare(b.timestamp ?? ''));
}

/**
 * Get a single memory by ID.
 * @param {string} id
 * @returns {Promise<{id, text, type, timestamp}|null>}
 */
export async function getMemory(id) {
  const index = await getIndex();
  const item = await index.getItem(id);
  if (!item) return null;
  return {
    id: item.id,
    text: item.metadata?.text ?? '',
    type: item.metadata?.type ?? 'unknown',
    timestamp: item.metadata?.timestamp ?? null,
  };
}

/**
 * Delete a single memory by ID.
 * @param {string} id
 * @returns {Promise<boolean>} true if deleted, false if not found.
 */
export async function deleteMemory(id) {
  const index = await getIndex();
  const item = await index.getItem(id);
  if (!item) return false;
  await index.deleteItem(id);
  return true;
}

/**
 * Delete all memories and recreate a fresh index.
 * @returns {Promise<number>} Number of items deleted.
 */
export async function clearMemories() {
  const index = await getIndex();
  const stats = await index.getIndexStats();
  const count = stats.items;

  // Wipe the index folder and reset the singleton.
  if (existsSync(INDEX_PATH)) {
    rmSync(INDEX_PATH, { recursive: true, force: true });
  }
  _index = null;
  await getIndex(); // recreate fresh index
  return count;
}
