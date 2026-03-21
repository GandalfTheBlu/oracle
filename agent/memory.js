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
import { fileURLToPath } from 'url';
import config from '../config.json' with { type: 'json' };

// ── Config ────────────────────────────────────────────────────────────────────

const ROOT = join(fileURLToPath(import.meta.url), '..', '..');
const INDEX_PATH = join(ROOT, 'data', 'memory');

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

  return results
    .filter(r => r.score >= MIN_SCORE)
    .map(r => ({
      text: r.item.metadata.text,
      type: r.item.metadata.type,
      timestamp: r.item.metadata.timestamp,
      score: r.score,
    }));
}

/**
 * Extract and store memories from a completed conversation turn.
 * Called after the LLM replies. Stores the user message as episodic memory
 * and lets a cheap LLM pass decide if there are semantic facts to store.
 *
 * @param {string} userMessage
 * @param {string} assistantReply
 * @param {Function} llmCall  chatCompletion function reference (to avoid circular import)
 * @returns {Promise<void>}
 */
export async function extractAndStore(userMessage, assistantReply, llmCall) {
  // Store a compact episodic memory (trimmed to 200 chars each side to control token cost).
  const uSnip = userMessage.slice(0, 200);
  const aSnip = assistantReply.slice(0, 200);
  const episodic = `User: "${uSnip}" → Oracle: "${aSnip}"`;
  await storeMemory(episodic, 'episodic');

  // Ask the LLM to extract semantic facts (user preferences, stated facts, etc.).
  // Keep it cheap: short prompt, small output.
  try {
    const extraction = await llmCall(
      [
        {
          role: 'system',
          content:
            'You are a fact extractor. Given a conversation snippet, output a JSON array of short factual strings ' +
            'that describe persistent facts about the user (preferences, background, goals, constraints). ' +
            'If there are no notable facts, output an empty array []. ' +
            'Output ONLY valid JSON — no explanation, no markdown.',
        },
        {
          role: 'user',
          content: `User: ${userMessage}\nOracle: ${assistantReply}`,
        },
      ],
      { maxTokens: 256, temperature: 0.1 }
    );

    let facts = [];
    try {
      // Strip markdown code fences if model adds them
      const cleaned = extraction.replace(/```[a-z]*\n?/gi, '').trim();
      facts = JSON.parse(cleaned);
    } catch {
      // Non-JSON output — skip silently
    }

    if (Array.isArray(facts)) {
      for (const fact of facts) {
        if (typeof fact === 'string' && fact.trim()) {
          await storeMemory(fact.trim(), 'semantic');
        }
      }
    }
  } catch (err) {
    console.warn('[memory] Semantic extraction failed:', err.message);
  }
}
