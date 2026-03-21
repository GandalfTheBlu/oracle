/**
 * Oracle Agent — core intelligence layer.
 * Milestone 1.2: persistent history + context window management.
 */

import { chatCompletion } from './llm.js';
import { loadHistory, saveHistory } from './history.js';
import { buildContext, estimateMessagesTokens } from './context.js';
import { retrieveMemories, extractAndStore } from './memory.js';

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

    // Retrieve relevant memories.
    let memoryBlock = '';
    try {
      const memories = await retrieveMemories(userMessage);
      if (memories.length > 0) {
        memoryBlock =
          '\n\n[Relevant memories from past interactions]:\n' +
          memories.map(m => `- (${m.type}) ${m.text}`).join('\n');
      }
    } catch (err) {
      console.warn('[agent] Memory retrieval failed:', err.message);
    }

    // Build context-safe message list (compacts if over budget).
    const contextMessages = await buildContext(this.history, SYSTEM_PROMPT, userMessage);

    const systemContent = SYSTEM_PROMPT + memoryBlock;

    const messages = [
      { role: 'system', content: systemContent },
      ...contextMessages,
    ];

    const reply = await chatCompletion(messages, { maxTokens: 1024 });

    // Append assistant turn to full history.
    this.history.push({ role: 'assistant', content: reply });

    // Persist to disk.
    saveHistory(this.history);

    // Extract and store memories in background (don't await — keep response fast).
    extractAndStore(userMessage, reply, chatCompletion).catch(err =>
      console.warn('[agent] Memory storage failed:', err.message)
    );

    const stats = {
      totalMessages: this.history.length,
      contextMessages: contextMessages.length,
      estimatedContextTokens: estimateMessagesTokens(messages),
      memoriesInjected: memoryBlock ? memoryBlock.split('\n- ').length - 1 : 0,
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
