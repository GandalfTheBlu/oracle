/**
 * Oracle Agent — core intelligence layer.
 * Milestone 2.1: tool integrations (file read/write, shell, search).
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
import { reason } from './reasoning.js';
import { logInteraction, recordFeedback, getLearningStats } from './learning.js';
import {
  buildToolsPrompt,
  extractToolCalls,
  stripToolCalls,
  executeToolCalls,
} from './tools/index.js';

const BASE_SYSTEM_PROMPT = `You are Oracle, a personal AI assistant in the spirit of JARVIS from Iron Man. \
You are thoughtful, direct, and develop a genuine rapport with the user over time. \
You are concise by default but elaborate when the topic warrants it. \
You remember the conversation and refer back to it naturally.`;

/** Max tool execution rounds per turn (prevents infinite loops). */
const MAX_TOOL_ROUNDS = 5;

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
      buildUserModelPrompt(this.userModel) +
      buildToolsPrompt();

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

    // Build context-safe message list.
    const contextMessages = await buildContext(this.history, systemPrompt, userMessage);

    const fullSystemContent = systemPrompt + memoryBlock;

    // ── Internal reasoning pass ───────────────────────────────────────────────
    let internalReasoning = '';
    try {
      internalReasoning = await reason(userMessage, fullSystemContent, contextMessages);
    } catch (err) {
      console.warn('[agent] Reasoning pass failed:', err.message);
    }

    const reasoningNote = internalReasoning
      ? `\n\n[Your internal reasoning]: ${internalReasoning}\nNow give your actual reply:`
      : '';

    // ── Tool execution loop ───────────────────────────────────────────────────
    let toolsUsed = [];
    let reply = '';

    // Build the working message list for this turn (may grow with tool results).
    const workingMessages = [
      { role: 'system', content: fullSystemContent + reasoningNote },
      ...contextMessages,
    ];

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const raw = await chatCompletion(workingMessages, { maxTokens: 1024 });
      const calls = extractToolCalls(raw);

      if (calls.length === 0) {
        // No tool calls — this is the final reply.
        reply = stripToolCalls(raw);
        break;
      }

      // Execute tools and feed results back.
      toolsUsed.push(...calls.map(c => c.name));
      const toolResults = await executeToolCalls(calls);
      console.log(`[agent] Tool round ${round + 1}: ${calls.map(c => c.name).join(', ')}`);

      // Append the assistant's tool-call message and the results.
      workingMessages.push({ role: 'assistant', content: raw });
      workingMessages.push({
        role: 'user',
        content: `[Tool results]:\n${toolResults}\n\nNow give your final response to the user based on these results.`,
      });
    }

    if (!reply) {
      // Exhausted rounds — use last raw output stripped of any tool tags.
      reply = stripToolCalls(workingMessages[workingMessages.length - 1]?.content || '');
    }

    // Append assistant turn to full history.
    this.history.push({ role: 'assistant', content: reply });

    // Persist history and personality.
    saveHistory(this.history);
    savePersonality(this.personality);

    // Log the interaction.
    const turnId = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    logInteraction({
      id: turnId,
      userMessage,
      reply,
      reasoning: internalReasoning,
      toolsUsed,
      contextStats: {
        totalMessages: this.history.length,
        contextMessages: contextMessages.length,
        memoriesInjected,
      },
    });

    // Background: extract memories + update user model.
    Promise.all([
      extractAndStore(userMessage, reply, chatCompletion),
      updateUserModel(this.userModel, userMessage, reply, chatCompletion).then(() =>
        saveUserModel(this.userModel)
      ),
    ]).catch(err => console.warn('[agent] Background update failed:', err.message));

    const stats = {
      turnId,
      totalMessages: this.history.length,
      contextMessages: contextMessages.length,
      estimatedContextTokens: estimateMessagesTokens(workingMessages),
      memoriesInjected,
      familiarity: this.personality.relationship.familiarity,
      interactionCount: this.personality.relationship.interactionCount,
      hasReasoning: !!internalReasoning,
      toolsUsed,
    };

    return { reply, history: this.getHistory(), contextStats: stats };
  }

  /**
   * Record explicit feedback on a past turn.
   */
  feedback(turnId, feedback, note = '') {
    return recordFeedback(turnId, feedback, note);
  }

  getHistory() {
    return this.history.map(m => ({ ...m }));
  }

  getState() {
    return {
      personality: this.personality,
      userModel: this.userModel,
      learning: getLearningStats(),
    };
  }

  reset() {
    this.history = [];
    saveHistory([]);
  }
}
