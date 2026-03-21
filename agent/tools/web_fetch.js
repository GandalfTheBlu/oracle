/**
 * Web fetch tool — fetches a URL via r.jina.ai (returns clean markdown),
 * chunks the content, caches to disk, and exposes read/search helpers.
 *
 * Tools:
 *   web_fetch(url)               — fetch & cache, return chunk 0 + total count
 *   web_read_chunk(url, chunk)   — return chunk N from cache
 *   web_search_page(url, query)  — find lines matching query across all chunks
 */

import { createHash } from 'crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = join(__dirname, '../../data/webcache');
const CHUNK_SIZE = 3000; // chars (~750 tokens)
const JINA_PREFIX = 'https://r.jina.ai/';

function ensureCacheDir() {
  if (!existsSync(CACHE_DIR)) mkdirSync(CACHE_DIR, { recursive: true });
}

function cacheKey(url) {
  return createHash('md5').update(url).digest('hex');
}

function cachePath(url) {
  return join(CACHE_DIR, `${cacheKey(url)}.json`);
}

function chunkText(text) {
  const chunks = [];
  for (let i = 0; i < text.length; i += CHUNK_SIZE) {
    chunks.push(text.slice(i, i + CHUNK_SIZE));
  }
  return chunks.length ? chunks : ['(empty)'];
}

function loadCache(url) {
  const p = cachePath(url);
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

function saveCache(url, chunks) {
  ensureCacheDir();
  writeFileSync(cachePath(url), JSON.stringify({ url, fetchedAt: Date.now(), chunks }), 'utf8');
}

// ── Tool definitions ──────────────────────────────────────────────────────────

export const webFetch = {
  description: 'url:string — Fetch a web page and return its content (chunk 0). Content is cached for web_read_chunk / web_search_page.',
  schema: { url: 'string' },
  async run({ url }) {
    if (!url) return 'ERROR: url is required';

    // Normalise — strip jina prefix if user accidentally included it
    const cleanUrl = url.replace(/^https?:\/\/r\.jina\.ai\//, '');

    // Check cache
    let cached = loadCache(cleanUrl);
    if (!cached) {
      const jinaUrl = `${JINA_PREFIX}${cleanUrl}`;
      const res = await fetch(jinaUrl, {
        headers: { Accept: 'text/plain' },
        signal: AbortSignal.timeout(20_000),
      });
      if (!res.ok) return `ERROR: fetch failed (${res.status}) for ${cleanUrl}`;
      const text = await res.text();
      const chunks = chunkText(text.trim());
      saveCache(cleanUrl, chunks);
      cached = { chunks };
    }

    const total = cached.chunks.length;
    const header = total > 1
      ? `[Page cached: ${total} chunks total. Use web_read_chunk to read more, web_search_page to search.]\n\n`
      : '';
    return header + cached.chunks[0];
  },
};

export const webReadChunk = {
  description: 'url:string, chunk:number — Read chunk N (0-indexed) of a previously fetched page.',
  schema: { url: 'string', chunk: 'number' },
  async run({ url, chunk }) {
    if (!url) return 'ERROR: url is required';
    const cleanUrl = url.replace(/^https?:\/\/r\.jina\.ai\//, '');
    const cached = loadCache(cleanUrl);
    if (!cached) return `ERROR: page not cached. Call web_fetch first.`;
    const idx = Number(chunk) || 0;
    if (idx < 0 || idx >= cached.chunks.length) {
      return `ERROR: chunk ${idx} out of range (0–${cached.chunks.length - 1})`;
    }
    return `[Chunk ${idx + 1}/${cached.chunks.length}]\n\n${cached.chunks[idx]}`;
  },
};

export const webSearchPage = {
  description: 'url:string, query:string — Search cached page for lines containing query terms. Returns matching lines with chunk references.',
  schema: { url: 'string', query: 'string' },
  async run({ url, query }) {
    if (!url || !query) return 'ERROR: url and query are required';
    const cleanUrl = url.replace(/^https?:\/\/r\.jina\.ai\//, '');
    const cached = loadCache(cleanUrl);
    if (!cached) return `ERROR: page not cached. Call web_fetch first.`;

    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    const results = [];

    cached.chunks.forEach((chunk, chunkIdx) => {
      const lines = chunk.split('\n');
      lines.forEach((line, lineIdx) => {
        const lower = line.toLowerCase();
        if (terms.every(t => lower.includes(t))) {
          results.push(`[chunk ${chunkIdx}, line ${lineIdx}]: ${line.trim()}`);
        }
      });
    });

    if (results.length === 0) return `No lines found matching "${query}".`;
    const shown = results.slice(0, 30);
    const note = results.length > 30 ? `\n…(${results.length - 30} more results)` : '';
    return shown.join('\n') + note;
  },
};
