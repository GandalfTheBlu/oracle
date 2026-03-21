import { execSync } from 'child_process';

const MAX_OUTPUT = 16_000;

export const searchFiles = {
  description: 'Search for a pattern in files. Args: { pattern: string, path?: string, glob?: string }',

  async run({ pattern, path = '.', glob }) {
    if (!pattern) throw new Error('pattern is required');

    // Use grep (available in Git Bash on Windows)
    const globFlag = glob ? `--include="${glob}"` : '';
    const cmd = `grep -rn ${globFlag} --exclude-dir=node_modules --exclude-dir=.git -l "${pattern}" "${path}" 2>/dev/null || true`;

    try {
      const files = execSync(cmd, { encoding: 'utf8', timeout: 15_000 }).trim();
      if (!files) return `No matches found for: ${pattern}`;

      // For each matching file, get the matching lines (limit output)
      const fileList = files.split('\n').slice(0, 20);
      const results = [];
      for (const f of fileList) {
        try {
          const lines = execSync(
            `grep -n "${pattern}" "${f}" 2>/dev/null`,
            { encoding: 'utf8', timeout: 5_000 }
          ).trim();
          results.push(`${f}:\n${lines}`);
        } catch {}
      }
      const output = results.join('\n\n');
      return output.slice(0, MAX_OUTPUT) || `Files matched: ${fileList.join(', ')}`;
    } catch (err) {
      throw new Error(`Search failed: ${err.message}`);
    }
  },
};
