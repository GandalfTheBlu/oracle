/**
 * Oracle Agent — core intelligence layer.
 * Milestone 1.2: persistent history + context window management.
 */

import { chatCompletion } from './llm.js';
import { loadHistory, saveHistory } from './history.js';
import { buildContext, estimateMessagesTokens } from './context.js';

const SYSTEM_PROMPT = `You are Oracle, a personal AI assistant in the spirit of JARVIS from Iron Man. \
You are thoughtful, direct, and develop a genuine rapport with the user over time. \
You are concise by default but elaborate when the topic warrants it. \
You remember the conversation and refer back to it naturally.`;

export class Agent {
  constructor() {
    /** @type {Array<{role: string, content: string}>} Full raw history */
    this.history = loadHistory();
  }

  /**
   * Process a user message and return the agent's response.
   * @param {string} userMessage
   * @returns {Promise<{reply: string, history: Array, contextStats: object}>}
   */
  async chat(userMessage) {
    // Append user turn.
    this.history.push({ role: 'user', content: userMessage });

    // Build context-safe message list (compacts if over budget).
    const contextMessages = await buildContext(this.history, SYSTEM_PROMPT, userMessage);

    const messages = [
      { role: 'system', content: SYSTEM_PROMPT },
      ...contextMessages,
    ];

    const reply = await chatCompletion(messages, { maxTokens: 1024 });

    // Append assistant turn to full history.
    this.history.push({ role: 'assistant', content: reply });

    // Persist to disk.
    saveHistory(this.history);

    const stats = {
      totalMessages: this.history.length,
      contextMessages: contextMessages.length,
      estimatedContextTokens: estimateMessagesTokens(messages),
    };

    return { reply, history: this.getHistory(), contextStats: stats };
  }

  /**
   * Return a copy of the conversation history.
   */
  getHistory() {
    return this.history.map(m => ({ ...m }));
  }

  /**
   * Clear the conversation history (in-memory and on disk).
   */
  reset() {
    this.history = [];
    saveHistory([]);
  }
}
