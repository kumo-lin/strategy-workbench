/**
 * PRD §11.2 step 3, second half (M2): on WS-A after G1, Junior A starts a Deep Research (grill → plan v1),
 * edits one thing (→ v2), is refused a run before approving (409), approves, runs the 9 steps, reads the
 * report (summary first, a citation opens the source's original sentence, the counter-evidence round ran).
 * Other windows (Senior, Junior B) see the approval and the report after loading, and cannot approve or run.
 */
import { expect, test } from '@playwright/test';
import { answerQuestion, attemptName, openSubQuestions } from './support/ui';
import { apiPost, openAs, WS_A, WS_A_PATH, type RoleWindow } from './support/roles';
import { readVaultFile, resetVault, vaultFiles } from './support/vault';

// set per attempt in beforeAll (see attemptName)
let NAME = 'IT 可管理性';
let RESEARCH_DIR = `${WS_A_PATH}/调查/${NAME}`;
let RESEARCH_URL = `${WS_A}/research/${encodeURIComponent(NAME)}`;

test.describe.configure({ mode: 'serial' });

let junior: RoleWindow;
let senior: RoleWindow;
let juniorB: RoleWindow;

test.beforeAll(async ({ browser }) => {
  NAME = attemptName('IT 可管理性', test.info().retry);
  RESEARCH_DIR = `${WS_A_PATH}/调查/${NAME}`;
  RESEARCH_URL = `${WS_A}/research/${encodeURIComponent(NAME)}`;
  // ⏸ the vault snapshot after G1: workplan v1 approved, hypothesis WS-A-H1 in the vault
  await resetVault('e2e-vault-g1');
  junior = await openAs(browser, 'junior-a');
  senior = await openAs(browser, 'senior');
  juniorB = await openAs(browser, 'junior-b');
});
test.afterAll(async () => {
  await Promise.all([junior?.context.close(), senior?.context.close(), juniorB?.context.close()]);
});

/** Step numbers (1–9) found in the labels of the run's step list. */
const stepNumbers = (labels: string[]) => [...new Set(labels.map((t) => Number(/步骤\s*(\d)/.exec(t)?.[1])))].sort((a, b) => a - b);

const post = apiPost;

test('new investigation: the AI grills (3 questions), then writes plan v1', async () => {
  const { page } = junior;
  await page.goto(`${WS_A}/research`);
  await expect(page.getByTestId('research-list')).toContainText('还没有调查');
  await page.getByLabel('新调查的名字').fill(NAME);
  await page.getByRole('button', { name: '新建调查' }).click();
  await expect(page).toHaveURL(new RegExp(`research/${encodeURIComponent(NAME)}$`));
  await expect(page.getByTestId('research-chat')).toBeVisible();
  await expect(page.getByText('调查工具还没开放')).toBeVisible();

  await page.getByLabel('给 AI 的消息').fill('我想调查企业为什么为 AI PC 买单');
  await page.getByRole('button', { name: '发送', exact: true }).click();
  await answerQuestion(page, '这次调查要回答什么问题？', '企业为什么为员工的 AI PC 买单？');
  await answerQuestion(page, '这个答案要支撑什么决策？', '决定 WS-A 先验证哪个买方场景');
  await answerQuestion(page, '哪些假设必须成立？', 'IT 可管理性决定企业是否采购');

  // plan v1 is a draft: not approved, so no research tool exists yet
  await expect(page.getByRole('heading', { name: '计划 v1' })).toBeVisible();
  await expect(page.getByText('草稿', { exact: true })).toBeVisible();
  await expect(page.getByLabel('核心问题')).toHaveValue('企业为什么为员工的 AI PC 买单？');
  // D-39: the plan is a question tree: Q1 with its hypothesis H1; the 要查的问题 are folded under the hypothesis
  await expect(page.getByLabel('子问题 Q1（问句）')).toHaveValue('企业买单的首要条件是不是 IT 能管？');
  await expect(page.getByTestId('plan-mece-check')).toContainText('MECE');
  await openSubQuestions(page);
  await expect(page.getByLabel('要查的问题 Q1.1 的问法')).toHaveValue('企业采购 AI PC 时 IT 部门的角色是什么？');
  const plan = await readVaultFile(`${RESEARCH_DIR}/计划 v1.md`);
  expect(plan).toContain('author: AI');
  expect(plan).toContain('approved_by_owner: null');
  expect(plan).toContain('[[WS-A-H1 IT 可管理性]]');
});

test('Junior A changes one thing and saves it as plan v2', async () => {
  const { page } = junior;
  await openSubQuestions(page);
  const q1 = page.getByLabel('要查的问题 Q1.1 的问法');
  await q1.fill('企业采购 AI PC 时，IT 部门的管理和安全要求是什么？');
  // D-34: the plan misses 监管; Junior adds a sub-question for it, and the notice goes as soon as 监管 is picked
  await expect(page.getByTestId('plan-perspective-gaps')).toContainText('漏了：监管');
  await page.getByRole('button', { name: '为假设 H1 添加要查的问题' }).click();
  await page.getByLabel('要查的问题 Q1.4 的问法').fill('受监管行业的采购要求里有没有写 IT 管控？');
  await page.getByRole('button', { name: '要查的问题 Q1.4 视角：监管', exact: true }).click();
  await expect(page.getByRole('button', { name: '要查的问题 Q1.4 视角：监管', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('plan-perspective-gaps')).toHaveCount(0);
  await page.getByRole('button', { name: '保存为新版本' }).click();
  await expect(page.getByText('已保存为 计划 v2')).toBeVisible();
  expect(await vaultFiles(RESEARCH_DIR)).toEqual(expect.arrayContaining(['计划 v1.md', '计划 v2.md']));
  expect(await readVaultFile(`${RESEARCH_DIR}/计划 v2.md`)).toContain('管理和安全要求是什么');
  expect(await readVaultFile(`${RESEARCH_DIR}/计划 v2.md`)).toMatch(/id: C1-Q4[\s\S]*?perspective:\s*\n?\s*-?\s*\[?监管/);
  expect(await readVaultFile(`${RESEARCH_DIR}/计划 v1.md`)).toContain('IT 部门的角色是什么'); // v1 is kept
});

test('before approval the run is refused: 409 from the API, and the button is off', async () => {
  const body = { workspacePath: WS_A_PATH, researchDir: RESEARCH_DIR, mode: 'small' };
  const res = await post(junior, '/api/research/execute', body);
  expect(res.status()).toBe(409);
  expect(await res.json()).toMatchObject({ error: expect.stringContaining('还没有批准') });

  await junior.page.getByRole('tab', { name: '执行' }).click();
  await expect(junior.page.getByTestId('run-start')).toBeDisabled();
  expect(await vaultFiles(`${WS_A_PATH}/调查/${NAME}`)).not.toContain('报告 v1.md');
});

test('only the owner approves; Junior B and Senior are refused, then Junior A approves plan v2', async () => {
  const body = { workspacePath: WS_A_PATH, researchDir: RESEARCH_DIR };
  expect((await post(juniorB, '/api/research/approve', body)).status()).toBe(403);
  expect((await post(senior, '/api/research/approve', body)).status()).toBe(403);
  expect(await readVaultFile(`${RESEARCH_DIR}/计划 v2.md`)).toContain('approved_by_owner: null');

  const { page } = junior;
  await page.getByRole('tab', { name: /调查计划/ }).click();
  await page.getByRole('button', { name: '计划定了，开始调查 →' }).click();
  // approving IS starting: the dialog says so and names the mode picked next to the button
  await expect(page.getByRole('alertdialog')).toContainText('调查立即开始');
  await expect(page.getByTestId('approve-mode')).toHaveText('将以 试水调查 开始');
  await page.getByRole('button', { name: '确认批准' }).click();
  await expect(page.getByText('计划已批准 · 调查工具已开放')).toBeVisible();
  expect(await readVaultFile(`${RESEARCH_DIR}/计划 v2.md`)).toMatch(/approved_by_owner: Junior A/);

  // other windows see the approval once they load the page
  for (const who of [senior, juniorB]) {
    await who.page.goto(RESEARCH_URL);
    await expect(who.page.getByText('计划已批准 · 调查工具已开放')).toBeVisible();
    await who.page.getByRole('tab', { name: '执行' }).click();
    await expect(who.page.getByTestId('run-start')).toBeDisabled(); // not the owner
  }
  // and even by the API only the owner can start the run
  expect((await post(juniorB, '/api/research/execute', { ...body, mode: 'small' })).status()).toBe(403);
});

test('approving starts the investigation: first the inventory, then (after 不够，上网查) 9 steps, counter-evidence round, report delivered', async () => {
  test.setTimeout(420_000); // ~20s on an idle machine; a run on a machine under heavy load took nearly 3 minutes
  const { page } = junior;
  // no click on 开始调查: approving the plan started the vault-only stage by itself. It stops on 内部资料清单; one answer on
  // that panel continues it (once: a second click on 开始调查 would make 报告 v2)
  await expect(page.getByTestId('run-result')).toContainText('已交付 · 引用已自检', { timeout: 360_000 });

  // the steps of PRD §6.3.1 that the run shows (all nine: see the next test), none failed
  const steps = page.getByTestId('run-step');
  // (the page moves to the report tab when the run ends, so the step list is hidden by now: read textContent)
  const labels = await steps.allTextContents();
  const numbers = stepNumbers(labels);
  expect(numbers).toEqual(expect.arrayContaining([1, 2, 3, 4, 5, 6, 7, 8, 9]));
  expect(numbers.every((n) => n >= 1 && n <= 9)).toBe(true);
  await expect(page.locator('[data-testid="run-step"][data-status="failed"]')).toHaveCount(0);
  // 6 = 反证 (always runs, even when the vault alone looks decisive)
  await expect(steps.filter({ hasText: /步骤\s*6/ }).first()).toContainText('反证');
  await expect(steps.filter({ hasText: /步骤\s*6/ }).last()).toHaveAttribute('data-status', 'done');

  // the page does not move by itself: the run says it is done and offers the report; the button opens it
  await expect(page.getByRole('tab', { name: '执行' })).toHaveAttribute('aria-selected', 'true');
  await page.getByTestId('run-view-report').click();
  await expect(page.getByRole('tab', { name: /报告/ })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId('report-scope')).toContainText('试水调查 · 只回答了');
  await expect(page.getByRole('tabpanel', { name: /报告/ }).getByText('已交付 · 引用已自检')).toBeVisible();
  expect(await vaultFiles(RESEARCH_DIR)).toContain('报告 v1.md');
  expect(await vaultFiles(RESEARCH_DIR)).not.toContain('报告 v2.md');
});

// PRD §6.3.1 is nine steps scheduled in code: the run panel shows all of them. A step this run did not need
// (the vault was enough, no gap to fill) is shown as 跳过：<reason>, never left out.
test('all 9 steps of PRD §6.3.1 are shown', async () => {
  const steps = junior.page.getByTestId('run-step');
  const labels = await steps.allTextContents();
  expect(stepNumbers(labels)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  // none is left running, and a skipped one says why
  await expect(junior.page.locator('[data-testid="run-step"][data-status="running"]')).toHaveCount(0);
  for (const text of await junior.page.locator('[data-testid="run-step"][data-status="skipped"]').allTextContents()) {
    expect(text).toMatch(/跳过：.{3,}/);
  }
});

test('the report: So what first, a citation opens the original sentence, counter-evidence is there', async () => {
  const { page } = junior;
  const report = await readVaultFile(`${RESEARCH_DIR}/报告 v1.md`);
  // D-64 T23: the report opens with So what; the old Summary and the process are in the appendix after it
  expect(report.indexOf('## So what')).toBeGreaterThan(-1);
  expect(report.indexOf('## So what')).toBeLessThan(report.indexOf('## Summary'));
  expect(report.indexOf('## So what')).toBeLessThan(report.indexOf('## 怎么查的'));

  // on screen: under the title, the first section of the report is So what
  const firstHeading = page.locator('[role="tabpanel"]:visible h2').first();
  await expect(firstHeading).toContainText('So what');

  // citation chips: click one, the right side shows the source note's own sentence (it is in the note, verbatim)
  const chips = page.getByTestId('citation-chip');
  await expect(chips.first()).toBeVisible();
  const links = await chips.evaluateAll((els) => els.map((e) => e.getAttribute('data-link') ?? ''));
  expect(links.length).toBeGreaterThan(1);
  // D-64 T39: the citation popover shows the sentence in its context (was 资料原文)
  const original = page.getByTestId('cite-popover').getByText('原文上下文').locator('..').locator('blockquote');
  const seen: string[] = [];
  for (const [i, link] of links.entries()) {
    const source = /^\[\[([^#\]|]+)#\^c\d+/.exec(link)?.[1];
    if (!source || seen.includes(source)) continue;
    seen.push(source);
    await chips.nth(i).click();
    // The panel still shows the previous chip's sentence until the new one is loaded (it filled the blockquote, so "not empty"
    // is not enough: at load 16 this read the previous source's sentence and failed once). Wait for the sentence to be one of
    // this source's own.
    const note = await readVaultFile(`10_资料库/${source}.md`);
    await expect(async () => {
      const shown = (await original.innerText()).trim();
      expect(shown).not.toBe('');
      expect(note, `${link} should show a sentence from ${source}`).toContain(shown);
    }).toPass({ timeout: 30_000 });
  }
  expect(seen.length).toBeGreaterThan(1); // the preset source and at least one source ingested from the web in this run
  await expect(original).toContainText('IT 部门主导了 AI PC 的采购决策'); // the last one opened is a web source
  await expect(page.getByTestId('report-sources')).toContainText('引用的资料');

  // 反证: a section in the report, and the log has the round
  const reportPane = page.getByRole('tabpanel', { name: '报告' });
  await expect(reportPane).toContainText('H1 的反证：已专门检索一轮'); // "怎么查的" says the round ran
  // and the hypothesis section lists what it found, point by point: in the folded third layer, closed until opened (D-48)
  const fold = reportPane.getByTestId('evidence-fold').first();
  await expect(fold).toContainText(/^证据、反证和挑战、缺口（支持 \d+ · 反证 \d+ · 要问专家 \d+）/);
  await expect(fold).not.toHaveAttribute('open', '');
  await fold.locator('summary').click();
  await expect(fold.getByText('反证和挑战（逐条回应）', { exact: false }).first()).toBeVisible();
  expect(report).toMatch(/^- 反证和挑战（逐条回应）：/m);
  const log = await readVaultFile(`${WS_A_PATH}/日志.md`);
  for (const action of ['tool:web_search', 'tool:ingest_source', 'research:start', 'research:verdict']) expect(log).toContain(action);
});

test('Senior and Junior B load the page and see the same report', async () => {
  for (const who of [senior, juniorB]) {
    await who.page.goto(RESEARCH_URL);
    await expect(who.page.getByRole('tabpanel', { name: /报告/ }).getByText('已交付 · 引用已自检')).toBeVisible();
    await expect(who.page.getByTestId('citation-chip').first()).toBeVisible();
  }
  // the list shows the finished investigation to everybody
  await senior.page.goto(`${WS_A}/research`);
  await expect(senior.page.getByTestId('research-list')).toContainText(NAME);
  await expect(senior.page.getByTestId('research-list')).toContainText('报告 v1 · 已交付');
});
