/**
 * Thin client for the local LLM endpoint (OpenAI-compatible).
 */

import config from '../config.json' with { type: 'json' };

const { serverHost, port } = config.llm;
const BASE_URL = `http://${serverHost}:${port}`;

/**
 * Send a chat completion request to the local LLM.
 * @param {Array<{role: string, content: string}>} messages
 * @param {object} [opts]
 * @param {number} [opts.maxTokens]
 * @param {number} [opts.temperature]
 * @returns {Promise<string>} The assistant's reply text
 */
export async function chatCompletion(messages, opts = {}) {
  const { maxTokens = 512, temperature = 0.7 } = opts;

  const response = await fetch(`${BASE_URL}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'local',
      messages,
      max_tokens: maxTokens,
      temperature,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`LLM request failed (${response.status}): ${text}`);
  }

  const data = await response.json();
  return data.choices[0].message.content;
}

/**
 * Stream a chat completion from the local LLM.
 * Yields text delta tokens as they arrive.
 * @param {Array<{role: string, content: string}>} messages
 * @param {object} [opts]
 * @param {number} [opts.maxTokens]
 * @param {number} [opts.temperature]
 * @yields {string} token deltas
 */
export async function* chatCompletionStream(messages, opts = {}) {
  const { maxTokens = 1024, temperature = 0.7 } = opts;

  const response = await fetch(`${BASE_URL}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'local',
      messages,
      max_tokens: maxTokens,
      temperature,
      stream: true,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`LLM stream failed (${response.status}): ${text}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop(); // keep incomplete line

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const data = line.slice(6).trim();
      if (data === '[DONE]') return;
      try {
        const parsed = JSON.parse(data);
        const text = parsed.choices?.[0]?.delta?.content;
        if (text) yield text;
      } catch {
        // malformed SSE chunk — skip
      }
    }
  }
}
