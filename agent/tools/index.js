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
import { git } from './git.js';

/** Tool registry — name → tool definition. */
export const TOOLS = {
  read_file: readFile,
  write_file: writeFile,
  run_command: runCommand,
  list_dir: listDir,
  search_files: searchFiles,
  git,
};

/** Keywords that suggest a tools-capable query. */
const TOOL_KEYWORDS = [
  'file', 'files', 'read', 'write', 'open', 'create', 'edit', 'directory', 'folder',
  'run', 'execute', 'command', 'shell', 'script', 'install',
  'git', 'commit', 'branch', 'diff', 'status', 'log',
  'search', 'find', 'grep', 'look for',
  'code', 'function', 'class', 'import', 'export', 'module',
  'list', 'show me', 'check',
];

/**
 * Returns true if the query likely needs tool use.
 * @param {string} query
 * @returns {boolean}
 */
export function queryNeedsTools(query) {
  const q = query.toLowerCase();
  return TOOL_KEYWORDS.some(kw => q.includes(kw));
}

/**
 * Build the tool usage instructions injected into the system prompt.
 * @returns {string}
 */
export function buildToolsPrompt() {
  const toolList = Object.keys(TOOLS).join(', ');
  const argsList = Object.entries(TOOLS)
    .map(([name, t]) => `${name}: ${t.description}`)
    .join('\n');

  return `\n\n[Tools]: To use a tool, emit: <tool>{"name":"NAME","args":{...}}</tool>
Tools: ${toolList}
Args: ${argsList}
Only use tools when needed. Multiple calls allowed per turn.`;
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
