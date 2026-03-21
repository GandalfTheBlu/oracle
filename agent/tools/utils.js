/**
 * Shared utilities for Oracle tools.
 */

/**
 * Normalize a path for use with Node's fs module on Windows.
 * Converts bash-style Git Bash paths to Windows paths:
 *   /c/foo/bar  →  C:/foo/bar
 *   /mnt/c/foo  →  C:/foo
 * Leaves already-valid Windows paths (C:\foo, C:/foo) untouched.
 * @param {string} p
 * @returns {string}
 */
export function normalizePath(p) {
  if (!p || typeof p !== 'string') return p;

  // /mnt/c/... (WSL style)
  const wsl = p.match(/^\/mnt\/([a-z])(\/.*)?$/i);
  if (wsl) return `${wsl[1].toUpperCase()}:${(wsl[2] || '/').replace(/\//g, '/')}`;

  // /c/... (Git Bash style)
  const gitbash = p.match(/^\/([a-z])(\/.*)?$/i);
  if (gitbash) return `${gitbash[1].toUpperCase()}:${(gitbash[2] || '/')}`;

  return p;
}
