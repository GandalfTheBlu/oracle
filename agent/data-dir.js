/**
 * Shared data directory resolver.
 *
 * All persistent data modules import getDataDir() from here so that
 * the data location can be overridden via the DATA_DIR environment
 * variable — primarily useful for test isolation.
 *
 * Usage:
 *   DATA_DIR=data/test node test-evolution.js
 */

import { join, isAbsolute } from 'path';
import { fileURLToPath } from 'url';

const ROOT = join(fileURLToPath(import.meta.url), '..', '..');

/**
 * Returns the absolute path to the data directory.
 * Defaults to <project-root>/data unless DATA_DIR is set.
 */
export function getDataDir() {
  const dir = process.env.DATA_DIR || 'data';
  return isAbsolute(dir) ? dir : join(ROOT, dir);
}
