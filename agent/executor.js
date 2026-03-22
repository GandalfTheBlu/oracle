/**
 * Oracle Autonomous Executor
 *
 * Drives a goal to completion without user input between steps.
 * Each step: LLM call with tools → execute tool calls → report result → repeat.
 * The LLM signals completion by including [DONE] in its response.
 *
 * The executor reuses the same tools and tool schema as regular chat turns,
 * so anything Oracle can do in conversation it can do autonomously here.
 */

import { chatCompletion } from './llm.js';
import { TOOLS, TOOLS_SCHEMA } from './tools/index.js';
import { appendStep, updateGoal } from './goals.js';

const MAX_STEPS = 10;
const TOOL_RESULT_CAP = 4000;

function buildSystemPrompt(goal) {
  return (
    `You are Oracle, autonomously executing a goal on behalf of the user.\n\n` +
    `Goal: ${goal.title}\n` +
    (goal.description ? `Details: ${goal.description}\n` : '') +
    `\nInstructions:\n` +
    `- Take ONE concrete action per step using the available tools\n` +
    `- Make real changes — read files, write code, run commands as needed\n` +
    `- After each tool use, write a concise status update (1-3 sentences)\n` +
    `- When the goal is fully achieved, end your response with exactly: [DONE]\n` +
    `- Do not include [DONE] unless the goal is actually complete\n` +
    `- Do not repeat actions already taken`
  );
}

/**
 * Execute a goal autonomously.
 *
 * @param {object}   goal              The goal object from goals.js
 * @param {object}   opts
 * @param {Function} opts.onStep       Called with step info after each step completes
 * @param {Function} opts.onDone       Called when execution finishes (completed or capped)
 * @param {Function} opts.onError      Called on unrecoverable error
 */
export async function executeGoal(goal, { onStep, onDone, onError }) {
  // Build an initial message thread for the executor
  const completedSummary = goal.steps.length > 0
    ? '\n\nPreviously completed steps:\n' + goal.steps.map((s, i) => `${i + 1}. ${s.summary}`).join('\n')
    : '';

  const messages = [
    { role: 'system', content: buildSystemPrompt(goal) },
    { role: 'user', content: `Begin.${completedSummary}` },
  ];

  let stepsDone = 0;
  let completed = false;

  try {
    for (let i = 0; i < MAX_STEPS; i++) {
      // ── LLM call with tools ────────────────────────────────────────────────
      const response = await chatCompletion(messages, { maxTokens: 1024, tools: TOOLS_SCHEMA });
      const text     = response.content ?? '';
      const toolCalls = response.tool_calls ?? [];

      // Push assistant turn into thread
      messages.push({
        role: 'assistant',
        content: text || null,
        ...(toolCalls.length ? { tool_calls: toolCalls } : {}),
      });

      // ── Execute tool calls ─────────────────────────────────────────────────
      const toolResults = [];
      for (const tc of toolCalls) {
        const name = tc.function.name;
        let args;
        try { args = JSON.parse(tc.function.arguments); } catch { args = {}; }

        const tool = TOOLS[name];
        let result;
        if (!tool) {
          result = `Unknown tool: ${name}`;
        } else {
          try {
            result = await tool.run(args);
          } catch (err) {
            result = `ERROR: ${err.message}`;
          }
        }

        toolResults.push({ tool: name, args, result });
        messages.push({
          role: 'tool',
          tool_call_id: tc.id,
          content: result.length > TOOL_RESULT_CAP
            ? result.slice(0, TOOL_RESULT_CAP) + '\n...[truncated]'
            : result,
        });
      }

      stepsDone++;
      completed = text.includes('[DONE]');

      // Persist step to goal record
      appendStep(goal.id, text, toolCalls.length);

      // Report step to caller
      onStep?.({
        index: stepsDone,
        summary: text.replace('[DONE]', '').trim(),
        toolResults,
        done: completed,
      });

      if (completed) break;

      // Prompt continuation
      messages.push({ role: 'user', content: 'Continue with the next action, or end with [DONE] if finished.' });
    }

    updateGoal(goal.id, { status: completed ? 'done' : 'active' });
    onDone?.({ steps: stepsDone, completed });
  } catch (err) {
    onError?.(err);
  }
}
