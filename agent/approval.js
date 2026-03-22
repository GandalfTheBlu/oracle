/**
 * Tool execution approval gate.
 *
 * When the agent wants to run a dangerous tool, it calls requestApproval()
 * which returns a promise that resolves to true/false once the user responds.
 * The streaming endpoint emits a `approval_required` SSE event; the UI shows
 * Allow/Deny buttons that POST to /approve/:id to resolve the promise.
 *
 * Auto-denies after 5 minutes of no response.
 */

/** @type {Map<string, { resolve: Function, tool: string, args: object }>} */
const pending = new Map();

const TIMEOUT_MS = 5 * 60 * 1000;

/**
 * Register a pending approval and return the id + a promise that resolves
 * to true (approved) or false (denied/timed out).
 * @param {string} tool
 * @param {object} args
 * @returns {{ id: string, promise: Promise<boolean> }}
 */
export function requestApproval(tool, args) {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

  const promise = new Promise((resolve) => {
    const timer = setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        console.warn(`[approval] Request ${id} timed out — denying.`);
        resolve(false);
      }
    }, TIMEOUT_MS);

    pending.set(id, {
      resolve: (approved) => {
        clearTimeout(timer);
        resolve(approved);
      },
      tool,
      args,
    });
  });

  return { id, promise };
}

/**
 * Resolve a pending approval request.
 * @param {string} id
 * @param {boolean} approved
 * @returns {boolean} false if the id was not found
 */
export function resolveApproval(id, approved) {
  const entry = pending.get(id);
  if (!entry) return false;
  pending.delete(id);
  entry.resolve(approved);
  return true;
}
