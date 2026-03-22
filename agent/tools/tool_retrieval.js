/**
 * Embedding-based tool retrieval.
 *
 * At first use, embeds each tool's "name: description" string and caches the
 * vectors to data/tool_embeddings.json (keyed by a hash of all descriptions).
 * On each query, embeds the user message and picks the top-K most similar tools
 * via cosine similarity. Also used to decide whether the query needs tools at all
 * (max score above TOOL_RELEVANCE_THRESHOLD).
 *
 * Manual sort+slice — Vectra's topK is unreliable, so we do it ourselves here too.
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { createHash } from 'crypto';
import config from '../../config.json' with { type: 'json' };
import { getDataDir } from '../data-dir.js';
import { join } from 'path';

const { serverHost, port } = config.embedding;
const EMBED_URL = `http://${serverHost}:${port}/v1/embeddings`;

const CACHE_PATH = join(getDataDir(), 'tool_embeddings.json');

/** Number of tools to inject into the prompt. */
const TOP_K = 5;

/**
 * Minimum max-similarity score for the query to be considered tool-relevant.
 * If no tool scores above this, skip the tool loop entirely.
 */
const TOOL_RELEVANCE_THRESHOLD = 0.3;

// ── Embedding ──────────────────────────────────────────────────────────────────

async function embed(text) {
  const res = await fetch(EMBED_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'local', input: text }),
  });
  if (!res.ok) throw new Error(`Embedding failed (${res.status}): ${await res.text()}`);
  const data = await res.json();
  return data.data[0].embedding;
}

function cosineSim(a, b) {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot   += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

// ── Cache ──────────────────────────────────────────────────────────────────────

function hashTools(tools) {
  const str = Object.entries(tools)
    .map(([name, t]) => `${name}:${t.description}`)
    .join('|');
  return createHash('md5').update(str).digest('hex');
}

/** In-process cache: { hash, embeddings: { [toolName]: number[] } } */
let _cache = null;

async function getToolEmbeddings(tools) {
  const hash = hashTools(tools);

  if (_cache?.hash === hash) return _cache.embeddings;

  // Try disk cache
  if (existsSync(CACHE_PATH)) {
    try {
      const saved = JSON.parse(readFileSync(CACHE_PATH, 'utf8'));
      if (saved.hash === hash) {
        _cache = saved;
        console.log('[tool-retrieval] Loaded tool embeddings from cache.');
        return _cache.embeddings;
      }
    } catch {}
  }

  // Recompute
  console.log('[tool-retrieval] Embedding tool definitions...');
  const embeddings = {};
  for (const [name, tool] of Object.entries(tools)) {
    embeddings[name] = await embed(`${name}: ${tool.description}`);
  }

  _cache = { hash, embeddings };
  try {
    writeFileSync(CACHE_PATH, JSON.stringify(_cache), 'utf8');
  } catch (err) {
    console.warn('[tool-retrieval] Could not write cache:', err.message);
  }
  return embeddings;
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Retrieve the most relevant tools for a query.
 *
 * Returns { toolNames, needsTools } where:
 *   - toolNames: top-K tool names sorted by relevance
 *   - needsTools: true if the best score exceeds TOOL_RELEVANCE_THRESHOLD
 *
 * On embedding failure falls back to all tools + needsTools=true so the
 * agent stays functional even if the embedding endpoint is down.
 *
 * @param {string} query
 * @param {object} tools  The TOOLS registry (name → tool)
 * @param {number} [topK]
 * @returns {Promise<{ toolNames: string[], needsTools: boolean }>}
 */
export async function retrieveRelevantTools(query, tools, topK = TOP_K) {
  try {
    const toolEmbeddings = await getToolEmbeddings(tools);
    const queryVec = await embed(query);

    const scored = Object.entries(toolEmbeddings)
      .map(([name, vec]) => ({ name, score: cosineSim(queryVec, vec) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);

    const maxScore = scored[0]?.score ?? 0;
    const needsTools = maxScore >= TOOL_RELEVANCE_THRESHOLD;

    console.log(
      `[tool-retrieval] top match: ${scored[0]?.name} (${scored[0]?.score?.toFixed(3)}), ` +
      `needsTools=${needsTools}`
    );

    return { toolNames: scored.map(s => s.name), needsTools };
  } catch (err) {
    console.warn('[tool-retrieval] Retrieval failed, falling back to all tools:', err.message);
    return { toolNames: Object.keys(tools), needsTools: true };
  }
}
