/**
 * Oracle Agent — core intelligence layer.
 * Milestone 1.4: personality system + user model.
 */

import { chatCompletion } from './llm.js';
import { loadHistory, saveHistory } from './history.js';
import { buildContext, estimateMessagesTokens } from './context.js';
import { retrieveMemories, extractAndStore } from './memory.js';
import {
  loadPersonality,
  savePersonality,
  recordInteraction,
  buildPersonalityPrompt,
} from './personality.js';
import {
  loadUserModel,
  saveUserModel,
  updateUserModel,
  buildUserModelPrompt,
} from './usermodel.js';

const BASE_SYSTEM_PROMPT = `You are Oracle, a personal AI assistant in the spirit of JARVIS from Iron Man. \
You are thoughtful, direct, and develop a genuine rapport with the user over time. \
You are concise by default but elaborate when the topic warrants it. \
You remember the conversation and refer back to it naturally.`;

export class Agent {
  constructor() {
    /** @type {Array<{role: string, content: string}>} Full raw history */
    this.history = loadHistory();
    this.personality = loadPersonality();
    this.userModel = loadUserModel();
  }

  /**
   * Process a user message and return the agent's response.
   * @param {string} userMessage
   * @returns {Promise<{reply: string, history: Array, contextStats: object}>}
   */
  async chat(userMessage) {
    // Append user turn.
    this.history.push({ role: 'user', content: userMessage });

    // Update relationship state.
    recordInteraction(this.personality);

    // Build dynamic system prompt.
    const systemPrompt =
      BASE_SYSTEM_PROMPT +
      buildPersonalityPrompt(this.personality) +
      buildUserModelPrompt(this.userModel);

    // Retrieve relevant memories.
    let memoryBlock = '';
    let memoriesInjected = 0;
    try {
      const memories = await retrieveMemories(userMessage);
      if (memories.length > 0) {
        memoryBlock =
          '\n\n[Relevant memories from past interactions]:\n' +
          memories.map(m => `- (${m.type}) ${m.text}`).join('\n');
        memoriesInjected = memories.length;
      }
    } catch (err) {
      console.warn('[agent] Memory retrieval failed:', err.message);
    }

    // Build context-safe message list (compacts if over budget).
    const contextMessages = await buildContext(this.history, systemPrompt, userMessage);

    const messages = [
      { role: 'system', content: systemPrompt + memoryBlock },
      ...contextMessages,
    ];

    const reply = await chatCompletion(messages, { maxTokens: 1024 });

    // Append assistant turn to full history.
    this.history.push({ role: 'assistant', content: reply });

    // Persist history and personality.
    saveHistory(this.history);
    savePersonality(this.personality);

    // Background: extract memories + update user model.
    Promise.all([
      extractAndStore(userMessage, reply, chatCompletion),
      updateUserModel(this.userModel, userMessage, reply, chatCompletion).then(() =>
        saveUserModel(this.userModel)
      ),
    ]).catch(err => console.warn('[agent] Background update failed:', err.message));

    const stats = {
      totalMessages: this.history.length,
      contextMessages: contextMessages.length,
      estimatedContextTokens: estimateMessagesTokens(messages),
      memoriesInjected,
      familiarity: this.personality.relationship.familiarity,
      interactionCount: this.personality.relationship.interactionCount,
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
   * Return current personality + user model state (for inspection).
   */
  getState() {
    return {
      personality: this.personality,
      userModel: this.userModel,
    };
  }

  /**
   * Clear the conversation history (in-memory and on disk).
   * Does NOT reset personality or user model — those persist across sessions.
   */
  reset() {
    this.history = [];
    saveHistory([]);
  }
}
