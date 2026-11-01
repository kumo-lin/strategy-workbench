/** Shared by playwright.config.ts, the server launcher and the specs. */
import path from 'node:path';

/** E2E_PORT lets two checkouts run the suite at the same time (the app on it, readiness on the next port). */
export const APP_PORT = Number(process.env.E2E_PORT ?? 4310);
/** Opened by start-server.ts once Next is warmed up; Playwright waits for this one, not for Next itself. */
export const READY_PORT = APP_PORT + 1;
export const BASE_URL = `http://127.0.0.1:${APP_PORT}`;

/** Where the snapshot is restored to. The real demo-vault/ is never touched. */
export const E2E_VAULT = path.resolve(process.cwd(), '.scratch/e2e-vault');
export const FIXTURES = path.resolve(process.cwd(), 'tests/fixtures');
