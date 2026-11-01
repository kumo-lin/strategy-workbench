/**
 * A second run on the same page (the user's report: after a small run, picking 完整调查 and clicking 开始调查 jumped at
 * once to the 报告 tab and the small run's report). The page stays on 执行 with this run's steps, the last run's result
 * does not stand in for it, and only when this run ends does the page move to 报告 — on the new version, even when an
 * older one was picked before (?v=…).
 *
 * Snapshot: e2e-vault-segment3 (WS-B's plan v1, approved through the API as Junior B).
 */
import { expect, test } from '@playwright/test';
import { apiPost, openAs, WS_B, WS_B_PATH, type RoleWindow } from './support/roles';
import { readVaultFile, resetVault } from './support/vault';

const B_NAME = '员工自带AI的程度';
const B_DIR = `${WS_B_PATH}/调查/${B_NAME}`;
const B_URL = `${WS_B}/research/${encodeURIComponent(B_NAME)}`;
const log = () => readVaultFile(`${WS_B_PATH}/日志.md`);

test.describe.configure({ mode: 'serial' });

let junior: RoleWindow;

test.beforeAll(async ({ browser }) => {
  await resetVault('e2e-vault-segment3');
  junior = await openAs(browser, 'junior-b');
  const approve = await apiPost(junior, '/api/research/approve', { workspacePath: WS_B_PATH, researchDir: B_DIR });
  expect(approve.ok(), await approve.text()).toBe(true);
});
test.afterAll(async () => {
  await junior?.context.close();
});

test('a 试水调查 started from the dialog, then 跑完整调查… on the same page: the page stays on 执行 and says the run is done, with a button to the report', async () => {
  test.setTimeout(420_000);
  const { page } = junior;
  await page.goto(B_URL);
  const runTab = page.getByRole('tab', { name: '执行' });
  const reportTab = page.getByRole('tab', { name: /报告/ });

  // 1. the plan is approved but nothing ran yet: "开始调查…" opens the dialog on 试水调查; the mode is chosen there
  await runTab.click();
  await expect(page.getByTestId('mode-picker')).toHaveCount(0);
  // (the server keeps a finished run for 10 minutes, so a run of an earlier spec may be re-attached: the label is then 再跑一次调查…)
  await expect(page.getByTestId('run-start')).toHaveText(/调查…$/);
  await page.getByTestId('run-start').click();
  await expect(page.getByTestId('run-option-small')).toHaveAttribute('aria-checked', 'true');
  await page.getByRole('button', { name: '开始试水调查' }).click();
  // it stops on 内部资料清单 first (run-start is disabled and says another label there): 不够，上网查 continues it
  await expect(page.getByTestId('run-start')).toHaveText('执行中…'); // this run is on, so the result below is its own
  await expect(page.getByTestId('run-progress')).toContainText('试水调查');
  // it ends: the page does NOT move. The run says it is done, what it covered, and offers the report and the full run
  await expect(page.getByTestId('run-result')).toContainText('已交付 · 引用已自检', { timeout: 240_000 });
  await expect(page.getByTestId('run-scope-note')).toContainText('这次只查了');
  await expect(runTab).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId('run-start')).toHaveText('跑完整调查…');
  expect(await log()).toMatch(/research:done \| 报告 v1/);

  // the owner had picked report v1 in the list (the URL says so)
  await page.goto(`${B_URL}?v=${encodeURIComponent(`${B_DIR}/报告 v1.md`)}`);

  // 2. 跑完整调查…: the same dialog, 完整调查 already chosen
  await runTab.click();
  await page.getByTestId('run-start').click();
  await expect(page.getByTestId('run-option-full')).toHaveAttribute('aria-checked', 'true');
  await page.getByRole('button', { name: '开始完整调查' }).click();
  // the full run stops on 内部资料清单 too; the answer continues it into the run
  // while it runs: still on 执行, the report step says it is being generated, and the small run's result is not shown as this one's
  await expect(page.getByTestId('run-start')).toHaveText('执行中…');
  await expect(runTab).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId('step-report')).toContainText('生成中');
  await expect(page.getByTestId('run-result')).toHaveCount(0);
  await expect(page.getByTestId('run-step').first()).toBeAttached();
  await expect.poll(log, { timeout: 60_000 }).toMatch(/research:start \| 开始执行 计划 v1（完整调查）/);

  // 3. it ends: the page stays; 查看报告 v2 opens the new version
  await expect(page.getByTestId('run-result')).toContainText('报告 v2 已交付', { timeout: 300_000 });
  await expect(runTab).toHaveAttribute('aria-selected', 'true');
  expect(await log()).toMatch(/research:done \| 报告 v2/);
  await page.getByTestId('run-view-report').click();
  await expect(reportTab).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('combobox', { name: '选择报告版本' })).toContainText('报告 v2');
  await expect(page).not.toHaveURL(/[?&]v=/);
});
