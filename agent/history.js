/**
 * Persistent conversation history — reads/writes data/history.json.
 * Uses an atomic write (temp file + rename) to avoid corruption.
 */

import { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';

import { getDataDir } from './data-dir.js';
const DATA_DIR = getDataDir();
const HISTORY_FILE = join(DATA_DIR, 'history.json');
const HISTORY_TMP = join(DATA_DIR, 'history.json.tmp');

function ensureDataDir() {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
}

/**
 * Load history from disk. Returns empty array if file doesn't exist or is corrupt.
 * @returns {Array<{role: string, content: string}>}
 */
export function loadHistory() {
  ensureDataDir();
  if (!existsSync(HISTORY_FILE)) return [];
  try {
    const raw = readFileSync(HISTORY_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed;
  } catch {
    console.warn('[history] Failed to parse history.json — starting fresh.');
    return [];
  }
}

/**
 * Persist history to disk atomically.
 * @param {Array<{role: string, content: string}>} history
 */
export function saveHistory(history) {
  ensureDataDir();
  writeFileSync(HISTORY_TMP, JSON.stringify(history, null, 2), 'utf8');
  renameSync(HISTORY_TMP, HISTORY_FILE);
}
