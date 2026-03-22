/**
 * Oracle Test Runner
 *
 * Starts the API server with an isolated data directory, runs unit tests then
 * integration tests, kills the server, and reports totals.
 *
 * Usage:
 *   node tests/run_tests.js                 # run all tests
 *   node tests/run_tests.js --unit-only     # skip integration
 *   node tests/run_tests.js --integration-only  # skip unit
 */

import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { rmSync, existsSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

const args = process.argv.slice(2);
const unitOnly        = args.includes('--unit-only');
const integrationOnly = args.includes('--integration-only');
const runUnit         = !integrationOnly;
const runIntegration  = !unitOnly;

// All isolated data dirs live inside .oracle/ so they're gitignored and
// co-located with the production workspace data.
const ORACLE_DIR    = join(ROOT, '.oracle');
const TEST_DATA_DIR = join(ORACLE_DIR, 'test');
const EVAL_DATA_DIR = join(ORACLE_DIR, 'eval');

const API_PORT = 3001; // tests
// Port 3002 reserved for Claude Code eval sessions (DATA_DIR=EVAL_DATA_DIR)

function log(msg) { console.log(`\x1b[36m[runner]\x1b[0m ${msg}`); }
function err(msg) { console.error(`\x1b[31m[runner]\x1b[0m ${msg}`); }

// ── Server lifecycle ──────────────────────────────────────────────────────────

function startServer() {
  return new Promise((resolve, reject) => {
    log(`Starting test server on port ${API_PORT} with DATA_DIR=${TEST_DATA_DIR}`);

    const child = spawn('node', ['api/server.js'], {
      cwd: ROOT,
      env: {
        ...process.env,
        DATA_DIR: TEST_DATA_DIR,
        PORT: String(API_PORT),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let ready = false;

    child.stdout.on('data', (data) => {
      const line = data.toString().trim();
      if (line) log(`server: ${line}`);
      if (!ready && line.includes('Oracle API running')) {
        ready = true;
        resolve(child);
      }
    });

    child.stderr.on('data', (data) => {
      const line = data.toString().trim();
      if (line) log(`server stderr: ${line}`);
    });

    child.on('error', reject);
    child.on('exit', (code) => {
      if (!ready) reject(new Error(`Server exited with code ${code} before becoming ready`));
    });

    // Hard timeout
    setTimeout(() => {
      if (!ready) {
        child.kill();
        reject(new Error('Server did not start within 30s'));
      }
    }, 30_000);
  });
}

async function waitForServer(port, maxMs = 30_000) {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://localhost:${port}/health`);
      if (res.ok) return;
    } catch {}
    await new Promise(r => setTimeout(r, 500));
  }
  throw new Error(`Server on port ${port} did not respond within ${maxMs}ms`);
}

// ── Script runner ─────────────────────────────────────────────────────────────

function runScript(scriptPath, env = {}) {
  return new Promise((resolve) => {
    const child = spawn('node', [scriptPath], {
      cwd: ROOT,
      env: { ...process.env, ...env },
      stdio: 'inherit',
    });
    child.on('exit', (code) => resolve(code ?? 1));
  });
}

// ── Cleanup ───────────────────────────────────────────────────────────────────

function cleanupTestData() {
  if (existsSync(TEST_DATA_DIR)) {
    try {
      rmSync(TEST_DATA_DIR, { recursive: true, force: true });
      log('Cleaned up test data directory.');
    } catch (e) {
      err(`Could not clean up ${TEST_DATA_DIR}: ${e.message}`);
    }
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

console.log('\n' + '═'.repeat(60));
console.log('  Oracle Test Suite');
console.log('═'.repeat(60));

let unitCode = 0;
let integrationCode = 0;
let serverProcess = null;

try {
  // Unit tests don't need the server
  if (runUnit) {
    console.log('\n' + '─'.repeat(60));
    console.log('  UNIT TESTS');
    console.log('─'.repeat(60));
    unitCode = await runScript(join(__dirname, 'test_unit.js'));
  }

  // Integration tests need a running server
  if (runIntegration) {
    console.log('\n' + '─'.repeat(60));
    console.log('  INTEGRATION TESTS');
    console.log('─'.repeat(60));

    // Check if a test server is already running on the port
    let serverAlreadyRunning = false;
    try {
      const res = await fetch(`http://localhost:${API_PORT}/health`);
      if (res.ok) {
        serverAlreadyRunning = true;
        log(`Server already running on port ${API_PORT} — reusing.`);
      }
    } catch {}

    if (!serverAlreadyRunning) {
      serverProcess = await startServer();
      await waitForServer(API_PORT);
      log('Server is ready.');
    }

    integrationCode = await runScript(join(__dirname, 'test_integration.js'), {
      ORACLE_API: `http://localhost:${API_PORT}`,
    });
  }
} finally {
  if (serverProcess) {
    log('Shutting down test server...');
    serverProcess.kill();
  }
  cleanupTestData();
}

// ── Final summary ─────────────────────────────────────────────────────────────

console.log('\n' + '═'.repeat(60));
const allPassed = unitCode === 0 && integrationCode === 0;

if (runUnit) {
  console.log(`  Unit tests:        ${unitCode === 0 ? '\x1b[32mPASSED\x1b[0m' : '\x1b[31mFAILED\x1b[0m'}`);
}
if (runIntegration) {
  console.log(`  Integration tests: ${integrationCode === 0 ? '\x1b[32mPASSED\x1b[0m' : '\x1b[31mFAILED\x1b[0m'}`);
}
console.log('═'.repeat(60) + '\n');

process.exit(allPassed ? 0 : 1);
