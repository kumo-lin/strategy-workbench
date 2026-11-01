/**
 * Launches the app for e2e. Playwright's webServer runs this, so every `pnpm test:e2e`:
 *   1. starts Next on the e2e port with the mock model (MODEL_MOCK=1) and mock web tools (WEB_TOOLS=mock) (never a real model, the
 *      Search API, or port 3000), VAULT_DIR pointing at a scratch copy;
 *   2. warms up every route, so no test pays for Next's on-demand compile (that made timings jump
 *      from 1s to 20s on a busy machine);
 *   3. restores the vault snapshot again, because the warm-up may have written to it;
 *   4. only then opens the readiness port that Playwright waits for.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:http';
import { APP_PORT, BASE_URL, E2E_VAULT, READY_PORT } from './env';
import { warmUp } from './warm-up';
import { resetVault } from './vault';

const env = { ...process.env, VAULT_DIR: E2E_VAULT, MODEL_MOCK: '1', MOCK_MODEL_DELAY_MS: '250', WEB_TOOLS: 'mock', NEXT_TELEMETRY_DISABLED: '1' };

/**
 * Runs `next dev` and starts it again if it dies without being asked to. On this 8 GB machine, with
 * several dev sessions running, the server was killed from outside a few times mid-run (no crash
 * message: a SIGKILL); without this every later request got ECONNREFUSED. The run in flight still
 * fails, and `retries` in playwright.config.ts re-runs it against the restarted server.
 */
function runNext(state: { stopping: boolean; restarts: number; child?: ChildProcess }) {
  // E2E_NEXT=start: the production server (run `next build` first), as the demo runs it
  const next = spawn('pnpm', ['exec', 'next', process.env.E2E_NEXT === 'start' ? 'start' : 'dev', '-p', String(APP_PORT), '-H', '127.0.0.1'], { stdio: 'inherit', env });
  state.child = next;
  next.on('exit', (code, signal) => {
    if (state.stopping) process.exit(code ?? 0);
    if (state.restarts++ >= 5) process.exit(code ?? 1);
    console.error(`[start-server] next dev exited (${signal ?? code}) — restarting (${state.restarts}/5)`);
    runNext(state);
  });
  return next;
}

async function main() {
  await resetVault();
  const state: { stopping: boolean; restarts: number; child?: ChildProcess } = { stopping: false, restarts: 0 };
  runNext(state);
  const stop = () => {
    state.stopping = true;
    state.child?.kill('SIGTERM');
  };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);

  await warmUp(BASE_URL);
  await resetVault();
  createServer((_req, res) => res.end('ready')).listen(READY_PORT, '127.0.0.1');
}

void main();
