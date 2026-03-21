import { readFileSync, existsSync, statSync } from 'fs';

const MAX_BYTES = 32_000; // ~8k tokens

export const readFile = {
  description: 'Read a file. Args: { path: string, offset?: number, limit?: number (lines) }',

  async run({ path, offset = 0, limit }) {
    if (!path) throw new Error('path is required');
    if (!existsSync(path)) throw new Error(`File not found: ${path}`);

    const stat = statSync(path);
    if (stat.isDirectory()) throw new Error(`${path} is a directory, not a file`);

    const raw = readFileSync(path, 'utf8');
    const lines = raw.split('\n');
    const sliced = limit !== undefined
      ? lines.slice(offset, offset + limit)
      : lines.slice(offset);

    const text = sliced.join('\n');
    if (Buffer.byteLength(text) > MAX_BYTES) {
      const truncated = text.slice(0, MAX_BYTES);
      return truncated + `\n... [truncated — ${lines.length} total lines, showing from line ${offset}]`;
    }
    return text;
  },
};
