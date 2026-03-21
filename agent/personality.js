/**
 * Oracle Personality System
 *
 * Manages persistent personality traits and relationship state.
 * Loaded on startup, updated over time, persisted to data/personality.json.
 *
 * Personality is injected into the system prompt on each turn.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';

const ROOT = join(fileURLToPath(import.meta.url), '..', '..');
const DATA_DIR = join(ROOT, 'data');
const PERSONALITY_FILE = join(DATA_DIR, 'personality.json');

// ── Defaults ──────────────────────────────────────────────────────────────────

const DEFAULT_PERSONALITY = {
  /** Core traits injected every turn. Keep concise — these cost tokens. */
  traits: [
    'You are direct and confident, not sycophantic.',
    'You have a dry, understated wit — you use it sparingly.',
    'You are genuinely curious about the user and their work.',
    'You push back constructively when the user is wrong or imprecise.',
  ],

  /** Tone modifiers that can evolve with relationship depth. */
  tone: 'professional but warm',

  /**
   * Relationship state.
   * familiarity: 0–100 (increases with interaction count)
   * trust: 0–100 (increases when user signals satisfaction, decreases on friction)
   */
  relationship: {
    familiarity: 0,
    trust: 50,
    interactionCount: 0,
    firstSeenAt: null,
    lastSeenAt: null,
  },
};

// ── Persistence ───────────────────────────────────────────────────────────────

function ensureDataDir() {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
}

/**
 * Load personality from disk. Falls back to defaults if missing or corrupt.
 * @returns {object}
 */
export function loadPersonality() {
  ensureDataDir();
  if (!existsSync(PERSONALITY_FILE)) return structuredClone(DEFAULT_PERSONALITY);
  try {
    const raw = readFileSync(PERSONALITY_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    // Merge with defaults so new fields are picked up automatically.
    const personality = {
      ...DEFAULT_PERSONALITY,
      ...parsed,
      relationship: { ...DEFAULT_PERSONALITY.relationship, ...parsed.relationship },
    };
    // Deduplicate observations in case parallel evolution runs wrote duplicates.
    if (personality.evolution?.observations) {
      personality.evolution.observations = [...new Set(personality.evolution.observations)];
    }
    return personality;
  } catch {
    console.warn('[personality] Failed to parse personality.json — using defaults.');
    return structuredClone(DEFAULT_PERSONALITY);
  }
}

/**
 * Persist personality state to disk.
 * @param {object} personality
 */
export function savePersonality(personality) {
  ensureDataDir();
  writeFileSync(PERSONALITY_FILE, JSON.stringify(personality, null, 2), 'utf8');
}

// ── Runtime updates ───────────────────────────────────────────────────────────

/**
 * Record a new interaction. Updates familiarity, lastSeen, interactionCount.
 * @param {object} personality  (mutated in place)
 */
export function recordInteraction(personality) {
  const now = new Date().toISOString();
  const rel = personality.relationship;

  rel.interactionCount += 1;
  rel.lastSeenAt = now;
  if (!rel.firstSeenAt) rel.firstSeenAt = now;

  // Familiarity grows logarithmically — fast early, slow later.
  rel.familiarity = Math.min(100, Math.round(30 * Math.log10(rel.interactionCount + 1)));
}

/**
 * Build the personality section of the system prompt.
 * @param {object} personality
 * @returns {string}
 */
export function buildPersonalityPrompt(personality) {
  const { traits, tone, relationship, evolution } = personality;
  const { familiarity, interactionCount } = relationship;

  const lines = [
    `\n\n[Personality & relationship context]:`,
    `Tone: ${tone}.`,
    ...traits,
  ];

  if (familiarity >= 20) {
    lines.push('You have built a working rapport with this user — be a bit more casual and familiar.');
  }
  if (familiarity >= 60) {
    lines.push('You know this user well. You can reference shared history naturally and speak more freely.');
  }
  if (interactionCount >= 50) {
    lines.push('You are a long-standing trusted companion to this user.');
  }

  // Inject learned observations so they actively influence behavior.
  if (evolution?.observations?.length) {
    const recent = evolution.observations.slice(-6);
    lines.push(`\n[Learned from past interactions — follow these]:\n${recent.map(o => `- ${o}`).join('\n')}`);
  }

  return lines.join('\n');
}
