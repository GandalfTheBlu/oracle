/**
 * Oracle Tool Registry
 *
 * Tools are invoked when the LLM emits a directive in its response:
 *
 *   <tool name="read_file">
 *   <path>/some/file.js</path>
 *   </tool>
 *
 * Each child element is an arg. Values are free text — no JSON escaping needed.
 * Numeric/boolean strings are coerced automatically.
 *
 * The agent runner strips the directives, executes the tools, injects results,
 * and sends a follow-up completion to get the final reply.
 *
 * Each tool: { description, dangerous?, run(args) -> Promise<string> }
 *   dangerous: true | (args) => boolean — if set, requires user approval before execution.
 */

import { readFile } from './read_file.js';
import { writeFile } from './write_file.js';
import { editFile } from './edit_file.js';
import { runCommand } from './run_command.js';
import { searchRegex } from './search_regex.js';
import { codeSymbols } from './code_symbols.js';
import { webFetch } from './web_fetch.js';

/** Tool registry — name → tool definition. */
export const TOOLS = {
  read_file: readFile,
  write_file: writeFile,
  edit_file: editFile,
  run_command: runCommand,
  search_regex: searchRegex,
  code_symbols: codeSymbols,
  web_fetch: webFetch,
};

/**
 * Build the tool usage instructions injected into the system prompt.
 * @param {string[]} [toolNames]  If provided, only include these tools. Defaults to all.
 * @returns {string}
 */
export function buildToolsPrompt(toolNames) {
  const entries = toolNames
    ? Object.entries(TOOLS).filter(([name]) => toolNames.includes(name))
    : Object.entries(TOOLS);

  const argsList = entries
    .map(([name, t]) => `${name}: ${t.description}`)
    .join('\n');

  return `\n\n[Tools available — use them when the task genuinely requires it]:
Call a tool only if the task requires reading/writing files, running commands, searching code, or fetching URLs.
For pure conversation or conceptual/factual questions with no file/code/URL involved, respond directly without calling any tools.
Format (XML — element names are the exact parameter names from the Args list below):
<tool name="read_file">
<path>/some/file.txt</path>
<offset>0</offset>
</tool>
Args:
${argsList}
Rules: call tools immediately without preamble when needed; multiple calls allowed; for any URL/website always call web_fetch first. Never substitute a tool action with a description or code block — if the task requires writing a file, running a command, or fetching a URL, call the tool; do not show what you would do instead.`;
}

/** Coerce an XML text value to the appropriate JS primitive. */
function coerceArg(val) {
  if (val === 'true') return true;
  if (val === 'false') return false;
  const n = Number(val);
  if (!isNaN(n) && val.trim() !== '') return n;
  return val;
}

/**
 * Extract tool calls from an LLM response (XML format).
 * @param {string} text
 * @returns {Array<{name: string, args: object, raw: string}>}
 */
export function extractToolCalls(text) {
  const toolPattern = /<tool\s+name="([^"]+)">([\s\S]*?)<\/tool>/g;
  const calls = [];
  let toolMatch;
  while ((toolMatch = toolPattern.exec(text)) !== null) {
    const name = toolMatch[1].trim();
    if (!TOOLS[name]) continue;

    const body = toolMatch[2];
    const args = {};
    const argPattern = /<(\w+)>([\s\S]*?)<\/\1>/g;
    let argMatch;
    while ((argMatch = argPattern.exec(body)) !== null) {
      args[argMatch[1]] = coerceArg(argMatch[2].trim());
    }
    calls.push({ name, args, raw: toolMatch[0] });
  }
  return calls;
}

/**
 * Strip tool call tags from text (for the user-facing reply).
 * @param {string} text
 * @returns {string}
 */
export function stripToolCalls(text) {
  return text.replace(/<tool\s+name="[^"]*">[\s\S]*?<\/tool>/g, '').trim();
}

/**
 * Execute a list of tool calls and return formatted results + error list.
 * @param {Array<{name: string, args: object}>} calls
 * @returns {Promise<{output: string, errors: string[]}>}
 */
export async function executeToolCalls(calls) {
  const errors = [];
  const results = await Promise.all(
    calls.map(async ({ name, args }) => {
      const tool = TOOLS[name];
      try {
        const output = await tool.run(args);
        return `[tool: ${name}]\n${output}`;
      } catch (err) {
        errors.push(`${name}: ${err.message}`);
        return `[tool: ${name}] ERROR: ${err.message}`;
      }
    })
  );
  return { output: results.join('\n\n'), errors };
}
