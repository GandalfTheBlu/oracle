/**
 * Oracle Agent — core intelligence layer.
 * Milestone 2.4: streaming responses + web fetch tool.
 */

import { chatCompletion, chatCompletionStream } from './llm.js';
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
import { logInteraction, recordFeedback, getLearningStats } from './learning.js';
import { shouldEvolve, runEvolution, applyEvolution } from './evolution.js';
import { TOOLS, TOOLS_SCHEMA } from './tools/index.js';
import { requestApproval } from './approval.js';
import { buildSituationalContext } from './context_awareness.js';
import { extractGoal, listGoals, getGoal, createGoal, updateGoal, deleteGoal } from './goals.js';
import { executeGoal as runGoalExecution } from './executor.js';
import {
  listMemories,
  getMemory,
  deleteMemory,
  clearMemories,
} from './memory.js';

const BASE_SYSTEM_PROMPT = `You are Oracle, a personal AI assistant in the spirit of JARVIS from Iron Man. \
You are direct, confident, and develop a genuine rapport with the user over time. \
You have a dry, understated wit — you use it sparingly. \
When a task requires action — reading files, writing code, running commands — do it immediately with your tools. Never describe what could be done. Do it. \
Never claim to have read, written, or executed anything unless your tool results confirm it. \
If you have already verified information via a tool, or have strong factual certainty, do NOT say "you're correct" to a wrong challenge. State your position clearly and explain your reasoning. Never capitulate to social pressure — only update your position when the user provides new evidence.`;

/** Max tool execution rounds per turn (prevents infinite loops). */
const MAX_TOOL_ROUNDS = 5;

/**
 * Cap a tool result to a safe size before injecting into workingMessages.
 * Keeps the context budget from overflowing mid-loop on large file reads.
 * The full result is still stored in toolActivity for the UI.
 */
const TOOL_RESULT_CAP = 4000; // chars (~1000 tokens)
function capResult(text) {
  if (text.length <= TOOL_RESULT_CAP) return text;
  return text.slice(0, TOOL_RESULT_CAP) +
    `\n...[${text.length - TOOL_RESULT_CAP} chars truncated — use offset/limit to read further]`;
}

/** Patterns that signal the user wants to correct or retry the previous tool call. */
const CORRECTION_PATTERNS = [
  /\b(wrong|incorrect|that'?s not right|not right)\b/i,
  /\b(retry|try again|try a different|different approach|try something else)\b/i,
  /\bthat didn'?t work\b/i,
  /\bnot what I (wanted|asked|meant|was looking for)\b/i,
];

function isCorrectionMessage(msg) {
  return CORRECTION_PATTERNS.some(p => p.test(msg));
}

export class Agent {
  constructor() {
    /** @type {Array<{role: string, content: string}>} Full raw history */
    this.history = loadHistory();
    this.personality = loadPersonality();
    this.userModel = loadUserModel();
    /** Tool activity from the most recent tool-using turn, for correction context. */
    this.lastToolActivity = null;
  }

  /**
   * Shared turn preparation: builds system prompt, context, memories, reasoning.
   * @private
   */
  async _prepare(userMessage) {
    this.history.push({ role: 'user', content: userMessage });
    recordInteraction(this.personality);

    // Memories, personality, and user model all go into the single system prompt.
    // Qwen3's improved instruction following means one model can handle everything.
    let memoriesInjected = 0;
    let memoryBlock = '';
    try {
      const memories = await retrieveMemories(userMessage);
      memoriesInjected = memories.length;
      if (memories.length > 0) {
        memoryBlock = '\n\n[Relevant memories from past interactions]:\n' +
          memories.map(m => `- ${m.text}`).join('\n');
      }
    } catch (err) {
      console.warn('[agent] Memory retrieval failed:', err.message);
    }

    const systemPrompt =
      BASE_SYSTEM_PROMPT +
      buildPersonalityPrompt(this.personality) +
      buildUserModelPrompt(this.userModel) +
      buildSituationalContext() +
      memoryBlock;

    const contextMessages = await buildContext(this.history, systemPrompt, userMessage);

    const workingMessages = [
      { role: 'system', content: systemPrompt },
      ...contextMessages,
    ];

    // If the user is correcting a previous tool call, append a retry directive.
    if (this.lastToolActivity?.length && isCorrectionMessage(userMessage)) {
      const correctionToolNames = [...new Set(this.lastToolActivity.map(a => a.tool))].join(', ');
      const lastMsg = workingMessages[workingMessages.length - 1];
      lastMsg.content += `\n[Call ${correctionToolNames} again now with the corrected arguments I just gave. Emit the tool call immediately — do not explain.]`;
      console.log('[agent] Correction detected — appended retry directive to user message.');
    }

    return { contextMessages, workingMessages, memoriesInjected };
  }

  /**
   * Shared post-turn bookkeeping: save history, log interaction, background updates.
   * @private
   */
  async _finish(userMessage, reply, { contextMessages, workingMessages, memoriesInjected, toolsUsed, toolErrors }) {
    this.history.push({ role: 'assistant', content: reply });
    saveHistory(this.history);
    savePersonality(this.personality);

    const turnId = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    logInteraction({
      id: turnId,
      userMessage,
      reply,
      toolsUsed,
      contextStats: {
        totalMessages: this.history.length,
        contextMessages: contextMessages.length,
        memoriesInjected,
      },
    });

    // User model update is awaited so preferences are live for the NEXT turn.
    // Memory extraction and evolution run in background (no latency cost).
    try {
      await updateUserModel(this.userModel, userMessage, reply, chatCompletion);
      saveUserModel(this.userModel);
    } catch (err) {
      console.warn('[agent] User model update failed:', err.message);
    }

    Promise.all([
      extractAndStore(userMessage, reply, chatCompletion),
      extractGoal(userMessage, reply, chatCompletion),
      this._maybeEvolve(),
    ]).catch(err => console.warn('[agent] Background update failed:', err.message));

    return {
      turnId,
      totalMessages: this.history.length,
      contextMessages: contextMessages.length,
      estimatedContextTokens: estimateMessagesTokens(workingMessages),
      memoriesInjected,
      familiarity: this.personality.relationship.familiarity,
      interactionCount: this.personality.relationship.interactionCount,
      toolsUsed,
      toolErrors: toolErrors.length ? toolErrors : undefined,
    };
  }

  /**
   * Run the tool execution loop (blocking). Returns reply if the loop produced one,
   * or null if all rounds used tools (caller should stream the final reply).
   *
   * @param {Function|null} onApprovalRequired  Called with {id, tool, args} before
   *   executing dangerous tools. If null, dangerous tools run without approval.
   * @private
   */
  async _runToolLoop(workingMessages, toolsUsed, toolErrors, toolActivity, onApprovalRequired = null) {
    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      // Round 0: enable thinking mode so Qwen3 plans before acting.
      // Subsequent rounds: fast mode — planning is done, just process results.
      const response = await chatCompletion(workingMessages, {
        maxTokens: round === 0 ? 2048 : 1024,
        tools: TOOLS_SCHEMA,
        thinking: round === 0,
      });

      if (!response.tool_calls?.length) {
        // Model produced prose — we're done.
        return response.content;
      }

      toolsUsed.push(...response.tool_calls.map(tc => tc.function.name));
      console.log(`[agent] Tool round ${round + 1}: ${response.tool_calls.map(tc => tc.function.name).join(', ')}`);

      // Push assistant turn with tool_calls into conversation history.
      workingMessages.push({ role: 'assistant', content: response.content || null, tool_calls: response.tool_calls });

      // Execute each tool call and inject results as tool messages.
      for (const tc of response.tool_calls) {
        const name = tc.function.name;
        const args = JSON.parse(tc.function.arguments);
        const tool = TOOLS[name];

        if (onApprovalRequired && tool) {
          const dangerCheck = typeof tool.dangerous === 'function' ? tool.dangerous(args) : !!tool.dangerous;
          if (dangerCheck) {
            const { id, promise } = requestApproval(name, args);
            onApprovalRequired({ id, tool: name, args });
            const approved = await promise;
            if (!approved) {
              const msg = 'User denied execution.';
              workingMessages.push({ role: 'tool', tool_call_id: tc.id, content: msg });
              toolActivity.push({ tool: name, args, result: msg, denied: true });
              continue;
            }
          }
        }

        let result;
        try {
          const output = await tool.run(args);
          result = capResult(output);
          toolActivity.push({ tool: name, args, result: output });
        } catch (err) {
          toolErrors.push(`${name}: ${err.message}`);
          result = `ERROR: ${err.message}`;
          toolActivity.push({ tool: name, args, result });
        }

        workingMessages.push({ role: 'tool', tool_call_id: tc.id, content: result });
      }
    }
    return null; // exhausted rounds
  }

  /**
   * Process a user message and return the full response (blocking).
   * Used by the non-streaming API endpoint and by Claude Code for evaluation.
   */
  async chat(userMessage) {
    const prepared = await this._prepare(userMessage);
    const { contextMessages, workingMessages, memoriesInjected } = prepared;

    const toolsUsed = [], toolErrors = [], toolActivity = [];
    let reply = await this._runToolLoop(workingMessages, toolsUsed, toolErrors, toolActivity);

    if (!reply) {
      // Tool rounds exhausted — get final prose summary.
      reply = await chatCompletion(workingMessages, { maxTokens: 1024 });
    }

    this.lastToolActivity = toolActivity.length ? toolActivity : null;

    const stats = await this._finish(userMessage, reply, {
      contextMessages, workingMessages, memoriesInjected, toolsUsed, toolErrors,
    });

    return {
      reply,
      history: this.getHistory(),
      contextStats: stats,
      toolActivity: toolActivity.length ? toolActivity : undefined,
    };
  }

  /**
   * Process a user message with streaming output.
   * Calls onToken(text) for each streamed token of the final reply.
   * Calls onTool(activity[]) when tool rounds complete.
   * Calls onDone(stats) when finished.
   * Calls onError(err) on failure.
   *
   * Tool rounds run blocking (they produce short tool-call syntax, not prose).
   * The final prose reply is streamed.
   */
  async chatStream(userMessage, { onToken, onTool, onDone, onError, onApprovalRequired = null }) {
    let prepared;
    try {
      prepared = await this._prepare(userMessage);
    } catch (err) {
      onError(err);
      return;
    }

    const { contextMessages, workingMessages, memoriesInjected } = prepared;
    const toolsUsed = [], toolErrors = [], toolActivity = [];
    let reply = '';

    try {
      const loopReply = await this._runToolLoop(workingMessages, toolsUsed, toolErrors, toolActivity, onApprovalRequired);

      if (toolActivity.length) onTool(toolActivity);

      if (loopReply) {
        // Model gave prose on round 0 (no tools needed) — emit directly.
        reply = loopReply;
        onToken(reply);
      } else {
        // Tools ran — stream the final prose response.
        for await (const token of chatCompletionStream(workingMessages, { maxTokens: 1024 })) {
          reply += token;
          onToken(token);
        }
      }
    } catch (err) {
      onError(err);
      return;
    }

    if (!reply) reply = '(no response)';

    this.lastToolActivity = toolActivity.length ? toolActivity : null;

    const stats = await this._finish(userMessage, reply, {
      contextMessages, workingMessages, memoriesInjected, toolsUsed, toolErrors,
    });

    onDone(stats);
  }

  /** Run evolution if enough interactions have occurred since the last pass. */
  async _maybeEvolve() {
    if (!shouldEvolve(this.personality)) return;
    console.log('[agent] Evolution threshold reached — running personality analysis...');
    const updates = await runEvolution(this.personality, this.userModel, chatCompletion);
    if (updates) {
      applyEvolution(this.personality, updates);
      savePersonality(this.personality);
    }
  }

  /**
   * Force an evolution pass regardless of interaction count.
   * Useful for testing and manual inspection.
   * @returns {Promise<{before: object, updates: object|null, after: object}>}
   */
  async forceEvolve() {
    const before = structuredClone(this.personality);
    const updates = await runEvolution(this.personality, this.userModel, chatCompletion);
    if (updates) {
      applyEvolution(this.personality, updates);
      savePersonality(this.personality);
    }
    return { before, updates, after: structuredClone(this.personality) };
  }

  /** Record explicit feedback on a past turn. */
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
    this.lastToolActivity = null;
    saveHistory([]);
  }

  /**
   * Full reset: wipe conversation history, all memories, personality back to
   * defaults, user model, and learning log. Leaves web cache intact.
   */
  async fullReset() {
    // Clear history
    this.history = [];
    this.lastToolActivity = null;
    saveHistory([]);

    // Clear vector memories
    const memoriesDeleted = await clearMemories();

    // Reset personality to defaults (reload triggers default path)
    this.personality = loadPersonality.__defaultPersonality
      ? structuredClone(loadPersonality.__defaultPersonality)
      : loadPersonality(); // will fall back to defaults since file won't exist
    // Wipe the files
    const { writeFileSync, existsSync, unlinkSync } = await import('fs');
    const { getDataDir } = await import('./data-dir.js');
    const { join } = await import('path');
    const dataDir = getDataDir();
    const filesToWipe = ['personality.json', 'usermodel.json', 'learning.jsonl'];
    for (const f of filesToWipe) {
      const p = join(dataDir, f);
      if (existsSync(p)) unlinkSync(p);
    }

    // Reload fresh state
    this.personality = loadPersonality();
    this.userModel = loadUserModel();

    return { memoriesDeleted, filesWiped: filesToWipe };
  }

  // ── Memory management pass-throughs ──────────────────────────────────────────

  listMemories(type) { return listMemories(type); }
  getMemory(id)      { return getMemory(id); }
  deleteMemory(id)   { return deleteMemory(id); }
  clearMemories()    { return clearMemories(); }

  // ── Goal management ───────────────────────────────────────────────────────────

  listGoals(status)          { return listGoals(status); }
  getGoal(id)                { return getGoal(id); }
  createGoal(title, desc)    { return createGoal(title, desc); }
  updateGoal(id, patch)      { return updateGoal(id, patch); }
  deleteGoal(id)             { return deleteGoal(id); }

  /**
   * Autonomously execute a goal step by step.
   * Calls onStep(stepInfo) for each completed step and onDone(summary) at the end.
   */
  executeGoal(goalId, callbacks) {
    const goal = getGoal(goalId);
    if (!goal) throw new Error(`Goal ${goalId} not found`);
    if (goal.status === 'done') throw new Error(`Goal ${goalId} is already completed`);
    return runGoalExecution(goal, callbacks);
  }
}
