import { execSync } from 'child_process';

/** Commands/patterns that are always blocked. */
const BLOCKED = [
  /rm\s+-rf\s+\//,
  /format\s+[a-z]:/i,
  /del\s+\/[sf]/i,
  /shutdown/i,
  /reboot/i,
  /mkfs/,
  /dd\s+if=/,
];

const MAX_OUTPUT = 16_000; // chars
const TIMEOUT_MS = 30_000;

export const runCommand = {
  description: 'Run a shell command and return stdout+stderr. Args: { command: string, cwd?: string }',

  async run({ command, cwd }) {
    if (!command) throw new Error('command is required');

    for (const pattern of BLOCKED) {
      if (pattern.test(command)) {
        throw new Error(`Command blocked by safety filter: ${command}`);
      }
    }

    try {
      const output = execSync(command, {
        cwd: cwd || process.cwd(),
        timeout: TIMEOUT_MS,
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      const out = (output || '').slice(0, MAX_OUTPUT);
      return out || '(no output)';
    } catch (err) {
      // execSync throws on non-zero exit — return the stderr as the result
      const combined = [err.stdout, err.stderr].filter(Boolean).join('\n').slice(0, MAX_OUTPUT);
      return `Exit ${err.status ?? '?'}: ${combined || err.message}`;
    }
  },
};
