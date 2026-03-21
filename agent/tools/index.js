/**
 * Oracle Tool Registry
 *
 * Tools are invoked when the LLM emits a special directive in its response:
 *
 *   <tool>{"name": "read_file", "args": {"path": "/some/file.js"}}</tool>
 *
 * The agent runner strips the directives, executes the tools, injects results,
 * and sends a follow-up completion to get the final reply.
 *
 * Each tool: { description, schema, run(args) -> Promise<string> }
 */

import { readFile } from './read_file.js';
import { writeFile } from './write_file.js';
import { runCommand } from './run_command.js';
import { listDir } from './list_dir.js';
import { searchFiles } from './search_files.js';

/** Tool registry — name → tool definition. */
export const TOOLS = {
  read_file: readFile,
  write_file: writeFile,
  run_command: runCommand,
  list_dir: listDir,
  search_files: searchFiles,
};

/**
 * Build the tool usage instructions injected into the system prompt.
 * Kept concise to save tokens.
 * @returns {string}
 */
export function buildToolsPrompt() {
  const toolList = Object.entries(TOOLS)
    .map(([name, t]) => `  - ${name}: ${t.description}`)
    .join('\n');

  return `\n\n[Tool use]:
When you need to read/write files, run commands, or search code, emit one or more tool calls embedded in your response:
<tool>{"name": "TOOL_NAME", "args": {ARGS_JSON}}</tool>
Available tools:
${toolList}
You may emit multiple tool calls. After tools run, you will receive results and should give a final response.
Only use tools when actually needed — do not use them for conversational replies.`;
}

/**
 * Extract tool calls from an LLM response.
 * @param {string} text
 * @returns {Array<{name: string, args: object, raw: string}>}
 */
export function extractToolCalls(text) {
  const pattern = /<tool>([\s\S]*?)<\/tool>/g;
  const calls = [];
  let match;
  while ((match = pattern.exec(text)) !== null) {
    try {
      const parsed = JSON.parse(match[1].trim());
      if (parsed.name && TOOLS[parsed.name]) {
        calls.push({ name: parsed.name, args: parsed.args || {}, raw: match[0] });
      }
    } catch {
      // malformed JSON — skip
    }
  }
  return calls;
}

/**
 * Strip tool call tags from text (for the user-facing reply).
 * @param {string} text
 * @returns {string}
 */
export function stripToolCalls(text) {
  return text.replace(/<tool>[\s\S]*?<\/tool>/g, '').trim();
}

/**
 * Execute a list of tool calls and return formatted results.
 * @param {Array<{name: string, args: object}>} calls
 * @returns {Promise<string>}  Formatted tool results block.
 */
export async function executeToolCalls(calls) {
  const results = await Promise.all(
    calls.map(async ({ name, args }) => {
      const tool = TOOLS[name];
      try {
        const output = await tool.run(args);
        return `[tool: ${name}]\n${output}`;
      } catch (err) {
        return `[tool: ${name}] ERROR: ${err.message}`;
      }
    })
  );
  return results.join('\n\n');
}
