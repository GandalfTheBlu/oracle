/**
 * Oracle Reflection Module — post-reply self-validation pass.
 *
 * After generating a reply, runs a lightweight LLM check:
 *   - Does the reply actually answer the user's question?
 *   - Does the reply correctly reflect what the tools returned?
 *   - Is there a critical gap or contradiction?
 *
 * If an issue is found, returns a corrected reply.
 * If the reply is fine, returns null (original reply is used).
 *
 * Configured via config.json → reflection.enabled / reflection.onToolsOnly
 */

import config from '../config.json' with { type: 'json' };

const cfg = config.reflection ?? { enabled: true, onToolsOnly: true };

/**
 * Run a reflection pass on a completed reply.
 *
 * @param {string}        userMessage   The user's original message.
 * @param {string}        reply         The reply Oracle is about to send.
 * @param {Array|null}    toolActivity  [{tool, args, result}] from this turn, or null.
 * @param {Function}      llmCall       chatCompletion reference.
 * @returns {Promise<string|null>}      Corrected reply, or null if reply is fine.
 */
export async function reflect(userMessage, reply, toolActivity, llmCall) {
  if (!cfg.enabled) return null;
  if (cfg.onToolsOnly && (!toolActivity?.length)) return null;

  // Build a compact tool summary (cap each result to avoid blowing the context).
  const toolSummary = toolActivity?.length
    ? toolActivity.map(t => {
        const result = (t.result ?? '').slice(0, 300);
        const truncated = (t.result?.length ?? 0) > 300 ? '...[truncated]' : '';
        return `Tool: ${t.tool}\nResult: ${result}${truncated}`;
      }).join('\n\n')
    : null;

  const userContent =
    `User asked: ${userMessage}\n\n` +
    (toolSummary ? `Tool results:\n${toolSummary}\n\n` : '') +
    `Proposed reply:\n${reply}`;

  const messages = [
    {
      role: 'system',
      content:
        'You are a reply validator. Check if the proposed reply is correct and complete.\n\n' +
        'Check for:\n' +
        '1. Does the reply actually answer the user\'s question?\n' +
        '2. If tools were used, does the reply correctly reflect what the tools returned? ' +
           '(e.g. tool read a file — does reply quote the right content? ' +
           'tool reported an error — does reply acknowledge it?)\n' +
        '3. Is there a significant gap, contradiction, or mistake?\n\n' +
        'Minor style issues or alternative phrasings are NOT issues.\n\n' +
        'If the reply is acceptable, output exactly: {"ok":true}\n' +
        'If there is a real problem, output: {"ok":false,"issue":"one-line description","correction":"corrected reply text"}\n' +
        'Output ONLY valid JSON — no explanation, no markdown.',
    },
    { role: 'user', content: userContent },
  ];

  try {
    const raw = await llmCall(messages, { maxTokens: 256, temperature: 0.1 });
    const cleaned = (typeof raw === 'string' ? raw : raw.content ?? '')
      .replace(/```[a-z]*\n?/gi, '')
      .trim();

    const parsed = JSON.parse(cleaned);
    if (parsed.ok === false && typeof parsed.correction === 'string' && parsed.correction.trim()) {
      console.log(`[reflection] Correction applied: ${parsed.issue}`);
      return parsed.correction.trim();
    }
    console.log('[reflection] Reply validated OK.');
  } catch {
    // Parse error or LLM failure — skip silently, original reply stands.
    console.log('[reflection] Validation skipped (parse error or LLM failure).');
  }

  return null;
}
