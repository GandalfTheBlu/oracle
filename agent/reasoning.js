/**
 * Oracle Reasoning Module — multi-step internal scratchpad.
 *
 * Before generating the final reply, Oracle does an internal reasoning pass:
 * it thinks through the user's request, what it knows, and what would be the
 * best response strategy. This reasoning is NOT shown to the user.
 *
 * The resulting plan/insight is injected as context into the final reply call.
 */

import { chatCompletion } from './llm.js';

/**
 * Run an internal reasoning pass on the current situation.
 * Returns a compact reasoning summary to inject before the final response.
 *
 * @param {string} userMessage     The latest user message.
 * @param {string} systemPrompt    The full system prompt (with personality/memory).
 * @param {Array}  contextMessages Recent conversation context.
 * @returns {Promise<string>}      A brief internal reasoning note.
 */
export async function reason(userMessage, systemPrompt, contextMessages) {
  const reasoningMessages = [
    {
      role: 'system',
      content:
        systemPrompt +
        '\n\n[Internal reasoning mode]: You are thinking through your response privately before replying. ' +
        'Consider: What is the user really asking? What do you know that is relevant? ' +
        'What would be the most useful and honest response? Are there any caveats or things to push back on? ' +
        'If the task requires action (reading/editing files, running code, etc.), plan to do it with tools — do not describe how it could be done. ' +
        'Keep your reasoning concise (3-5 sentences). Do NOT write the actual reply yet — just think it through.',
    },
    ...contextMessages,
    {
      role: 'user',
      content: `[Think through how to respond to]: ${userMessage}`,
    },
  ];

  try {
    const reasoning = await chatCompletion(reasoningMessages, {
      maxTokens: 256,
      temperature: 0.4,
    });
    return reasoning.trim();
  } catch (err) {
    console.warn('[reasoning] Reasoning pass failed:', err.message);
    return '';
  }
}
