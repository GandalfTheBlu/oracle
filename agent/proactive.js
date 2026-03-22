/**
 * Oracle Proactive Scheduler
 *
 * Runs a background interval to detect noteworthy changes in the environment:
 *   - New git commits in watched directories
 *   - Significant file activity in watched directories (configurable threshold)
 *
 * When a change is detected and the cooldown has elapsed, generates a short
 * natural observation via the LLM and calls onMessage(text) to surface it.
 *
 * Proactive messages are NOT added to conversation history — they're
 * informational prompts shown in the UI that the user may choose to respond to.
 *
 * Configured via config.json → proactive.*
 */

import { execSync } from 'child_process';
import { readdirSync, statSync, existsSync } from 'fs';
import { join } from 'path';
import config from '../config.json' with { type: 'json' };
import { invalidateSituationalContext } from './context_awareness.js';

const cfg = config.proactive ?? { enabled: false };
const awareCfg = config.contextAwareness ?? {};

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.cache', 'data']);
const SKIP_EXTS = new Set(['.log', '.lock', '.json', '.map', '.bin', '.gguf']);

// ── State ─────────────────────────────────────────────────────────────────────

/** dir → latest commit hash seen */
const _lastHashes = {};

/** Timestamp of the last check (ms). Files newer than this are "new". */
let _lastCheckTime = Date.now();

/** Timestamp of the last proactive message sent (ms). */
let _lastNotifyTime = 0;

let _intervalHandle = null;

// ── Git helpers ───────────────────────────────────────────────────────────────

function getLatestHash(dir) {
  try {
    return execSync(`git -C "${dir}" rev-parse HEAD`, {
      timeout: 3000, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
  } catch {
    return null;
  }
}

function getNewCommits(dir, sinceHash) {
  try {
    const log = execSync(
      `git -C "${dir}" log ${sinceHash}..HEAD --pretty=format:"%s" --no-merges`,
      { timeout: 3000, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] },
    ).trim();
    return log ? log.split('\n').filter(Boolean) : [];
  } catch {
    return [];
  }
}

// ── File helpers ──────────────────────────────────────────────────────────────

function countRecentFiles(dir, sinceMs, maxDepth) {
  if (maxDepth <= 0 || !existsSync(dir)) return 0;
  let count = 0;
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return 0; }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      count += countRecentFiles(full, sinceMs, maxDepth - 1);
    } else if (entry.isFile()) {
      const ext = entry.name.slice(entry.name.lastIndexOf('.'));
      if (SKIP_EXTS.has(ext)) continue;
      try {
        const { mtimeMs } = statSync(full);
        if (mtimeMs > sinceMs) count++;
      } catch { /* skip */ }
    }
  }
  return count;
}

// ── LLM message generation ────────────────────────────────────────────────────

async function generateMessage(changeSummary, llmCall) {
  try {
    const raw = await llmCall(
      [
        {
          role: 'system',
          content:
            'You are Oracle, a personal AI assistant. You are monitoring the user\'s environment ' +
            'and noticed a change. Write ONE short, natural observation (1-2 sentences max, under 30 words). ' +
            'Be conversational and specific — mention what actually changed. ' +
            'Do not start with "I noticed" or "I see". Do not ask multiple questions. ' +
            'Speak as if you just caught something out of the corner of your eye.',
        },
        { role: 'user', content: `Change detected: ${changeSummary}` },
      ],
      { maxTokens: 80, temperature: 0.7 },
    );
    const text = typeof raw === 'string' ? raw : (raw.content ?? '');
    return text.trim();
  } catch {
    // LLM unavailable — fall back to a plain summary
    return `[Proactive] ${changeSummary}`;
  }
}

// ── Detection pass ────────────────────────────────────────────────────────────

async function runCheck(llmCall, onMessage) {
  const intervalSecs = cfg.intervalSeconds ?? 60;
  const cooldownMs   = (cfg.cooldownMinutes ?? 5) * 60_000;
  const minFiles     = cfg.minFileChanges ?? 3;
  const watchedDirs  = awareCfg.watchedDirs ?? [];

  const now = Date.now();
  const sinceMs = _lastCheckTime;

  const changes = [];

  // ── Git check ───────────────────────────────────────────────────────────────
  if (cfg.watchGit !== false) {
    for (const dir of watchedDirs) {
      if (!existsSync(dir)) continue;
      const hash = getLatestHash(dir);
      if (!hash) continue;

      const prevHash = _lastHashes[dir];
      if (prevHash && hash !== prevHash) {
        const commits = getNewCommits(dir, prevHash);
        const dirName = dir.replace(/\\/g, '/').split('/').pop();
        if (commits.length === 1) {
          changes.push(`New commit in ${dirName}: "${commits[0]}"`);
        } else if (commits.length > 1) {
          changes.push(`${commits.length} new commits in ${dirName}: "${commits[0]}" and ${commits.length - 1} more`);
        }
      }
      _lastHashes[dir] = hash;
    }
  }

  // ── File activity check ─────────────────────────────────────────────────────
  if (cfg.watchFiles !== false) {
    let totalChanged = 0;
    for (const dir of watchedDirs) {
      totalChanged += countRecentFiles(dir, sinceMs, 3);
    }
    if (totalChanged >= minFiles) {
      changes.push(`${totalChanged} files modified across watched directories`);
    }
  }

  _lastCheckTime = now;

  if (changes.length === 0) return;

  // Respect cooldown.
  if (now - _lastNotifyTime < cooldownMs) {
    console.log(`[proactive] Change detected but cooldown active (${Math.round((cooldownMs - (now - _lastNotifyTime)) / 1000)}s remaining).`);
    return;
  }

  // Invalidate situational context so the next turn sees fresh state.
  invalidateSituationalContext();

  const summary = changes.join('; ');
  console.log(`[proactive] Generating message for: ${summary}`);

  const message = await generateMessage(summary, llmCall);
  if (message) {
    _lastNotifyTime = Date.now();
    onMessage(message);
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Start the proactive scheduler.
 * @param {Function} llmCall    chatCompletion reference for message generation.
 * @param {Function} onMessage  Called with (messageText) when something noteworthy happens.
 */
export function startScheduler(llmCall, onMessage) {
  if (!cfg.enabled) return;
  if (_intervalHandle) return; // already running

  const intervalMs = (cfg.intervalSeconds ?? 60) * 1000;

  // Seed initial git hashes without triggering any message.
  for (const dir of (awareCfg.watchedDirs ?? [])) {
    if (!existsSync(dir)) continue;
    const hash = getLatestHash(dir);
    if (hash) _lastHashes[dir] = hash;
  }
  _lastCheckTime = Date.now();

  _intervalHandle = setInterval(() => {
    runCheck(llmCall, onMessage).catch(err =>
      console.warn('[proactive] Check failed:', err.message)
    );
  }, intervalMs);

  // Keep interval from blocking process exit.
  if (_intervalHandle.unref) _intervalHandle.unref();

  console.log(`[proactive] Scheduler started (interval: ${intervalMs / 1000}s, cooldown: ${cfg.cooldownMinutes ?? 5}min).`);
}

/**
 * Stop the scheduler.
 */
export function stopScheduler() {
  if (_intervalHandle) {
    clearInterval(_intervalHandle);
    _intervalHandle = null;
    console.log('[proactive] Scheduler stopped.');
  }
}
