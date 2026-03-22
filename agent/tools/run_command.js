import { execSync } from 'child_process';
import { normalizePath } from './utils.js';

const MAX_OUTPUT = 16_000; // chars
const TIMEOUT_MS = 30_000;

/**
 * Commands that are always blocked regardless of approval.
 * Catastrophic / irreversible operations only.
 */
const BLOCKED = [
  /Remove-Item\s+.*-Recurse\s+-Force/i,
  /rm\s+-rf/i,
  /Format-Volume/i,
  /format\s+[a-z]:/i,
  /Stop-Computer/i,
  /Restart-Computer/i,
  /shutdown/i,
  /reboot/i,
];

/**
 * Safe command prefixes — run without user approval.
 * Covers both PowerShell native cmdlets and their Unix-style aliases.
 */
const SAFE_PREFIXES = [
  // Git read ops
  'git status', 'git log', 'git diff', 'git show', 'git branch',
  'git remote', 'git stash list', 'git tag', 'git describe',
  // Directory listing
  'ls', 'dir', 'get-childitem',
  // File reading
  'cat', 'type', 'get-content',
  'head', 'tail', 'select-object',
  // Search
  'grep', 'select-string', 'find',
  // Text / misc
  'echo', 'write-output', 'write-host',
  'pwd', 'get-location',
  'which', 'get-command', 'where',
  'wc', 'measure-object',
  'sort', 'sort-object',
  'diff', 'compare-object',
  // Runtime version checks (read-only)
  'node --version', 'node -v',
  'npm --version', 'npm -v', 'npm list',
  'python --version', 'python -v',
  'git --version',
];

/**
 * Determine the PowerShell executable to use.
 * Prefers pwsh (PowerShell Core); falls back to powershell (Windows PowerShell 5.1).
 */
function getShell() {
  try {
    execSync('pwsh -NoProfile -Command "exit 0"', { timeout: 3000, stdio: 'ignore' });
    return 'pwsh';
  } catch {
    return 'powershell';
  }
}

let _shell = null;
function shell() {
  if (!_shell) _shell = getShell();
  return _shell;
}

/**
 * Split a command string on chaining/pipe operators (;  &&  ||  |  &)
 * while respecting single- and double-quoted strings so that
 * `echo "hello; world"` is treated as one segment, not two.
 */
function splitSegments(cmd) {
  const segments = [];
  let current = '';
  let inSingle = false;
  let inDouble = false;

  for (let i = 0; i < cmd.length; i++) {
    const c = cmd[i];

    if (c === "'" && !inDouble) { inSingle = !inSingle; current += c; continue; }
    if (c === '"'  && !inSingle) { inDouble = !inDouble; current += c; continue; }

    if (!inSingle && !inDouble) {
      // Two-char operators first
      const two = cmd.slice(i, i + 2);
      if (two === '&&' || two === '||') {
        segments.push(current.trim());
        current = '';
        i++; // skip second char
        continue;
      }
      // Single-char operators
      if (c === ';' || c === '|' || c === '&') {
        segments.push(current.trim());
        current = '';
        continue;
      }
    }

    current += c;
  }

  if (current.trim()) segments.push(current.trim());
  return segments.filter(Boolean);
}

/**
 * Returns true if the command (or any chained/piped segment of it)
 * requires user approval.
 *
 * Also blocks PowerShell subexpression injection $(...) which can
 * embed arbitrary commands regardless of the outer prefix.
 */
function isDangerous(command) {
  const cmd = command.trim();

  // $(...) can execute arbitrary commands inside an otherwise safe call
  if (/\$\s*\(/.test(cmd)) return true;

  // Validate every chained/piped segment independently
  const segments = splitSegments(cmd);
  return segments.some(seg => {
    const normalized = seg.toLowerCase().trimStart();
    return !SAFE_PREFIXES.some(p => normalized.startsWith(p.toLowerCase()));
  });
}

export const runCommand = {
  description: 'Run a PowerShell command and return stdout+stderr. Args: { command: string, cwd?: string }',

  dangerous(args) {
    return isDangerous(args?.command ?? '');
  },

  async run({ command, cwd }) {
    if (!command) throw new Error('command is required');
    if (cwd) cwd = normalizePath(cwd);

    for (const pattern of BLOCKED) {
      if (pattern.test(command)) {
        throw new Error(`Command blocked by safety filter: ${command}`);
      }
    }

    const sh = shell();
    try {
      const output = execSync(command, {
        shell: sh,
        cwd: cwd || process.cwd(),
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
