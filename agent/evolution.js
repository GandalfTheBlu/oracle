/**
 * Oracle Personality Evolution
 *
 * Periodically analyses recent interactions and produces structured
 * updates to Oracle's personality traits and tone. The goal is for
 * Oracle to genuinely adapt to the user over time — not just track
 * familiarity, but actually change how it communicates.
 *
 * Trigger: every EVOLUTION_INTERVAL interactions since last evolution.
 * Input:   last 20 learning log entries.
 * Output:  { tone, addTraits, removeTraits, observations } applied to personality.json.
 */

import { getRecentInteractions } from './learning.js';

/** Minimum new interactions before an evolution pass runs. */
export const EVOLUTION_INTERVAL = 10;

/**
 * Returns true if enough new interactions have occurred since the last evolution.
 * @param {object} personality
 * @returns {boolean}
 */
export function shouldEvolve(personality) {
  const current = personality.relationship.interactionCount;
  const lastCount = personality.evolution?.interactionCount ?? 0;
  return (current - lastCount) >= EVOLUTION_INTERVAL;
}

/**
 * Run an evolution pass: analyse recent interactions, return suggested updates.
 * Returns null if there's not enough data or the LLM fails.
 *
 * @param {object} personality
 * @param {object} userModel
 * @param {Function} chatCompletion
 * @returns {Promise<object|null>}
 */
export async function runEvolution(personality, userModel, chatCompletion) {
  const interactions = getRecentInteractions(20);
  if (interactions.length < 5) {
    console.log('[evolution] Not enough interactions to evolve yet.');
    return null;
  }

  // Build a compact transcript for analysis — truncated to fit context.
  const transcript = interactions.map(i => {
    const fb = i.feedback ? ` [feedback: ${i.feedback}${i.feedbackNote ? ` — "${i.feedbackNote}"` : ''}]` : '';
    const tools = i.toolsUsed?.length ? ` (tools: ${i.toolsUsed.join(', ')})` : '';
    const user = i.userMessage.slice(0, 120);
    const reply = i.reply.slice(0, 180);
    return `U: ${user}\nO: ${reply}${fb}${tools}`;
  }).join('\n---\n');

  const currentTraits = personality.traits.join('\n- ');
  const previousObs = personality.evolution?.observations?.slice(-5).join('; ') || 'none';

  const prompt = `Analyse this conversation history between a user and Oracle (an AI assistant).
Your job: identify behavioural patterns and produce concrete personality updates.

Current Oracle personality:
- Tone: ${personality.tone}
- Traits:
- ${currentTraits}

Previous observations (context): ${previousObs}

Recent interactions (newest last):
${transcript}

Produce a JSON object — nothing else, no markdown fences:
{
  "tone": "updated tone string, or null to keep current",
  "addTraits": ["new trait sentence to add (max 2)"],
  "removeTraits": ["exact trait text to remove"],
  "observations": ["concrete pattern you noticed (max 4)"]
}

Rules:
- observations must be specific and actionable (e.g. "user prefers answers under 2 sentences", "user likes code examples").
- If an observation clearly shows a user preference, convert it into a trait in addTraits. Example: if user repeatedly asks for shorter answers, add "You keep responses brief — 1 to 3 sentences — unless the user explicitly asks for detail."
- If a trait contradicts observed behaviour, move it to removeTraits.
- Traits must start with "You" and be one clear instruction.
- Do not duplicate existing traits.
- It is fine to return empty arrays if no clear patterns emerge.`;

  try {
    const raw = await chatCompletion(
      [
        { role: 'system', content: 'You are an analytical assistant. Output only valid JSON with no markdown.' },
        { role: 'user', content: prompt },
      ],
      { maxTokens: 512, temperature: 0.2 }
    );

    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.warn('[evolution] No JSON found in LLM response:', raw.slice(0, 200));
      return null;
    }

    return JSON.parse(jsonMatch[0]);
  } catch (err) {
    console.warn('[evolution] Failed to parse evolution response:', err.message);
    return null;
  }
}

/**
 * Apply evolution updates to the personality object (mutates in place).
 * @param {object} personality
 * @param {object} updates  — { tone, addTraits, removeTraits, observations }
 */
export function applyEvolution(personality, updates) {
  if (!updates) return;

  if (!personality.evolution) {
    personality.evolution = { count: 0, observations: [], lastAt: null, interactionCount: 0 };
  }

  // Update tone if LLM suggested one.
  if (updates.tone && updates.tone !== 'null' && typeof updates.tone === 'string') {
    personality.tone = updates.tone.trim();
  }

  // Remove traits the LLM flagged (by exact match).
  if (Array.isArray(updates.removeTraits) && updates.removeTraits.length) {
    const toRemove = new Set(updates.removeTraits);
    personality.traits = personality.traits.filter(t => !toRemove.has(t));
  }

  // Add new traits (deduplicated).
  if (Array.isArray(updates.addTraits)) {
    for (const trait of updates.addTraits.slice(0, 2)) {
      if (trait && typeof trait === 'string' && !personality.traits.includes(trait)) {
        personality.traits.push(trait.trim());
      }
    }
  }

  // Append observations (deduplicated, rolling window of last 20).
  if (Array.isArray(updates.observations)) {
    const existing = new Set(personality.evolution.observations);
    for (const obs of updates.observations.slice(0, 4)) {
      if (obs && !existing.has(obs)) {
        personality.evolution.observations.push(obs);
        existing.add(obs);
      }
    }
    personality.evolution.observations = personality.evolution.observations.slice(-20);
  }

  personality.evolution.count = (personality.evolution.count || 0) + 1;
  personality.evolution.lastAt = new Date().toISOString();
  personality.evolution.interactionCount = personality.relationship.interactionCount;

  console.log('[evolution] Pass complete. Tone:', personality.tone);
  console.log('[evolution] Traits now:', personality.traits);
  console.log('[evolution] Observations:', updates.observations);
}
