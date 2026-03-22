/**
 * Oracle Tool Registry
 *
 * Tools are invoked via the OpenAI native function-calling API.
 * The LLM emits structured tool_calls; we execute them and inject
 * results as { role: 'tool' } messages.
 *
 * Each tool: { description, dangerous?, parameters, run(args) -> Promise<string> }
 *   dangerous: true | (args) => boolean — requires user approval before execution.
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
 * OpenAI function-calling schema for all tools.
 * Passed as the `tools` field in each API request — llama.cpp renders
 * them via the model's jinja template, no manual prompt injection needed.
 */
export const TOOLS_SCHEMA = [
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: 'Read a file from disk.',
      parameters: {
        type: 'object',
        properties: {
          path:   { type: 'string',  description: 'Absolute file path' },
          offset: { type: 'integer', description: 'Start line (0-based)' },
          limit:  { type: 'integer', description: 'Number of lines to read' },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'write_file',
      description: 'Write content to a file (creates or overwrites).',
      parameters: {
        type: 'object',
        properties: {
          path:    { type: 'string', description: 'Absolute file path' },
          content: { type: 'string', description: 'Full file content' },
        },
        required: ['path', 'content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'edit_file',
      description: 'Edit a file by replacing an exact string. Use for targeted changes to existing files.',
      parameters: {
        type: 'object',
        properties: {
          path:       { type: 'string', description: 'Absolute file path' },
          old_string: { type: 'string', description: 'Exact string to replace (must exist in file)' },
          new_string: { type: 'string', description: 'Replacement string' },
        },
        required: ['path', 'old_string', 'new_string'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'run_command',
      description: 'Run a PowerShell command and return stdout+stderr.',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'PowerShell command to run' },
          cwd:     { type: 'string', description: 'Working directory (optional)' },
        },
        required: ['command'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_regex',
      description: 'Search for a regex pattern in file names and contents under a directory.',
      parameters: {
        type: 'object',
        properties: {
          path:       { type: 'string',  description: 'Root directory to search' },
          pattern:    { type: 'string',  description: 'Regex pattern' },
          maxDepth:   { type: 'integer', description: 'Max directory depth (default 5, max 10)' },
          maxResults: { type: 'integer', description: 'Max results (default 50, max 200)' },
        },
        required: ['path', 'pattern'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'code_symbols',
      description: 'List functions, classes, and methods with line numbers in a JS/TS/Python source file.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Absolute path to source file' },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'web_fetch',
      description: 'Fetch a URL and save the content as plain text to a local file.',
      parameters: {
        type: 'object',
        properties: {
          url:  { type: 'string', description: 'URL to fetch' },
          path: { type: 'string', description: 'Local file path to save content' },
        },
        required: ['url', 'path'],
      },
    },
  },
];
