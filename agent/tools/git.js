import { execSync } from 'child_process';
import { normalizePath } from './utils.js';

const MAX_OUTPUT = 16_000;
const TIMEOUT_MS = 30_000;

/** Git operations that are safe to run without extra confirmation. */
const READ_OPS = ['status', 'log', 'diff', 'show', 'branch', 'remote', 'stash list', 'tag'];

/** Git operations that modify state — allowed but logged. */
const WRITE_OPS = ['add', 'commit', 'checkout', 'switch', 'restore', 'reset', 'stash', 'merge', 'rebase', 'pull', 'push', 'init'];

/** Always blocked. */
const BLOCKED_OPS = ['push --force', 'push -f', 'reset --hard HEAD~', 'clean -f'];

export const git = {
  description: 'Run a git command. Args: { op: string, args?: string, cwd?: string }. op is the git subcommand (e.g. "status", "log --oneline -10", "diff HEAD~1")',

  async run({ op, args = '', cwd }) {
    if (!op) throw new Error('op is required (e.g. "status", "log --oneline")');

    const fullOp = `${op} ${args}`.trim();

    for (const blocked of BLOCKED_OPS) {
      if (fullOp.includes(blocked)) {
        throw new Error(`Git operation blocked: git ${fullOp}`);
      }
    }

    const workdir = cwd ? normalizePath(cwd) : process.cwd();
    const cmd = `git ${fullOp}`;

    try {
      const output = execSync(cmd, {
        cwd: workdir,
        timeout: TIMEOUT_MS,
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      return (output || '(no output)').slice(0, MAX_OUTPUT);
    } catch (err) {
      const combined = [err.stdout, err.stderr].filter(Boolean).join('\n').slice(0, MAX_OUTPUT);
      return `Exit ${err.status ?? '?'}: ${combined || err.message}`;
    }
  },
};
