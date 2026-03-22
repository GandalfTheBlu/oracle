/**
 * Oracle Cross-Context Awareness
 *
 * Scans the environment each turn to build a compact situational summary:
 *   - Git status (branch + recent commits) for watched directories
 *   - Recently modified files in watched directories
 *   - Optional focus file (.oracle-focus) for explicit current-task signal
 *
 * The summary is injected into the system prompt so Oracle knows what the
 * user is working on without being told.
 *
 * Configured via config.json → contextAwareness.*
 * Cache: result is re-used for CACHE_TTL_MS to avoid scanning every turn.
 */

import { execSync } from 'child_process';
import { readdirSync, statSync, existsSync, readFileSync } from 'fs';
import { join, relative } from 'path';
import config from '../config.json' with { type: 'json' };

const cfg = config.contextAwareness ?? { enabled: false };

/** How long (ms) to reuse a scan result before rescanning. */
const CACHE_TTL_MS = 30_000;

let _cache = null;
let _cacheTime = 0;

// ── Git helpers ───────────────────────────────────────────────────────────────

function getGitInfo(dir) {
  if (!existsSync(join(dir, '.git'))) return null;
  try {
    const branch = execSync(`git -C "${dir}" branch --show-current`, {
      timeout: 3000, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();

    const log = execSync(
      `git -C "${dir}" log --oneline -3 --pretty=format:"%s (%cr)"`,
      { timeout: 3000, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] },
    ).trim();

    const commits = log.split('\n').filter(Boolean).slice(0, 3);
    const dirName = dir.replace(/\\/g, '/').split('/').pop();
    return `Git (${dirName}): branch=${branch || '(detached)'} | ${commits.join(' → ')}`;
  } catch {
    return null;
  }
}

// ── File recency helpers ──────────────────────────────────────────────────────

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.cache', 'data']);
const SKIP_EXTS = new Set(['.log', '.lock', '.json', '.map', '.bin', '.gguf']);

function walkRecent(dir, cutoffMs, maxDepth, results) {
  if (maxDepth <= 0) return;
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }

  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      walkRecent(full, cutoffMs, maxDepth - 1, results);
    } else if (entry.isFile()) {
      const ext = entry.name.slice(entry.name.lastIndexOf('.'));
      if (SKIP_EXTS.has(ext)) continue;
      try {
        const { mtimeMs } = statSync(full);
        if (mtimeMs >= cutoffMs) {
          results.push({ path: full, mtimeMs });
        }
      } catch { /* skip */ }
    }
  }
}

function formatAge(mtimeMs) {
  const diffMs = Date.now() - mtimeMs;
  const mins = Math.round(diffMs / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(diffMs / 3_600_000);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Build a compact situational context string for injection into the system prompt.
 * Returns '' when disabled or nothing interesting is found.
 * @returns {string}
 */
export function buildSituationalContext() {
  if (!cfg.enabled) return '';

  // Serve from cache if fresh.
  if (_cache !== null && Date.now() - _cacheTime < CACHE_TTL_MS) return _cache;

  const parts = [];
  const watchedDirs = cfg.watchedDirs ?? [];
  const recentHours = cfg.recentFileHours ?? 2;
  const maxFiles = cfg.maxRecentFiles ?? 5;

  // ── Git info ────────────────────────────────────────────────────────────────
  for (const dir of watchedDirs) {
    if (!existsSync(dir)) continue;
    const info = getGitInfo(dir);
    if (info) parts.push(info);
  }

  // ── Recently modified files ─────────────────────────────────────────────────
  const cutoffMs = Date.now() - recentHours * 3_600_000;
  const recent = [];
  for (const dir of watchedDirs) {
    if (!existsSync(dir)) continue;
    walkRecent(dir, cutoffMs, 3, recent);
  }
  recent.sort((a, b) => b.mtimeMs - a.mtimeMs);

  if (recent.length > 0) {
    // Show path relative to the watched dir where possible.
    const formatted = recent.slice(0, maxFiles).map(f => {
      let displayPath = f.path.replace(/\\/g, '/');
      for (const d of watchedDirs) {
        const norm = d.replace(/\\/g, '/');
        if (displayPath.startsWith(norm + '/')) {
          displayPath = displayPath.slice(norm.length + 1);
          break;
        }
      }
      return `${displayPath} (${formatAge(f.mtimeMs)})`;
    });
    parts.push(`Recent files: ${formatted.join(', ')}`);
  }

  // ── Focus file ──────────────────────────────────────────────────────────────
  if (cfg.focusFile && existsSync(cfg.focusFile)) {
    try {
      const focus = readFileSync(cfg.focusFile, 'utf8').trim().slice(0, 300);
      if (focus) parts.push(`Current focus: ${focus}`);
    } catch { /* skip */ }
  }

  if (parts.length === 0) {
    _cache = '';
    _cacheTime = Date.now();
    return '';
  }

  const now = new Date().toISOString().slice(0, 16).replace('T', ' ');
  const result = `\n\n[Current context — ${now} UTC]:\n` + parts.join('\n');

  _cache = result;
  _cacheTime = Date.now();
  return result;
}

/**
 * Invalidate the context cache (call after known file/git changes).
 */
export function invalidateSituationalContext() {
  _cache = null;
  _cacheTime = 0;
}
