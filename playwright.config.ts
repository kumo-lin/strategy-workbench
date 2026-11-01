import { defineConfig } from '@playwright/test';
import { BASE_URL, READY_PORT } from './e2e/support/env';

/**
 * Deterministic e2e (dev plan v0.7, D-15; a merge gate). The model and the web tools are mocks
 * (`MODEL_MOCK=1`, `WEB_TOOLS=mock`), the vault is a fresh copy of tests/fixtures/e2e-vault
 * in .scratch/, and the server has its own port: it never reuses whatever runs on 3000.
 * Specs share one server and one vault, so they run one at a time, each restoring its snapshot first.
 */
export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.ts',
  fullyParallel: false,
  workers: 1,
  // One retry (a serial group re-runs from its start): the dev server is killed from outside now and then on this
  // busy machine, and start-server.ts restarts it. A retried test shows up as "flaky" in the report, never as plain green.
  retries: 1,
  timeout: 360_000,
  // generous on purpose: the gate also runs on a busy machine (other dev sessions), where one render can take 10s+
  expect: { timeout: 45_000 },
  reporter: [['list']],
  use: { baseURL: BASE_URL, trace: 'retain-on-failure', actionTimeout: 30_000, navigationTimeout: 180_000 },
  webServer: [
    {
      command: 'pnpm exec tsx e2e/support/start-server.ts',
      url: `http://127.0.0.1:${READY_PORT}`,
      reuseExistingServer: false,
      // the warm-up compiles every route; with other dev sessions running that took over 3 minutes
      timeout: 600_000,
      stdout: 'pipe',
      stderr: 'pipe',
      gracefulShutdown: { signal: 'SIGTERM', timeout: 5_000 },
    },
  ],
});
