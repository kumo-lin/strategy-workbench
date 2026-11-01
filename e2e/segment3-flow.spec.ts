/**
 * PRD §11.2 segment 3 as the demo now runs it (D-34 / D-36), on WS-B:
 *   1. Junior B's draft plan 「员工自带AI的程度」 shows what the team's perspective list says it left out (监管)
 *   2. Junior B adds a sub-question that ends up third under C2 (outside the small run), picks 监管 for it — the hint
 *      goes at once — and saves plan v2 with the perspective (and every other perspective field) kept
 *   3. WITHOUT approving, the Senior opens WS-A's report, drafts and confirms a "决定 + 理由"
 *   4. Junior B approves (= starts the small run); leaves the page while it runs and comes back: the run is re-attached
 *   5. the run's tool cards show it read the decision confirmed in step 3 (relates_to → 项目)
 *
 * Snapshot: e2e-vault-segment3 (WS-B as in the demo vault + WS-A's plan to make the report the Senior reads from).
 */
import { expect, test } from '@playwright/test';
import { runToDelivery } from './support/research';
import { apiPost, openAs, WS_A, WS_A_PATH, WS_B, WS_B_PATH, type RoleWindow } from './support/roles';
import { openSubQuestions } from './support/ui';
import { readVaultFile, resetVault, vaultFiles } from './support/vault';

const A_NAME = 'IT 可管理性';
const A_DIR = `${WS_A_PATH}/调查/${A_NAME}`;
const A_URL = `${WS_A}/research/${encodeURIComponent(A_NAME)}`;
const B_NAME = '员工自带AI的程度';
const B_DIR = `${WS_B_PATH}/调查/${B_NAME}`;
const B_URL = `${WS_B}/research/${encodeURIComponent(B_NAME)}`;
const DECISION_DIR = '20_项目/个人AI战略/决策';
const DECISION_FILE = 'WS-A 买方决定-先打IT管理场景.md';
const DECISION_TITLE = '先打IT管理场景';
const NEW_QUESTION = '员工自带的 AI 工具，有多少已经接到了工作系统、拿到了工作数据？';

test.describe.configure({ mode: 'serial' });

let junior: RoleWindow; // Junior B, the owner of WS-B
let juniorA: RoleWindow;
let senior: RoleWindow;

test.beforeAll(async ({ browser }) => {
  test.setTimeout(420_000);
  await resetVault('e2e-vault-segment3');
  junior = await openAs(browser, 'junior-b');
  juniorA = await openAs(browser, 'junior-a');
  senior = await openAs(browser, 'senior');

  // the report the Senior will read: WS-A's investigation, approved and run through the API as Junior A (as in m3-decision)
  const body = { workspacePath: WS_A_PATH, researchDir: A_DIR };
  const approve = await apiPost(juniorA, '/api/research/approve', body);
  expect(approve.ok(), await approve.text()).toBe(true);
  await runToDelivery(juniorA, { ...body, mode: 'small' });
});
test.afterAll(async () => {
  await Promise.all([junior?.context.close(), juniorA?.context.close(), senior?.context.close()]);
});

test('Junior B\'s draft plan is unapproved and says what the team\'s perspective list finds missing: 监管', async () => {
  const { page } = junior;
  await page.goto(B_URL);
  await expect(page.getByRole('heading', { name: '计划 v1' })).toBeVisible();
  await expect(page.getByText('调查工具还没开放')).toBeVisible(); // the plan is not approved
  const gaps = page.getByTestId('plan-perspective-gaps');
  await expect(gaps).toBeVisible();
  await expect(gaps).toContainText('漏了：监管');
  await expect(gaps).toContainText('这只是提醒，不影响批准');
  // 买方 is covered by the claims, the other three are skipped with a reason: only 监管 is neither
  await expect(page.getByTestId('plan-perspectives-skipped')).toContainText('竞争对手');
  await expect(page.getByTestId('plan-perspectives-skipped')).toContainText('技术供给');
  await expect(page.getByTestId('plan-perspectives-skipped')).toContainText('我方自身的布局');
  expect(await readVaultFile(`${B_DIR}/计划 v1.md`)).toContain('approved_by_owner: null');
});

test('Junior B adds a third sub-question under C2, picks 监管 for it and the hint goes at once; plan v2 keeps every perspective', async () => {
  const { page } = junior;
  const gaps = page.getByTestId('plan-perspective-gaps');
  await openSubQuestions(page, 1); // Q2 / H2 is the second hypothesis card
  await page.getByRole('button', { name: '为假设 H2 添加要查的问题' }).click();
  await page.getByLabel('要查的问题 Q2.3 的问法').fill(NEW_QUESTION);
  await expect(gaps).toContainText('漏了：监管'); // a question with no perspective covers nothing
  const pick = page.getByRole('button', { name: '要查的问题 Q2.3 视角：监管', exact: true });
  await pick.click();
  await expect(pick).toHaveAttribute('aria-pressed', 'true');
  await expect(gaps).toHaveCount(0); // before saving: the hint follows the click
  await page.getByRole('button', { name: '保存为新版本' }).click();
  await expect(page.getByText('已保存为 计划 v2')).toBeVisible();

  const v2 = await readVaultFile(`${B_DIR}/计划 v2.md`);
  expect(v2).toContain(NEW_QUESTION);
  expect(v2).toMatch(/id: C2-Q3[\s\S]*?perspective:\s*\n?\s*-?\s*\[?监管/);
  // the save keeps what the page did not touch: the other perspectives and the skip reasons (a dropped field once made
  // the reloaded v2 say "漏了：买方、竞争对手、我方自身的布局、监管、技术供给")
  expect(v2).toMatch(/id: C1\n[\s\S]*?perspective:\s*\n?\s*-?\s*\[?买方/);
  expect(v2).toMatch(/perspectives_skipped:[\s\S]*竞争对手/);
  expect(v2).toContain('approved_by_owner: null');
  expect(await readVaultFile(`${B_DIR}/计划 v1.md`)).not.toContain('C2-Q3'); // v1 is kept

  // what the page shows once it has 计划 v2 from the vault (not the editor's own copy): still nothing missing
  await page.reload();
  await expect(page.getByRole('heading', { name: '计划 v2' })).toBeVisible();
  await openSubQuestions(page, 1);
  await expect(page.getByRole('button', { name: '要查的问题 Q2.3 视角：监管', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('plan-perspectives-skipped')).toContainText('竞争对手');
  await expect(gaps).toHaveCount(0);
  // C2 now has three: the new one is last, and it is the one the small run (1 claim, 2 sub-questions) leaves out
  await expect(page.getByLabel(/^要查的问题 Q2\.\d 的问法$/)).toHaveCount(3);
  await expect(page.getByText('调查工具还没开放')).toBeVisible(); // still not approved
});

test('without approving the plan, the Senior opens WS-A\'s report, drafts a decision and confirms it', async () => {
  const { page } = senior;
  await page.goto(`${A_URL}?step=confirm`); // D-64 T41: the decision is step 6 (提交确认)
  await expect(page.getByTestId('decision-panel')).toBeVisible();
  const answered = page.waitForResponse((r) => r.url().endsWith('/api/decision/draft'));
  await page.getByTestId('decision-draft').click();
  expect((await answered).status()).toBe(200);

  const card = page.getByTestId('decision-card');
  await expect(card).toHaveAttribute('data-status', '推断');
  await expect(card).toContainText(DECISION_TITLE);
  await card.getByTestId('confirm-store').click();
  await expect(card).toHaveAttribute('data-status', '已确认');
  await expect(card).toContainText('Senior 确认');

  const note = await readVaultFile(`${DECISION_DIR}/${DECISION_FILE}`);
  expect(note).toMatch(/^status: 已确认$/m);
  expect(note).toMatch(/^decided_by: Senior$/m);
  expect(await readVaultFile(`${WS_A_PATH}/日志.md`)).toContain('event:decision.confirm');

  // meanwhile Junior B's plan has not moved: still v2, still not approved, no run, no report
  expect(await readVaultFile(`${B_DIR}/计划 v2.md`)).toContain('approved_by_owner: null');
  expect(await vaultFiles(B_DIR)).toEqual(expect.not.arrayContaining(['报告 v1.md']));
});

test('Junior B approves (= starts the small run), leaves the page while it runs, comes back: the run is still the same one and finishes', async () => {
  test.setTimeout(420_000);
  const { page } = junior;
  await page.goto(B_URL);
  await page.getByRole('button', { name: '计划定了，开始调查 →' }).click();
  await expect(page.getByRole('alertdialog')).toContainText('调查立即开始');
  await page.getByRole('button', { name: '确认批准' }).click();
  // approving starts the vault-only stage, which stops for the owner: 不够，上网查 continues into the small run
  await expect(page.getByText('计划已批准 · 调查工具已开放')).toBeVisible();
  expect(await readVaultFile(`${B_DIR}/计划 v2.md`)).toMatch(/approved_by_owner: Junior B/);

  // it is running: leave for another page and come back (a full page load: the browser's connection to the run is gone)
  await expect(page.getByTestId('run-start')).toHaveText('执行中…');
  await page.goto(WS_B);
  await expect(page.getByTestId('workspace-shell')).toBeVisible();
  await page.goto(B_URL);

  // the page re-attaches to the job on the server: the steps so far are replayed and the run ends with its result
  await expect(page.getByTestId('run-result')).toContainText('已交付 · 引用已自检', { timeout: 360_000 });
  const files = await vaultFiles(B_DIR);
  expect(files).toContain('报告 v1.md');
  expect(files).not.toContain('报告 v2.md'); // coming back did not start another run
  const log = await readVaultFile(`${WS_B_PATH}/日志.md`);
  expect(log.match(/research:start/g)).toHaveLength(1);
  expect(log.match(/research:done/g)).toHaveLength(1);

  // the small run stays in its budget: one claim, so C2 and its new third sub-question were not run
  const report = await readVaultFile(`${B_DIR}/报告 v1.md`);
  expect(report).toMatch(/计划之外的调整：[^\n]*H2 本次没有查（试水调查范围）/);
  expect(report).toMatch(/^report_format: question_tree$/m);
  expect(report).toMatch(/^## Q1 /m); // the tree's structure: a section per sub-question, the one not run is said to be
  expect(log).not.toMatch(/\[C2-Q\d\]/);
});

test('the run\'s tool cards show it read the decision the Senior confirmed meanwhile, found along relates_to', async () => {
  const { page } = junior;
  await page.getByRole('tab', { name: '执行' }).click();
  const card = page.locator('[data-testid="tool-card"][data-tool="vault_read"]').filter({ hasText: DECISION_TITLE });
  await expect(card).toHaveCount(1);
  await card.getByRole('button').first().click(); // expand: why it was read, and what it read
  await expect(card).toContainText('relates_to');
  await expect(card).toContainText('买方侧先验证 IT 管理场景');

  const log = await readVaultFile(`${WS_B_PATH}/日志.md`);
  expect(log).toMatch(/tool:vault_read[^\n]*决策\/WS-A 买方决定-先打IT管理场景/);
  // and the report says which confirmed decision it followed, with its words
  const line = (await readVaultFile(`${B_DIR}/报告 v1.md`)).split('\n').find((l) => l.includes('遵循的已确认决定')) ?? '';
  expect(line).toContain('买方侧先验证 IT 管理场景');
  expect(line).toContain('Senior 确认');
  expect(line).toMatch(/\[\[[^\]]*WS-A 买方决定-先打IT管理场景[^\]]*\]\]/);
});
