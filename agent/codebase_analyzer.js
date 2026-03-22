/**
 * Oracle Codebase Analyzer
 *
 * Analyzes source files incrementally to produce a living architecture
 * document (CODEBASE.md). Runs in the background; updates only changed
 * files between runs to stay within context limits.
 *
 * Two-pass strategy:
 *   Pass 1 — per-file micro-analysis (one LLM call per file, ~200 tokens)
 *             → purpose, key exports, imports, flagged issues
 *             Large files are split into overlapping chunks; chunk analyses
 *             are merged with a final LLM call.
 *   Pass 2 — synthesis (one LLM call for all micro-summaries combined)
 *             → architecture overview, data flow, cross-file relationships
 *
 * State is kept in memory between runs for incremental diffing.
 * Configured via config.json → codeAnalysis.*
 */

import { readFileSync, writeFileSync, readdirSync, statSync, existsSync, mkdirSync } from 'fs';
import { join, extname } from 'path';
import config from '../config.json' with { type: 'json' };

const cfg = config.codeAnalysis ?? { enabled: false };

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.cache', 'data', 'test-tmp', 'eval-tmp']);

/** Chars per chunk sent to per-chunk LLM call. Files larger than this are split. */
const CHUNK_SIZE = 5500;

/** Overlap between consecutive chunks to preserve context across boundaries. */
const CHUNK_OVERLAP = 500;

/** Max chars per micro-summary stored and sent to synthesis (~150 tokens). */
const SUMMARY_CAP = 600;

// ── Persistent state ──────────────────────────────────────────────────────────

/**
 * path → { mtime: number, summary: string, issues: string[] }
 * Persists across incremental runs within the same process lifetime.
 */
const _fileState = new Map();

let _analysisRunning = false;

// ── File collection ───────────────────────────────────────────────────────────

function collectFiles(dirs, extensions, maxFiles) {
  const files = [];
  const exts = new Set(extensions);

  function walk(dir, depth) {
    if (depth > 4 || files.length >= maxFiles * 2) return;
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }

    for (const entry of entries) {
      if (SKIP_DIRS.has(entry.name)) continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full, depth + 1);
      } else if (entry.isFile() && exts.has(extname(entry.name).toLowerCase())) {
        try {
          const { mtimeMs } = statSync(full);
          files.push({ path: full, mtimeMs });
        } catch { /* skip */ }
      }
    }
  }

  for (const dir of dirs) {
    if (existsSync(dir)) walk(dir, 0);
  }

  // Sort: recently modified first, then alphabetical
  files.sort((a, b) => b.mtimeMs - a.mtimeMs || a.path.localeCompare(b.path));
  return files.slice(0, maxFiles);
}

// ── Per-file analysis ─────────────────────────────────────────────────────────

const ANALYZE_SYSTEM =
  'Analyze this source file. Respond with four lines, exactly:\n' +
  'PURPOSE: one sentence describing what this file does\n' +
  'EXPORTS: comma-separated list of key functions/classes/constants exported (max 8)\n' +
  'IMPORTS: comma-separated list of key modules/files imported (max 6)\n' +
  'ISSUES: "none" OR a short description of any bugs, anti-patterns, or risks found\n\n' +
  'Keep each line under 120 chars. No extra text.';

function parseAnalysis(text) {
  const get = (label) => {
    const match = text.match(new RegExp(`^${label}:\\s*(.+)$`, 'mi'));
    return match ? match[1].trim() : '';
  };
  return {
    purpose: get('PURPOSE'),
    exports: get('EXPORTS'),
    imports: get('IMPORTS'),
    issues:  get('ISSUES'),
  };
}

/** Split content into overlapping chunks. Returns [content] if small enough. */
function makeChunks(content) {
  if (content.length <= CHUNK_SIZE) return [content];
  const chunks = [];
  let pos = 0;
  while (pos < content.length) {
    chunks.push(content.slice(pos, pos + CHUNK_SIZE));
    if (pos + CHUNK_SIZE >= content.length) break;
    pos += CHUNK_SIZE - CHUNK_OVERLAP;
  }
  return chunks;
}

async function analyzeFile(filePath, llmCall) {
  let content;
  try {
    content = readFileSync(filePath, 'utf8');
  } catch {
    return null;
  }

  const fileName = filePath.replace(/\\/g, '/').split('/').pop();
  const chunks = makeChunks(content);

  // ── Single-chunk path (most files) ──────────────────────────────────────────
  if (chunks.length === 1) {
    const raw = await llmCall(
      [
        { role: 'system', content: ANALYZE_SYSTEM },
        { role: 'user', content: `File: ${fileName}\n\n${chunks[0]}` },
      ],
      { maxTokens: 200, temperature: 0.1 },
    );
    const text = (typeof raw === 'string' ? raw : raw.content ?? '').trim();
    const { purpose, exports: exports_, imports: imports_, issues } = parseAnalysis(text);
    if (!purpose) return null;

    const summary =
      `**${fileName}**: ${purpose}` +
      (exports_ ? `\n  Exports: ${exports_}` : '') +
      (imports_ ? `\n  Uses: ${imports_}` : '');

    return {
      summary: summary.slice(0, SUMMARY_CAP),
      issues: (issues && issues.toLowerCase() !== 'none') ? [issues] : [],
    };
  }

  // ── Multi-chunk path (large files) ──────────────────────────────────────────
  console.log(`[analyzer] ${fileName} is large (${content.length} chars) — analyzing in ${chunks.length} chunks`);

  const chunkTexts = [];
  for (let i = 0; i < chunks.length; i++) {
    try {
      const raw = await llmCall(
        [
          { role: 'system', content: ANALYZE_SYSTEM },
          {
            role: 'user',
            content: `File: ${fileName} (chunk ${i + 1} of ${chunks.length})\n\n${chunks[i]}`,
          },
        ],
        { maxTokens: 200, temperature: 0.1 },
      );
      chunkTexts.push((typeof raw === 'string' ? raw : raw.content ?? '').trim());
    } catch (err) {
      console.warn(`[analyzer] Chunk ${i + 1}/${chunks.length} failed for ${fileName}: ${err.message}`);
    }
  }

  if (chunkTexts.length === 0) return null;

  // Merge chunk analyses into a single final analysis
  const mergeRaw = await llmCall(
    [
      {
        role: 'system',
        content:
          'Merge these per-chunk analyses of one file into a single final analysis.\n' +
          'Respond with four lines, exactly:\n' +
          'PURPOSE: one sentence describing what this file does\n' +
          'EXPORTS: comma-separated union of all exported functions/classes/constants (max 8)\n' +
          'IMPORTS: comma-separated union of all imported modules/files (max 6)\n' +
          'ISSUES: "none" OR comma-separated list of any bugs, anti-patterns, or risks found\n\n' +
          'Keep each line under 120 chars. No extra text.',
      },
      {
        role: 'user',
        content: `File: ${fileName}\n\nChunk analyses:\n\n${chunkTexts.join('\n\n---\n\n')}`,
      },
    ],
    { maxTokens: 200, temperature: 0.1 },
  );

  const mergedText = (typeof mergeRaw === 'string' ? mergeRaw : mergeRaw.content ?? '').trim();
  const { purpose, exports: exports_, imports: imports_, issues } = parseAnalysis(mergedText);
  if (!purpose) return null;

  const summary =
    `**${fileName}**: ${purpose}` +
    (exports_ ? `\n  Exports: ${exports_}` : '') +
    (imports_ ? `\n  Uses: ${imports_}` : '');

  return {
    summary: summary.slice(0, SUMMARY_CAP),
    issues: (issues && issues.toLowerCase() !== 'none') ? [issues] : [],
  };
}

// ── Synthesis pass ────────────────────────────────────────────────────────────

async function synthesize(fileEntries, llmCall) {
  // fileEntries: [{ path, summary }]
  const summaryBlock = fileEntries
    .map(f => f.summary)
    .join('\n\n');

  // Cap total input to leave room for response
  const capped = summaryBlock.slice(0, 5000);

  const raw = await llmCall(
    [
      {
        role: 'system',
        content:
          'You are analyzing a codebase. Based on the per-file summaries below, write:\n' +
          '1. A 2-3 sentence architecture overview (what is this system, how is it structured)\n' +
          '2. A bullet list of the key data/control flow paths (max 5 bullets)\n' +
          '3. A bullet list of the most important cross-file dependencies (max 5 bullets)\n\n' +
          'Be specific and use file names. Keep the whole response under 400 words.',
      },
      { role: 'user', content: `Per-file summaries:\n\n${capped}` },
    ],
    { maxTokens: 512, temperature: 0.2 },
  );

  return (typeof raw === 'string' ? raw : raw.content ?? '').trim();
}

// ── Markdown output ───────────────────────────────────────────────────────────

function renderMarkdown(fileEntries, architectureText, allIssues, analyzedCount, totalCount) {
  const now = new Date().toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
  const issueSection = allIssues.length > 0
    ? '\n## Potential Issues\n' + allIssues.map(i => `- ${i}`).join('\n') + '\n'
    : '\n## Potential Issues\n*None detected in this analysis pass.*\n';

  return [
    `# Codebase Analysis`,
    `*Updated: ${now} — ${analyzedCount} files re-analyzed, ${totalCount} total tracked*`,
    '',
    '## Architecture',
    architectureText,
    '',
    '## File Summaries',
    fileEntries.map(f => f.summary).join('\n\n'),
    '',
    issueSection,
  ].join('\n');
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Run a full (or incremental) analysis pass.
 *
 * @param {Function} llmCall     chatCompletion reference.
 * @param {Function} [onIssue]   Called with (issueText) for each issue found.
 *                               If omitted, issues are only written to CODEBASE.md.
 * @returns {Promise<{analyzed: number, issues: string[], outputPath: string}|null>}
 */
export async function runAnalysis(llmCall, onIssue) {
  if (!cfg.enabled) return null;
  if (_analysisRunning) {
    console.log('[analyzer] Run already in progress — skipping.');
    return null;
  }

  _analysisRunning = true;
  const startMs = Date.now();

  try {
    const dirs       = cfg.dirs ?? [];
    const extensions = cfg.extensions ?? ['.js'];
    const maxFiles   = cfg.maxFilesPerRun ?? 25;
    const outputPath = cfg.outputPath ?? 'CODEBASE.md';

    if (dirs.length === 0) return null;

    const files = collectFiles(dirs, extensions, maxFiles);
    if (files.length === 0) return null;

    // Determine which files need re-analysis (new or changed mtime)
    const toAnalyze = files.filter(f => {
      const prev = _fileState.get(f.path);
      return !prev || prev.mtime !== f.mtimeMs;
    });

    console.log(`[analyzer] ${files.length} files tracked, ${toAnalyze.length} need analysis.`);

    let analyzed = 0;
    for (const file of toAnalyze) {
      try {
        const result = await analyzeFile(file.path, llmCall);
        if (result) {
          _fileState.set(file.path, {
            mtime: file.mtimeMs,
            summary: result.summary,
            issues: result.issues,
          });
          analyzed++;
          if (result.issues.length > 0) {
            const fileName = file.path.replace(/\\/g, '/').split('/').pop();
            console.log(`[analyzer] Issue in ${fileName}: ${result.issues[0]}`);
          }
        }
      } catch (err) {
        console.warn(`[analyzer] Failed to analyze ${file.path}: ${err.message}`);
      }
    }

    // Collect all current state for synthesis
    const fileEntries = files
      .map(f => {
        const state = _fileState.get(f.path);
        if (!state) return null;
        return {
          path: f.path,
          summary: state.summary,
          issues: state.issues,
        };
      })
      .filter(Boolean);

    // Re-synthesize if anything changed (or first run)
    let architectureText = '';
    if (analyzed > 0 || !existsSync(outputPath)) {
      console.log('[analyzer] Running synthesis pass...');
      architectureText = await synthesize(fileEntries, llmCall);
    } else {
      // Extract existing architecture text from file to avoid redundant LLM call
      try {
        const existing = readFileSync(outputPath, 'utf8');
        const match = existing.match(/## Architecture\n([\s\S]*?)\n## File Summaries/);
        architectureText = match ? match[1].trim() : '';
      } catch { /* use empty */ }
    }

    // Collect all issues
    const allIssues = fileEntries.flatMap(f =>
      f.issues.map(issue => `**${f.path.replace(/\\/g, '/').split('/').pop()}**: ${issue}`)
    );

    // Write output
    const md = renderMarkdown(fileEntries, architectureText, allIssues, analyzed, fileEntries.length);
    const outputDir = outputPath.replace(/[/\\][^/\\]+$/, '');
    if (!existsSync(outputDir)) mkdirSync(outputDir, { recursive: true });
    writeFileSync(outputPath, md, 'utf8');

    const elapsedSecs = ((Date.now() - startMs) / 1000).toFixed(1);
    console.log(`[analyzer] Done in ${elapsedSecs}s → ${outputPath} (${allIssues.length} issues)`);

    // Surface new issues via proactive callback
    if (onIssue && allIssues.length > 0 && analyzed > 0) {
      // Only notify about issues in files that were just re-analyzed
      const newIssueFiles = new Set(
        toAnalyze
          .map(f => f.path)
          .filter(p => (_fileState.get(p)?.issues?.length ?? 0) > 0)
      );
      const newIssues = allIssues.filter(i => {
        const name = i.match(/\*\*(.+?)\*\*/)?.[1];
        return name && [...newIssueFiles].some(p => p.endsWith(name));
      });
      for (const issue of newIssues.slice(0, 3)) { // cap at 3 notifications
        onIssue(issue);
      }
    }

    return { analyzed, issues: allIssues, outputPath };
  } finally {
    _analysisRunning = false;
  }
}
