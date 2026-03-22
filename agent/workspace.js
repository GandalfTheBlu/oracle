/**
 * Oracle Workspace
 *
 * Discovers the active workspace directory and produces a merged config.
 * A workspace is identified by a .oracle/ directory, similar to how git
 * uses .git/. On first use, .oracle/ is created automatically.
 *
 * Discovery order:
 *   1. ORACLE_WORKSPACE env var — explicit path override
 *   2. .oracle/ found walking up from process.cwd()
 *   3. process.cwd() itself — .oracle/ is created here
 *
 * DATA_DIR env var bypasses workspace discovery entirely (test isolation).
 *
 * Workspace layout:
 *   <root>/
 *     .oracle/
 *       config.json   — workspace overrides (optional, deep-merged over global)
 *       data/         — all runtime data: memories, history, personality, etc.
 *       CODEBASE.md   — codebase analysis output
 *       focus         — optional current-task signal (plain text)
 */

import { existsSync, readFileSync, mkdirSync } from 'fs';
import { join, resolve } from 'path';
import globalConfig from '../config.json' with { type: 'json' };

const ORACLE_DIR = '.oracle';

// ── Workspace discovery ───────────────────────────────────────────────────────

function findWorkspaceRoot() {
  if (process.env.ORACLE_WORKSPACE) return resolve(process.env.ORACLE_WORKSPACE);

  // Walk up from CWD looking for an existing .oracle/ directory.
  let dir = resolve(process.cwd());
  while (true) {
    if (existsSync(join(dir, ORACLE_DIR))) return dir;
    const parent = resolve(dir, '..');
    if (parent === dir) break; // reached filesystem root
    dir = parent;
  }

  // No .oracle/ found — use CWD; it will be initialised below.
  return resolve(process.cwd());
}

// ── Config merging ────────────────────────────────────────────────────────────

function deepMerge(base, override) {
  const result = { ...base };
  for (const [key, val] of Object.entries(override)) {
    if (
      val !== null && typeof val === 'object' && !Array.isArray(val) &&
      base[key] !== null && typeof base[key] === 'object' && !Array.isArray(base[key])
    ) {
      result[key] = deepMerge(base[key], val);
    } else {
      result[key] = val;
    }
  }
  return result;
}

function loadWorkspaceConfig(oracleDir) {
  const cfgPath = join(oracleDir, 'config.json');
  if (!existsSync(cfgPath)) return {};
  try {
    return JSON.parse(readFileSync(cfgPath, 'utf8'));
  } catch {
    return {};
  }
}

// ── Initialisation ────────────────────────────────────────────────────────────

function buildWorkspace() {
  // DATA_DIR env var → test/legacy mode; skip workspace logic entirely.
  if (process.env.DATA_DIR) {
    const dataDir = resolve(process.env.DATA_DIR);
    return { root: resolve(process.cwd()), oracleDir: null, dataDir, config: globalConfig };
  }

  const root     = findWorkspaceRoot();
  const oracleDir = join(root, ORACLE_DIR);
  const dataDir  = join(oracleDir, 'data');

  // Ensure directory structure exists.
  mkdirSync(dataDir, { recursive: true });

  // Build workspace-specific defaults (paths derived from workspace root).
  const normRoot = root.replace(/\\/g, '/');
  const defaults = {
    contextAwareness: {
      watchedDirs: [normRoot],
      focusFile:   `${normRoot}/${ORACLE_DIR}/focus`,
    },
    codeAnalysis: {
      dirs:       [normRoot],
      outputPath: `${normRoot}/${ORACLE_DIR}/CODEBASE.md`,
    },
  };

  // Precedence: globalConfig < workspace defaults < workspace config.json
  const workspaceCfg = loadWorkspaceConfig(oracleDir);
  const config = deepMerge(deepMerge(globalConfig, defaults), workspaceCfg);

  return { root, oracleDir, dataDir, config };
}

// Singleton — computed once when the module is first imported.
const workspace = buildWorkspace();
export default workspace;
