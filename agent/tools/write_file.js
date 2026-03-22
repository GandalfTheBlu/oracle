import { writeFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import { normalizePath } from './utils.js';

export const writeFile = {
  description: 'Write content to a file (creates or overwrites). Args: { path: string, content: string }',
  dangerous: true,

  async run({ path, content }) {
    if (!path) throw new Error('path is required');
    if (content === undefined || content === null) throw new Error('content is required');
    path = normalizePath(path);

    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content, 'utf8');
    return `Written ${Buffer.byteLength(content)} bytes to ${path}`;
  },
};
