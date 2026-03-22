import { readFileSync, writeFileSync, existsSync, statSync } from 'fs';
import { normalizePath } from './utils.js';

export const editFile = {
  description: 'Edit a file by replacing an exact string. Args: { path: string, old_string: string, new_string: string }',
  dangerous: true,

  async run({ path, old_string, new_string }) {
    if (!path) throw new Error('path is required');
    if (old_string === undefined) throw new Error('old_string is required');
    if (new_string === undefined) throw new Error('new_string is required');

    path = normalizePath(path);
    if (!existsSync(path)) throw new Error(`File not found: ${path}`);
    if (statSync(path).isDirectory()) throw new Error(`${path} is a directory`);

    const content = readFileSync(path, 'utf8');

    const count = content.split(old_string).length - 1;
    if (count === 0) throw new Error(`old_string not found in ${path}`);
    if (count > 1) throw new Error(`old_string matches ${count} locations — make it more specific`);

    const updated = content.replace(old_string, new_string);
    writeFileSync(path, updated, 'utf8');
    return `Edited ${path} — replaced 1 occurrence.`;
  },
};
