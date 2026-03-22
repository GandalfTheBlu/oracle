/**
 * Shared data directory resolver.
 *
 * Returns the active workspace's data directory.
 * In normal use this is <workspace>/.oracle/data/.
 * The DATA_DIR env var overrides this for test isolation.
 */

import workspace from './workspace.js';

/**
 * Returns the absolute path to the runtime data directory.
 */
export function getDataDir() {
  return workspace.dataDir;
}
