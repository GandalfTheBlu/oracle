/**
 * Oracle Agent — core intelligence layer.
 * Milestone 1.1: stub with in-memory conversation history and LLM wiring.
 */

import { chatCompletion } from './llm.js';

const SYSTEM_PROMPT = `You are Oracle, a personal AI assistant in the spirit of JARVIS from Iron Man. \
You are thoughtful, direct, and develop a genuine rapport with the user over time. \
You are concise by default but elaborate when the topic warrants it. \
You remember the conversation and refer back to it naturally.`;

export class Agent {
  constructor() {
    /** @type {Array<{role: string, content: string}>} */
    this.history = [];
  }

  /**
   * Process a user message and return the agent's response.
   * @param {string} userMessage
   * @returns {Promise<{reply: string, history: Array}>}
   */
  async chat(userMessage) {
    this.history.push({ role: 'user', content: userMessage });

    const messages = [
      { role: 'system', content: SYSTEM_PROMPT },
      ...this.history,
    ];

    const reply = await chatCompletion(messages, { maxTokens: 1024 });

    this.history.push({ role: 'assistant', content: reply });

    return { reply, history: this.getHistory() };
  }

  /**
   * Return a copy of the conversation history (no system prompt).
   */
  getHistory() {
    return this.history.map(m => ({ ...m }));
  }

  /**
   * Clear the conversation history.
   */
  reset() {
    this.history = [];
  }
}
