import { readdirSync, readFileSync, statSync, existsSync } from 'fs';
import { join, relative } from 'path';
import { normalizePath } from './utils.js';

const SKIP_DIRS = new Set(['node_modules', '.git', '__pycache__', '.next', 'dist', 'build']);
const MAX_DEPTH_CAP = 10;
const MAX_RESULTS_CAP = 200;
const MAX_FILE_BYTES = 512_000; // skip files larger than 512 KB

export const searchRegex = {
  description: 'Search for a regex pattern in file names and file contents under a directory. Args: { path: string, pattern: string, maxDepth?: number (default 5, max 10), maxResults?: number (default 50, max 200) }',

  async run({ path = '.', pattern, maxDepth = 5, maxResults = 50 }) {
    if (!pattern) throw new Error('pattern is required');
    path = normalizePath(path);
    if (!existsSync(path)) throw new Error(`Path not found: ${path}`);

    // Enforce hard caps
    maxDepth = Math.min(Math.max(1, maxDepth), MAX_DEPTH_CAP);
    maxResults = Math.min(Math.max(1, maxResults), MAX_RESULTS_CAP);

    let regex;
    try {
      regex = new RegExp(pattern, 'i');
    } catch {
      throw new Error(`Invalid regex: ${pattern}`);
    }

    const results = [];

    function walk(dir, depth) {
      if (results.length >= maxResults) return;
      if (depth > maxDepth) return;

      let entries;
      try { entries = readdirSync(dir); } catch { return; }

      for (const entry of entries) {
        if (results.length >= maxResults) break;
        if (SKIP_DIRS.has(entry)) continue;

        const full = join(dir, entry);
        const rel = relative(path, full);
        let isDir = false;
        try { isDir = statSync(full).isDirectory(); } catch { continue; }

        if (isDir) {
          // Match directory name
          if (regex.test(entry)) {
            results.push({ type: 'filename', path: rel + '/' });
          }
          walk(full, depth + 1);
        } else {
          // Match file name
          if (regex.test(entry)) {
            results.push({ type: 'filename', path: rel });
          }

          // Match file contents
          if (results.length < maxResults) {
            try {
              const stat = statSync(full);
              if (stat.size > MAX_FILE_BYTES) continue;
              const text = readFileSync(full, 'utf8');
              const lines = text.split('\n');
              for (let i = 0; i < lines.length && results.length < maxResults; i++) {
                if (regex.test(lines[i])) {
                  results.push({ type: 'content', path: rel, line: i + 1, text: lines[i].trim().slice(0, 200) });
                }
              }
            } catch {
              // binary or unreadable — skip
            }
          }
        }
      }
    }

    walk(path, 0);

    if (results.length === 0) return `No matches for: ${pattern}`;

    const lines = results.map(r => {
      if (r.type === 'filename') return `[name] ${r.path}`;
      return `[content] ${r.path}:${r.line}: ${r.text}`;
    });

    const header = `${results.length} match${results.length === 1 ? '' : 'es'}${results.length >= maxResults ? ' (limit reached)' : ''} for /${pattern}/`;
    return header + '\n' + lines.join('\n');
  },
};
