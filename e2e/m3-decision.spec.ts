/**
 * PRD §11.2 step 3, the Senior part (M3): after the report is delivered the Senior drafts a "决定 + 理由"
 * with the AI, edits it and confirms; a Junior cannot draft or confirm (403); the decision is found by
 * Junior B's next investigation (as a tool card, and in the report) only once it is 已确认 — never while it is 推断.
 *
 * Setup is done through the API as the owner: a delivered team report on WS-A (as in the M4 spec).
 */
import { expect, test } from '@playwright/test';
import { answerQuestion, attemptName } from './support/ui';
import { runToDelivery } from './support/research';
import { apiPost, openAs, WS_A, WS_A_PATH, WS_B, WS_B_PATH, type RoleWindow } from './support/roles';
import { readVaultFile, resetVault, vaultFiles } from './support/vault';

const NAME = 'IT 可管理性';
const RESEARCH_DIR = `${WS_A_PATH}/调查/${NAME}`;
const REPORT_PATH = `${RESEARCH_DIR}/报告 v1.md`;
const RESEARCH_URL = `${WS_A}/research/${encodeURIComponent(NAME)}`;
const DECISION_DIR = '20_项目/个人AI战略/决策';
const DECISION_FILE = 'WS-A 买方决定-先打IT管理场景.md';
const DECISION_PATH = `${DECISION_DIR}/${DECISION_FILE}`;
const DECISION_TITLE = '先打IT管理场景';

// set per attempt in beforeAll (see attemptName)
let B_NAME = '员工自带AI';
let B_DIR = `${WS_B_PATH}/调查/${B_NAME}`;
let B_URL = `${WS_B}/research/${encodeURIComponent(B_NAME)}`;

test.describe.configure({ mode: 'serial' });

let junior: RoleWindow;
let senior: RoleWindow;
let juniorB: RoleWindow;

test.beforeAll(async ({ browser }) => {
  B_NAME = attemptName('员工自带AI', test.info().retry);
  B_DIR = `${WS_B_PATH}/调查/${B_NAME}`;
  B_URL = `${WS_B}/research/${encodeURIComponent(B_NAME)}`;
  test.setTimeout(420_000);
  await resetVault('e2e-vault-g1-plan');
  junior = await openAs(browser, 'junior-a');
  senior = await openAs(browser, 'senior');
  juniorB = await openAs(browser, 'junior-b');

  // a delivered team report on WS-A (approve the snapshot's plan v1, run), driven through the API as Junior A
  const body = { workspacePath: WS_A_PATH, researchDir: RESEARCH_DIR };
  const approve = await apiPost(junior, '/api/research/approve', body);
  expect(approve.ok(), await approve.text()).toBe(true);
  await runToDelivery(junior, { ...body, mode: 'small' });
});
test.afterAll(async () => {
  await Promise.all([junior?.context.close(), senior?.context.close(), juniorB?.context.close()]);
});

const post = apiPost;

test('only a Senior sees "起草决定", and a Junior who calls the draft endpoint is refused (403)', async () => {
  for (const who of [junior, juniorB]) {
    await who.page.goto(RESEARCH_URL);
    await expect(who.page.getByTestId('citation-chip').first()).toBeVisible(); // the report is there
    await expect(who.page.getByTestId('decision-panel')).toHaveCount(0);
    const res = await post(who, '/api/decision/draft', { workspacePath: WS_A_PATH, researchDir: RESEARCH_DIR, reportPath: REPORT_PATH });
    expect(res.status()).toBe(403);
  }
  expect(await vaultFiles(DECISION_DIR)).not.toContain(DECISION_FILE);

  await senior.page.goto(`${RESEARCH_URL}?step=confirm`); // D-64 T41: the decision is step 6 (提交确认)
  await expect(senior.page.getByTestId('decision-panel')).toBeVisible();
  await expect(senior.page.getByTestId('decision-draft')).toHaveText(/起草决定/);
});

test('the Senior drafts: the AI writes a 推断 decision whose reasons quote the report\'s own evidence', async () => {
  const { page } = senior;
  const drafted = page.waitForResponse((r) => r.url().endsWith('/api/decision/draft'));
  await page.getByTestId('decision-draft').click();
  expect((await drafted).status()).toBe(200);
  const card = page.getByTestId('decision-card');
  // The card comes from the route's answer itself (no router.refresh(), no reload).
  await expect(card).toBeVisible({ timeout: 5_000 });
  await expect(card).toHaveAttribute('data-status', '推断');
  await expect(card).toContainText(DECISION_TITLE);
  await expect(card).toContainText('AI 起草 · 待你确认');

  const note = await readVaultFile(DECISION_PATH);
  expect(note).toMatch(/^status: 推断$/m);
  expect(note).toMatch(/^author: AI$/m);
  expect(note).toMatch(/^decided_by: null$/m);
  // every reason has a quote taken from the source block and a block link the report itself cites
  const reasons = note.split('\n').filter((l) => l.startsWith('- **事实**') || l.startsWith('- **推断**'));
  expect(reasons).toHaveLength(2);
  for (const r of reasons) expect(r).toMatch(/“[^”]+”（[ABC] 级，[^）]+）\[\[[^\]]+#\^c\d+\]\]/);
  const report = await readVaultFile(REPORT_PATH);
  for (const link of note.match(/\[\[[^\]|]+#\^c\d+\]\]/g) ?? []) expect(report, `${link} must be cited by the report`).toContain(link.slice(0, -2).split('#')[0].slice(2));
  // the draft is logged as the AI's tool call
  expect(await readVaultFile(`${WS_A_PATH}/日志.md`)).toContain('tool:propose_decision');
});

test('while it is 推断, Junior B\'s new investigation does not see it: no tool card, not in the report', async () => {
  const { page } = juniorB;
  await page.goto(`${WS_B}/research`);
  await page.getByLabel('新调查的名字').fill(B_NAME);
  await page.getByRole('button', { name: '新建调查' }).click();
  await expect(page).toHaveURL(new RegExp(`research/${encodeURIComponent(B_NAME)}$`));
  await page.getByLabel('给 AI 的消息').fill('我想调查员工是不是已经在自带 AI');
  await page.getByRole('button', { name: '发送', exact: true }).click();
  await answerQuestion(page, '这次调查要回答什么问题？', '企业为什么为员工的 AI PC 买单？');
  await answerQuestion(page, '这个答案要支撑什么决策？', '决定 WS-A 先验证哪个买方场景');
  await answerQuestion(page, '哪些假设必须成立？', 'IT 可管理性决定企业是否采购');
  await expect(page.getByRole('heading', { name: '计划 v1' })).toBeVisible();
  await page.getByRole('button', { name: '计划定了，开始调查 →' }).click();
  await page.getByRole('button', { name: '确认批准' }).click(); // approving starts the run (no second click: it would make 报告 v2)
  await expect(page.getByTestId('run-result')).toContainText('已交付 · 引用已自检', { timeout: 360_000 });

  // no tool card reads the draft, and neither the log nor the report knows its name
  await expect(page.locator('[data-testid="tool-card"]').filter({ hasText: DECISION_TITLE })).toHaveCount(0);
  expect(await readVaultFile(`${WS_B_PATH}/日志.md`)).not.toContain(DECISION_TITLE);
  const report = await readVaultFile(`${B_DIR}/报告 v1.md`);
  expect(report).not.toContain(DECISION_TITLE);
  expect(report).toContain('遵循的已确认决定（沿关联找到）：无');
});

test('a Junior (the owner, or Junior B) who calls confirm is refused (403); the decision stays 推断', async () => {
  for (const who of [junior, juniorB]) {
    const res = await post(who, '/api/decision/confirm', { decision: DECISION_PATH });
    expect(res.status()).toBe(403);
    // the three fields, as the page sends them (D-64 T41): refused for who they are, not for the shape of the request
    const saved = await post(who, '/api/decision/confirm', { decision: DECISION_PATH, action: 'save', fields: { decision: '被改了', reason: '被改了', scope: '被改了' } });
    expect(saved.status()).toBe(403);
  }
  const note = await readVaultFile(DECISION_PATH);
  expect(note).toMatch(/^status: 推断$/m);
  expect(note).not.toContain('被改了');
});

test('the Senior changes a field and confirms; another window sees 已确认', async () => {
  const { page } = senior;
  const card = page.getByTestId('decision-card');
  // D-64 T41: the three fields are edited in place (no whole-text editor). The addition goes to 适用边界: a line added to
  // 理由 must cite the report's own evidence, and the check refuses one that does not (a reason is evidence, not a remark)
  const scope = card.locator('[data-testid="decision-field"][data-field="scope"]');
  const text = await scope.inputValue();
  await scope.fill(`${text.trimEnd()}\nSenior 补充：WS-B 先看员工自带 AI 的比例，再回头定预算口径`);
  await card.getByTestId('confirm-store').click();
  await expect(card).toHaveAttribute('data-status', '已确认');
  await expect(card).toContainText('Senior 确认');
  await expect(card).toContainText('已确认，写进了 决策/');
  // and who meets it next (moved from demo-flow.spec.ts): the next investigation of the team finds it
  await expect(page.getByTestId('decision-where-next')).toContainText('的下一次调查会检索到它');
  await expect(page.getByTestId('confirm-store')).toHaveCount(0);

  const note = await readVaultFile(DECISION_PATH);
  expect(note).toMatch(/^status: 已确认$/m);
  expect(note).toMatch(/^decided_by: Senior$/m);
  expect(note).toMatch(/^edited_by: Senior$/m);
  expect(note).toContain('Senior 补充：WS-B 先看员工自带 AI 的比例');
  expect(note).toMatch(/\*\*已确认\*\*：Senior/);
  expect(await readVaultFile(`${WS_A_PATH}/日志.md`)).toContain('event:decision.confirm');

  // the owner's window shows it after a reload, with no way to change it
  await junior.page.goto(RESEARCH_URL);
  await expect(junior.page.getByTestId('decision-panel')).toHaveCount(0);
});

test('after confirmation, Junior B\'s next investigation finds it: a vault_read card along relates_to, and the report follows it', async () => {
  test.setTimeout(240_000);
  const { page } = juniorB;
  // A fresh page re-attaches to the first run, which finished minutes ago (a finished run can be re-attached for 10
  // minutes), so 「已交付 · 引用已自检」 is on screen at once: that is the OLD result. 开始调查 on a finished run starts a new
  // one (only a run that is still going is followed instead), so wait for its report, not for the text.
  await page.goto(B_URL);
  // the page re-attaches to the first run (which finished minutes ago) without taking the tab away; wait until its
  // result is on screen so that the 「已交付」 we may see is known to be the OLD one
  // (if the 10 minutes have run out nothing is re-attached, and there is nothing to wait for)
  await page.getByTestId('run-result').waitFor({ state: 'attached', timeout: 15_000 }).catch(() => undefined);
  await page.getByRole('tab', { name: '执行' }).click();
  await page.getByTestId('run-start').click(); // 跑完整调查… / 再跑一次调查…: the dialog; the mode is chosen in it
  await page.getByTestId('run-option-small').click();
  await page.getByRole('button', { name: '开始试水调查' }).click();
  await expect.poll(async () => vaultFiles(B_DIR), { timeout: 360_000, intervals: [1_000] }).toContain('报告 v2.md');
  await expect(page.getByTestId('run-start')).not.toHaveText('执行中…', { timeout: 120_000 }); // the new run has ended

  const card = page.locator('[data-testid="tool-card"][data-tool="vault_read"]').filter({ hasText: DECISION_TITLE });
  await expect(card).toHaveCount(1);
  await page.getByRole('tab', { name: '执行' }).click();
  await card.getByRole('button').first().click(); // expand it: the card shows why it was read
  await expect(card).toContainText('relates_to');
  await expect(card).toContainText('Senior 补充'); // the output is the confirmed text, edit included

  const log = await readVaultFile(`${WS_B_PATH}/日志.md`);
  expect(log).toMatch(/tool:vault_read[^\n]*决策\/WS-A 买方决定-先打IT管理场景/);
  const report = await readVaultFile(`${B_DIR}/报告 v2.md`);
  // the report quotes the decision's own words (M2 3.3), says who confirmed it and how it was found, and links it
  const line = report.split('\n').find((l) => l.includes('遵循的已确认决定')) ?? '';
  expect(line).toContain('买方侧先验证 IT 管理场景');
  expect(line).toContain('Senior 确认');
  expect(line).toMatch(/\[\[[^\]]*WS-A 买方决定-先打IT管理场景[^\]]*\]\]/);
  // and the first run's report, written while it was 推断, still does not mention it
  expect(await readVaultFile(`${B_DIR}/报告 v1.md`)).not.toContain(DECISION_TITLE);
});
