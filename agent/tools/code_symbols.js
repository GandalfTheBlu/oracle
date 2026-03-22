/**
 * Code structure tool — lists symbols (functions, classes, methods, etc.)
 * in a source file with line numbers, using web-tree-sitter (pure WASM, no
 * native compilation required).
 *
 * Supported: .js .mjs .cjs .jsx  →  JavaScript grammar
 *            .ts .tsx             →  TypeScript grammars
 *            .py                  →  Python grammar
 */

import { readFileSync, existsSync, statSync } from 'fs';
import { extname } from 'path';
import { createRequire } from 'module';
import { normalizePath } from './utils.js';

const _require = createRequire(import.meta.url);
const { Parser, Language } = _require('web-tree-sitter');

// Map extension → WASM path resolver
const WASM_MAP = {
  '.js':  () => _require.resolve('tree-sitter-javascript/tree-sitter-javascript.wasm'),
  '.mjs': () => _require.resolve('tree-sitter-javascript/tree-sitter-javascript.wasm'),
  '.cjs': () => _require.resolve('tree-sitter-javascript/tree-sitter-javascript.wasm'),
  '.jsx': () => _require.resolve('tree-sitter-javascript/tree-sitter-javascript.wasm'),
  '.ts':  () => _require.resolve('tree-sitter-typescript/tree-sitter-typescript.wasm'),
  '.tsx': () => _require.resolve('tree-sitter-typescript/tree-sitter-tsx.wasm'),
  '.py':  () => _require.resolve('tree-sitter-python/tree-sitter-python.wasm'),
};

const MAX_SYMBOLS = 300;

// ── Parser init (once) ────────────────────────────────────────────────────────

let _ready = false;
const _langCache = new Map();

async function ensureReady() {
  if (_ready) return;
  await Parser.init({
    locateFile: (name) => _require.resolve(`web-tree-sitter/${name}`),
  });
  _ready = true;
}

async function getLanguage(ext) {
  if (_langCache.has(ext)) return _langCache.get(ext);
  const resolve = WASM_MAP[ext];
  if (!resolve) return null;
  const lang = await Language.load(resolve());
  _langCache.set(ext, lang);
  return lang;
}

// ── AST walkers ───────────────────────────────────────────────────────────────

function walkJS(node, symbols, depth = 0) {
  if (!node || symbols.length >= MAX_SYMBOLS) return;
  const t = node.type;

  if (t === 'function_declaration' || t === 'generator_function_declaration') {
    const name = node.childForFieldName('name');
    if (name) symbols.push({ kind: 'function', name: name.text, line: node.startPosition.row + 1, depth });
    return; // don't walk into function bodies
  }

  if (t === 'class_declaration') {
    const name = node.childForFieldName('name');
    if (name) {
      symbols.push({ kind: 'class', name: name.text, line: node.startPosition.row + 1, depth });
      const body = node.childForFieldName('body');
      if (body) for (const child of body.namedChildren) walkJS(child, symbols, depth + 1);
    }
    return;
  }

  if (t === 'method_definition') {
    const name = node.childForFieldName('name');
    if (name) symbols.push({ kind: 'method', name: name.text, line: node.startPosition.row + 1, depth });
    return;
  }

  if (t === 'variable_declarator') {
    const value = node.childForFieldName('value');
    const isFn = value && (value.type === 'arrow_function' || value.type === 'function_expression' || value.type === 'generator_function');
    if (isFn) {
      const name = node.childForFieldName('name');
      if (name) symbols.push({ kind: 'function', name: name.text, line: node.startPosition.row + 1, depth });
    }
    return;
  }

  // TypeScript extras
  if (t === 'interface_declaration') {
    const name = node.childForFieldName('name');
    if (name) symbols.push({ kind: 'interface', name: name.text, line: node.startPosition.row + 1, depth });
    return;
  }
  if (t === 'type_alias_declaration') {
    const name = node.childForFieldName('name');
    if (name) symbols.push({ kind: 'type', name: name.text, line: node.startPosition.row + 1, depth });
    return;
  }
  if (t === 'enum_declaration') {
    const name = node.childForFieldName('name');
    if (name) symbols.push({ kind: 'enum', name: name.text, line: node.startPosition.row + 1, depth });
    return;
  }

  // Containers — recurse
  if (
    t === 'program' || t === 'module' ||
    t === 'export_statement' ||
    t === 'variable_declaration' || t === 'lexical_declaration'
  ) {
    for (const child of node.namedChildren) walkJS(child, symbols, depth);
  }
}

function walkPython(node, symbols, depth = 0) {
  if (!node || symbols.length >= MAX_SYMBOLS) return;
  const t = node.type;

  if (t === 'function_definition') {
    const name = node.childForFieldName('name');
    if (name) symbols.push({ kind: 'function', name: name.text, line: node.startPosition.row + 1, depth });
    return;
  }

  if (t === 'class_definition') {
    const name = node.childForFieldName('name');
    if (name) {
      symbols.push({ kind: 'class', name: name.text, line: node.startPosition.row + 1, depth });
      const body = node.childForFieldName('body');
      if (body) for (const child of body.namedChildren) walkPython(child, symbols, depth + 1);
    }
    return;
  }

  if (t === 'decorated_definition') {
    const def = node.childForFieldName('definition');
    if (def) walkPython(def, symbols, depth);
    return;
  }

  if (t === 'module') {
    for (const child of node.namedChildren) walkPython(child, symbols, depth);
  }
}

// ── Tool definition ───────────────────────────────────────────────────────────

export const codeSymbols = {
  description: 'List symbols (functions, classes, methods, interfaces) in a source file with line numbers. Supports JS/TS/Python. Args: { path: string }',

  async run({ path }) {
    if (!path) throw new Error('path is required');
    path = normalizePath(path);
    if (!existsSync(path)) throw new Error(`File not found: ${path}`);
    if (statSync(path).isDirectory()) throw new Error(`${path} is a directory`);

    const ext = extname(path).toLowerCase();

    await ensureReady();
    const lang = await getLanguage(ext);
    if (!lang) {
      return `Unsupported file type: ${ext}. Supported: .js .mjs .jsx .ts .tsx .py`;
    }

    const source = readFileSync(path, 'utf8');
    const parser = new Parser();
    parser.setLanguage(lang);
    const tree = parser.parse(source);

    const symbols = [];
    const isPython = ext === '.py';
    if (isPython) walkPython(tree.rootNode, symbols);
    else walkJS(tree.rootNode, symbols);

    if (symbols.length === 0) {
      // No parseable top-level symbols (common with object-literal exports or
      // router-style call patterns). Fall back to raw file content so the model
      // can still reason about the file rather than concluding it is empty.
      const lineCount = source.split('\n').length;
      return `No top-level symbols detected in ${path} (${lineCount} lines). File content:\n\n${source}`;
    }

    const langName = isPython ? 'Python' : (ext === '.ts' || ext === '.tsx' ? 'TypeScript' : 'JavaScript');
    const lines = symbols.map(s => '  '.repeat(s.depth) + `${s.kind} ${s.name} [line ${s.line}]`);
    const header = `${symbols.length} symbol${symbols.length === 1 ? '' : 's'} in ${path} (${langName}):`;
    return header + '\n' + lines.join('\n');
  },
};
