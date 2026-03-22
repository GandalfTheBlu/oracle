/**
 * Context management — token estimation, relevance scoring, and
 * summarization-based compaction for the conversation window.
 *
 * Strategy:
 *  1. Estimate tokens for the full history + system prompt.
 *  2. If within budget, pass everything to the LLM.
 *  3. If over budget:
 *     a. Score each message by relevance to the latest user query.
 *     b. Always keep the N most recent turns verbatim (RECENCY_KEEP).
 *     c. Summarize the oldest messages that won't fit via an LLM call.
 *     d. Inject the summary as a single synthetic 'system' message at
 *        the start of the history (after the real system prompt).
 */

import { chatCompletion } from './llm.js';

// ── Config ────────────────────────────────────────────────────────────────────

/** LLM context size in tokens (from config — 8192 total). */
const CONTEXT_LIMIT = 8192;

/**
 * Target budget for history + system prompt together.
 * Leave ~512 tokens headroom for the model's reply.
 */
const HISTORY_BUDGET = CONTEXT_LIMIT - 512;

/** Always keep this many most-recent message pairs (user+assistant) verbatim. */
const RECENCY_KEEP_PAIRS = 3;

// ── Token estimation ──────────────────────────────────────────────────────────

/**
 * Rough token count: ~4 chars per token (good enough for budgeting).
 * @param {string} text
 * @returns {number}
 */
export function estimateTokens(text) {
  return Math.ceil(text.length / 4);
}

/**
 * Estimate total tokens for a list of messages.
 * @param {Array<{role: string, content: string}>} messages
 * @returns {number}
 */
export function estimateMessagesTokens(messages) {
  return messages.reduce((sum, m) => sum + estimateTokens(m.role + m.content) + 4, 0);
}

// ── Relevance scoring ─────────────────────────────────────────────────────────

/**
 * Score a message's relevance to the current query.
 * Uses simple normalized word-overlap (Jaccard-like).
 * Returns a value in [0, 1].
 *
 * @param {string} messageContent
 * @param {string} query
 * @returns {number}
 */
export function relevanceScore(messageContent, query) {
  const words = (s) =>
    new Set(s.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(Boolean));

  const msgWords = words(messageContent);
  const queryWords = words(query);
  if (queryWords.size === 0 || msgWords.size === 0) return 0;

  let overlap = 0;
  for (const w of queryWords) {
    if (msgWords.has(w)) overlap++;
  }

  // Union size
  const union = new Set([...msgWords, ...queryWords]).size;
  return overlap / union;
}

// ── Summarization ─────────────────────────────────────────────────────────────

/**
 * Ask the LLM to summarize a set of messages into a compact paragraph.
 * @param {Array<{role: string, content: string}>} messages
 * @returns {Promise<string>}
 */
async function summarize(messages) {
  const transcript = messages
    .map(m => `${m.role === 'user' ? 'User' : 'Oracle'}: ${m.content}`)
    .join('\n');

  const prompt = [
    {
      role: 'system',
      content:
        'You are a precise summarizer. Summarize the conversation excerpt below into 2-4 concise sentences, ' +
        'preserving all key facts, topics, decisions, and user preferences mentioned. ' +
        'Output only the summary — no preamble.',
    },
    { role: 'user', content: transcript },
  ];

  return chatCompletion(prompt, { maxTokens: 256, temperature: 0.3 });
}

// ── Main compaction ───────────────────────────────────────────────────────────

/**
 * Given the current history and the latest user query, return a context-safe
 * list of messages ready to be prepended with the system prompt and sent to
 * the LLM.
 *
 * If the history fits within budget, returns it as-is.
 * Otherwise, summarizes old messages and injects the summary.
 *
 * @param {Array<{role: string, content: string}>} history   Full raw history
 * @param {string} systemPrompt
 * @param {string} currentQuery  The user's latest message (already appended to history)
 * @returns {Promise<Array<{role: string, content: string}>>}
 *   Messages ready to send (does NOT include the system prompt itself).
 */
export async function buildContext(history, systemPrompt, currentQuery) {
  const systemTokens = estimateTokens(systemPrompt) + 4;
  const available = HISTORY_BUDGET - systemTokens;

  // If history fits, return as-is.
  if (estimateMessagesTokens(history) <= available) {
    return history;
  }

  // ── Over budget — need to compact ──────────────────────────────────────────

  // Split into "recent" (always kept verbatim) and "old" (candidates for summary).
  const recentCount = RECENCY_KEEP_PAIRS * 2; // each pair = user + assistant
  const recent = history.slice(-recentCount);
  const old = history.slice(0, history.length - recentCount);

  if (old.length === 0) {
    // Even just the recent turns are too large — can't compact further.
    // Return as many recent turns as fit.
    return recent;
  }

  // Score old messages by relevance to current query and sort descending.
  const scored = old.map((m, i) => ({
    msg: m,
    originalIndex: i,
    score: relevanceScore(m.content, currentQuery),
  }));

  // Pick the highest-relevance old messages that fit in the remaining budget
  // after reserving space for: summary + recent turns.
  const recentTokens = estimateMessagesTokens(recent);
  const summaryBudget = Math.floor((available - recentTokens) * 0.3); // 30% for summary
  const verbatimBudget = available - recentTokens - summaryBudget;

  // Sort by relevance desc, then pick those that fit in verbatimBudget.
  scored.sort((a, b) => b.score - a.score);
  const verbatimKept = [];
  let used = 0;
  for (const { msg, originalIndex, score } of scored) {
    if (score === 0) break; // no point keeping zero-relevance old messages
    const t = estimateMessagesTokens([msg]);
    if (used + t <= verbatimBudget) {
      verbatimKept.push({ msg, originalIndex });
      used += t;
    }
  }

  // Summarize everything in `old` that isn't being kept verbatim.
  const keptIndices = new Set(verbatimKept.map(v => v.originalIndex));
  const toSummarize = old.filter((_, i) => !keptIndices.has(i));

  let summaryMessage = null;
  if (toSummarize.length > 0) {
    try {
      const summaryText = await summarize(toSummarize);
      summaryMessage = {
        role: 'system',
        content: `[Earlier conversation summary]: ${summaryText}`,
      };
    } catch (err) {
      console.warn('[context] Summarization failed, dropping old messages:', err.message);
    }
  }

  // Re-order kept verbatim messages by original index (preserve chronology).
  verbatimKept.sort((a, b) => a.originalIndex - b.originalIndex);
  const verbatimMessages = verbatimKept.map(v => v.msg);

  // Assemble final context.
  return [
    ...(summaryMessage ? [summaryMessage] : []),
    ...verbatimMessages,
    ...recent,
  ];
}
