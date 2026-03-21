import { writeFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';

export const writeFile = {
  description: 'Write content to a file (creates or overwrites). Args: { path: string, content: string }',

  async run({ path, content }) {
    if (!path) throw new Error('path is required');
    if (content === undefined || content === null) throw new Error('content is required');

    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content, 'utf8');
    return `Written ${Buffer.byteLength(content)} bytes to ${path}`;
  },
};
