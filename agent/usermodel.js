/**
 * Oracle User Model
 *
 * Maintains a structured, persistent profile of the user built from interactions.
 * Updated after each turn via LLM extraction. Injected into the system prompt.
 *
 * Stored at data/usermodel.json
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';

const ROOT = join(fileURLToPath(import.meta.url), '..', '..');
const DATA_DIR = join(ROOT, 'data');
const USERMODEL_FILE = join(DATA_DIR, 'usermodel.json');

// ── Schema ────────────────────────────────────────────────────────────────────

const DEFAULT_MODEL = {
  /** Free-form facts about the user. Key = short label, value = fact string. */
  facts: {},

  /** Inferred interests/skills: e.g. { "Rust": 0.9, "TypeScript": 0.6 } */
  interests: {},

  /** Preferred communication style hints. */
  preferences: {},
};

// ── Persistence ───────────────────────────────────────────────────────────────

function ensureDataDir() {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
}

/**
 * Load the user model from disk.
 * @returns {object}
 */
export function loadUserModel() {
  ensureDataDir();
  if (!existsSync(USERMODEL_FILE)) return structuredClone(DEFAULT_MODEL);
  try {
    const raw = readFileSync(USERMODEL_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    return {
      facts: {},
      interests: {},
      preferences: {},
      ...parsed,
    };
  } catch {
    console.warn('[usermodel] Failed to parse usermodel.json — starting fresh.');
    return structuredClone(DEFAULT_MODEL);
  }
}

/**
 * Persist user model.
 * @param {object} model
 */
export function saveUserModel(model) {
  ensureDataDir();
  writeFileSync(USERMODEL_FILE, JSON.stringify(model, null, 2), 'utf8');
}

// ── Update ────────────────────────────────────────────────────────────────────

/**
 * Update the user model using LLM-extracted updates from a conversation turn.
 * Merges new facts/interests/preferences into the existing model.
 *
 * @param {object} model         Current user model (mutated in place).
 * @param {string} userMessage
 * @param {string} assistantReply
 * @param {Function} llmCall     chatCompletion reference.
 * @returns {Promise<void>}
 */
export async function updateUserModel(model, userMessage, assistantReply, llmCall) {
  const prompt = [
    {
      role: 'system',
      content: `You are a user profiler. Given a conversation snippet, extract structured updates about the user.
Output a single JSON object with these optional keys (omit keys with no new info):
- "facts": { "label": "short factual string" }    — e.g. { "occupation": "software engineer" }
- "interests": { "topic": 0.0–1.0 }               — inferred interest strength, e.g. { "Rust": 0.9 }
- "preferences": { "label": "preference string" } — e.g. { "codeStyle": "prefers concise examples" }

Rules:
- Only include genuinely new or updated information from THIS snippet.
- Keep values short (< 15 words).
- Output ONLY valid JSON — no explanation, no markdown.`,
    },
    {
      role: 'user',
      content: `User: ${userMessage}\nOracle: ${assistantReply}`,
    },
  ];

  try {
    const raw = await llmCall(prompt, { maxTokens: 256, temperature: 0.1 });
    const cleaned = raw.replace(/```[a-z]*\n?/gi, '').trim();
    const updates = JSON.parse(cleaned);

    if (updates.facts && typeof updates.facts === 'object') {
      Object.assign(model.facts, updates.facts);
    }
    if (updates.interests && typeof updates.interests === 'object') {
      for (const [k, v] of Object.entries(updates.interests)) {
        if (typeof v === 'number') model.interests[k] = v;
      }
    }
    if (updates.preferences && typeof updates.preferences === 'object') {
      Object.assign(model.preferences, updates.preferences);
    }
  } catch (err) {
    // Non-JSON or parse error — skip silently
  }
}

// ── Prompt injection ──────────────────────────────────────────────────────────

/**
 * Build the user model section of the system prompt.
 * Only injects when there is actually something known.
 * @param {object} model
 * @returns {string}
 */
export function buildUserModelPrompt(model) {
  const parts = [];

  const facts = Object.entries(model.facts);
  const interests = Object.entries(model.interests)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);
  const prefs = Object.entries(model.preferences);

  if (facts.length === 0 && interests.length === 0 && prefs.length === 0) return '';

  parts.push('\n\n[Known about this user]:');
  if (facts.length > 0) {
    parts.push('Facts: ' + facts.map(([k, v]) => `${k}: ${v}`).join('; ') + '.');
  }
  if (interests.length > 0) {
    parts.push('Interests: ' + interests.map(([k]) => k).join(', ') + '.');
  }
  if (prefs.length > 0) {
    parts.push('Preferences: ' + prefs.map(([k, v]) => `${k}: ${v}`).join('; ') + '.');
  }

  return parts.join('\n');
}
