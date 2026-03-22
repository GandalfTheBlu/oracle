/**
 * Web fetch tool — fetches a URL via r.jina.ai (returns clean markdown text)
 * and saves the content to a file specified by the caller.
 *
 * The agent then uses read_file (with offset/limit for large pages),
 * run_command with Select-String/grep for search, etc. — no bespoke
 * chunking or caching API needed.
 */

import { mkdirSync, writeFileSync } from 'fs';
import { dirname } from 'path';
import { normalizePath } from './utils.js';

const JINA_PREFIX = 'https://r.jina.ai/';
const MAX_BYTES = 500_000; // ~125k tokens — hard cap to avoid enormous saves

export const webFetch = {
  description: 'Fetch a URL and save the content as plain text to a file. Args: { url: string, path: string }',
  dangerous: true,

  async run({ url, path }) {
    if (!url)  throw new Error('url is required');
    if (!path) throw new Error('path is required');
    path = normalizePath(path);

    // Strip jina prefix if accidentally included
    const cleanUrl = url.replace(/^https?:\/\/r\.jina\.ai\//, '');
    const jinaUrl = `${JINA_PREFIX}${cleanUrl}`;

    const res = await fetch(jinaUrl, {
      headers: { Accept: 'text/plain' },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) throw new Error(`Fetch failed (${res.status}) for ${cleanUrl}`);

    let text = await res.text();
    text = text.trim();

    const bytes = Buffer.byteLength(text);
    let truncated = false;
    if (bytes > MAX_BYTES) {
      text = text.slice(0, MAX_BYTES);
      truncated = true;
    }

    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text, 'utf8');

    const lines = text.split('\n').length;
    return `Saved ${lines} lines (${Math.round(Buffer.byteLength(text) / 1024)} KB) to ${path}${truncated ? ' [truncated at 500 KB]' : ''}.`;
  },
};
