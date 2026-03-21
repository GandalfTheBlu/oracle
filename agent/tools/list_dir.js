import { readdirSync, statSync, existsSync } from 'fs';
import { join } from 'path';

const MAX_ENTRIES = 200;

export const listDir = {
  description: 'List directory contents. Args: { path: string, recursive?: boolean }',

  async run({ path, recursive = false }) {
    if (!path) throw new Error('path is required');
    if (!existsSync(path)) throw new Error(`Path not found: ${path}`);

    const entries = [];
    function walk(dir, depth = 0) {
      if (entries.length >= MAX_ENTRIES) return;
      const items = readdirSync(dir);
      for (const item of items) {
        if (entries.length >= MAX_ENTRIES) break;
        // Skip common noise directories
        if (['node_modules', '.git', '__pycache__', '.next', 'dist', 'build'].includes(item)) {
          entries.push('  '.repeat(depth) + item + '/ [skipped]');
          continue;
        }
        const full = join(dir, item);
        let isDir = false;
        try { isDir = statSync(full).isDirectory(); } catch {}
        entries.push('  '.repeat(depth) + item + (isDir ? '/' : ''));
        if (isDir && recursive) walk(full, depth + 1);
      }
    }

    walk(path);
    if (entries.length >= MAX_ENTRIES) entries.push(`... [truncated at ${MAX_ENTRIES} entries]`);
    return entries.join('\n') || '(empty directory)';
  },
};
