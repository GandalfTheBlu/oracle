/**
 * Oracle Learning Module — success/failure logging and feedback.
 *
 * Logs each interaction with metadata. Tracks explicit user feedback
 * (thumbs up/down via API) to inform future behavior.
 *
 * Storage: data/learning.jsonl (newline-delimited JSON for append efficiency)
 */

import { appendFileSync, readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';

const ROOT = join(fileURLToPath(import.meta.url), '..', '..');
const DATA_DIR = join(ROOT, 'data');
const LEARNING_FILE = join(DATA_DIR, 'learning.jsonl');

function ensureDataDir() {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
}

/**
 * Log a completed interaction.
 * @param {object} entry
 * @param {string} entry.id              Unique turn ID (e.g. timestamp-based).
 * @param {string} entry.userMessage
 * @param {string} entry.reply
 * @param {string} entry.reasoning       Internal reasoning text (may be empty).
 * @param {object} entry.contextStats
 */
export function logInteraction(entry) {
  ensureDataDir();
  const record = {
    ...entry,
    timestamp: new Date().toISOString(),
    feedback: null, // filled in later via recordFeedback()
  };
  appendFileSync(LEARNING_FILE, JSON.stringify(record) + '\n', 'utf8');
  return record.id;
}

/**
 * Record explicit user feedback on a past turn.
 * Rewrites the matching line in the JSONL file.
 * @param {string} id       Turn ID to update.
 * @param {'positive'|'negative'} feedback
 * @param {string} [note]   Optional user note.
 */
export function recordFeedback(id, feedback, note = '') {
  ensureDataDir();
  if (!existsSync(LEARNING_FILE)) return false;

  const lines = readFileSync(LEARNING_FILE, 'utf8').split('\n').filter(Boolean);
  let found = false;

  const updated = lines.map(line => {
    try {
      const rec = JSON.parse(line);
      if (rec.id === id) {
        found = true;
        return JSON.stringify({ ...rec, feedback, feedbackNote: note });
      }
    } catch {}
    return line;
  });

  if (found) {
    writeFileSync(LEARNING_FILE, updated.join('\n') + '\n', 'utf8');
  }
  return found;
}

/**
 * Read recent interactions (last N entries).
 * @param {number} n
 * @returns {Array<object>}
 */
export function getRecentInteractions(n = 20) {
  ensureDataDir();
  if (!existsSync(LEARNING_FILE)) return [];
  const lines = readFileSync(LEARNING_FILE, 'utf8').split('\n').filter(Boolean);
  return lines
    .slice(-n)
    .map(line => { try { return JSON.parse(line); } catch { return null; } })
    .filter(Boolean);
}

/**
 * Summarize learning stats: total interactions, positive/negative feedback counts.
 * @returns {object}
 */
export function getLearningStats() {
  const interactions = getRecentInteractions(1000);
  const withFeedback = interactions.filter(i => i.feedback);
  return {
    totalInteractions: interactions.length,
    feedbackGiven: withFeedback.length,
    positiveCount: withFeedback.filter(i => i.feedback === 'positive').length,
    negativeCount: withFeedback.filter(i => i.feedback === 'negative').length,
  };
}
