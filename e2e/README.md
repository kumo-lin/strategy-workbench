# e2e

`pnpm test:e2e` runs Playwright against a real Next server whose model and web tools are mocks, on a
scratch copy of a fixed vault snapshot. Same result every run; no network, no keys, no port 3000.

- **Server**: `e2e/support/start-server.ts` (Playwright's `webServer`). `next dev` on port 4310 (readiness on 4311; away from the 3000–3202 that dev sessions use; `E2E_PORT=4330 pnpm test:e2e` picks another pair so two checkouts can run at once) with
  `MODEL_MOCK=1` (the provider and its label still come from 模型.md, so the pages follow `active`), `MOCK_MODEL_DELAY_MS=250` (each orchestrated model call waits a bit, so a run lasts seconds, not milliseconds: segment3-flow leaves the page while it runs), `WEB_TOOLS=mock`, `VAULT_DIR=.scratch/e2e-vault`; it warms up every route and
  restores the vault before Playwright is told the server is ready. Never reuses an existing server.
- **Vault**: `tests/fixtures/e2e-vault/` (base: WS-A and WS-B, both at 拆题中) and
  `tests/fixtures/e2e-vault-g1/` (overlay: WS-A after G1, workplan v1 approved, hypothesis WS-A-H1) and
  `tests/fixtures/e2e-vault-g1-plan/` (overlay: plus an unapproved plan v1 for the investigation 「IT 可管理性」).
  Each spec calls `resetVault(snapshot)` in `beforeAll`. `tests/testing/e2e-fixtures.test.ts` keeps all three valid.
- **Mock model** (`lib/testing/mock-model.ts`, loaded only when `MODEL_MOCK=1`): the chat agent is a
  fixed script per conversation (`mock-agent.ts`), the next step is derived from the tool calls made since the
  last user message; the orchestrated Deep Research steps are answered by recognising their prompts
  (`mock-research.ts`). Mock web pages (`mock-web.ts`) depend only on the query/URL.
- **Roles**: the `sw-role` cookie. `openAs(browser, 'senior')` gives a separate browser context per person.
- **Specs**: `m1-workplan.spec.ts` (PRD §11.2 step 3, workplan → G1 → comment → v2),
  `m2-research.spec.ts` (grill → plan → approve → run → report),
  `m4-compare.spec.ts` (plain mode → compare page with the 6-row table → switching `active` in 模型.md changes the model shown).
  `m3-decision.spec.ts` (Senior drafts and confirms a decision; Juniors get 403; Junior B's next investigation finds only the confirmed one),
  `m3-decision-models.spec.ts` (switching `active` in 模型.md and drafting again: both drafts side by side, each with its model),
  `question-tree-approval.spec.ts` (D-39: a plan whose question tree fails its checks is not approved and the reasons are listed; an older-format plan is not checked),
  `question-tree-split.spec.ts` (D-39: a full and a small run on a split tree, Q1 unsplit and Q2 → Q2-1 / Q2-2: every level of the report),
  `demo-flow.spec.ts` (the demo in the order of PRD D-44, snapshot `e2e-vault-demo`: project page = step 0 → WS-A steps 1–7 → step 8 hands over to WS-B: add 监管, approve a 试水调查, its step 2 shows the decision just confirmed; also the web address deciding the role: `senior.localhost` / `junior-b.localhost`).

Iterating on a spec: `pnpm test:e2e e2e/m1-workplan.spec.ts`. Failure traces: `pnpm exec playwright show-trace test-results/<test>/trace.zip`.
First time on a machine: `pnpm exec playwright install chromium`.
