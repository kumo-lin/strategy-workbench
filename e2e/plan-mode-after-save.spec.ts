/**
 * The mode picked next to "批准并开始调查" survives saving the plan (a live run started small after the user had picked
 * 完整调查 and then saved a new version). Junior B on WS-B: pick 完整调查, edit, save plan v2, wait, look at the run tab,
 * reload the page (the pick is kept per tab), approve — the confirm dialog says 完整调查 and the run that starts is the
 * full one. Passes on `next dev` and on the production server (E2E_NEXT=start, after `next build`).
 *
 * Snapshot: e2e-vault-segment3 (WS-B's draft plan v1, Junior B the owner).
 */
import { expect, test } from '@playwright/test';
import { openAs, WS_B, WS_B_PATH, type RoleWindow } from './support/roles';
import { readVaultFile, resetVault } from './support/vault';

const B_NAME = '员工自带AI的程度';
const B_DIR = `${WS_B_PATH}/调查/${B_NAME}`;
const B_URL = `${WS_B}/research/${encodeURIComponent(B_NAME)}`;

test.describe.configure({ mode: 'serial' });

let junior: RoleWindow;

test.beforeAll(async ({ browser }) => {
  await resetVault('e2e-vault-segment3');
  junior = await openAs(browser, 'junior-b');
});
test.afterAll(async () => {
  await junior?.context.close();
});

test('the mode is chosen once, in the approve dialog: saving the plan and reloading cannot reset it, and approving starts that run', async () => {
  test.setTimeout(300_000);
  const { page } = junior;
  await page.goto(B_URL);
  await expect(page.getByRole('heading', { name: '计划 v1' })).toBeVisible();
  // there is no other mode control on the page: not beside the buttons, not on the run tab
  await expect(page.getByTestId('mode-picker')).toHaveCount(0);

  const purpose = page.locator('#plan-purpose');
  await purpose.fill(`${await purpose.inputValue()}（改一句，存成新版本）`);
  await page.getByRole('button', { name: '保存为新版本' }).click();
  await expect(page.getByRole('heading', { name: '计划 v2' })).toBeVisible();
  await expect(page.getByText('已保存为 计划 v2')).toBeVisible(); // said by the new version's editor
  expect(await readVaultFile(`${B_DIR}/计划 v2.md`)).toContain('改一句，存成新版本');

  // approving right after the save: the button waits for the new version's editor, so the dialog it opens stays open
  await page.getByRole('button', { name: '计划定了，开始调查 →' }).click();
  await expect(page.getByRole('alertdialog')).toContainText('批准 计划 v2，并开始调查？');
  await page.waitForTimeout(3_000); // the refresh after the save has arrived by now: the dialog is still there
  await expect(page.getByRole('alertdialog')).toBeVisible();
  await page.getByRole('button', { name: '取消' }).click();
  await expect(page.getByRole('alertdialog')).toHaveCount(0);

  // the user took a while before approving: the vault's live refresh has come and gone, and they looked at the run tab
  await page.waitForTimeout(5_000);
  await page.getByRole('tab', { name: '执行' }).click();
  await expect(page.getByTestId('mode-picker')).toHaveCount(0);
  await page.getByRole('tab', { name: /调查计划/ }).click();
  await page.reload();
  await expect(page.getByRole('heading', { name: '计划 v2' })).toBeVisible();

  // the dialog opens on 试水调查 (the default); 完整调查 is picked in it, and the button follows the pick
  await page.getByRole('button', { name: '计划定了，开始调查 →' }).click();
  await expect(page.getByTestId('approve-mode')).toHaveText('将以 试水调查 开始');
  await expect(page.getByRole('alertdialog')).toContainText('批准 计划 v2，并开始调查？');
  await page.getByTestId('run-option-full').click();
  await expect(page.getByTestId('run-option-full')).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByTestId('approve-mode')).toHaveText('将以 完整调查 开始');
  await page.getByRole('button', { name: '确认批准，开始完整调查' }).click();
  // the vault-only stage runs first and stops for the answer; 不够，上网查 continues with the full run
  await expect(page.getByText('计划已批准 · 调查工具已开放')).toBeVisible();
  // approving leaves the page on 执行: it shows the run, with the mode it started in
  await expect(page.getByTestId('step-run')).toHaveAttribute('data-state', 'active');
  await expect(page.getByTestId('run-progress')).toContainText('完整调查');

  // the run that started is the full one
  await expect.poll(async () => readVaultFile(`${WS_B_PATH}/日志.md`), { timeout: 60_000 }).toMatch(/research:start \| 开始执行 计划 v2（完整调查）/);
  expect(await readVaultFile(`${WS_B_PATH}/日志.md`)).not.toMatch(/开始执行 计划 v2（试水调查）/);
  // let the run finish: it writes into the vault, and the next spec resets the vault
  await expect.poll(async () => readVaultFile(`${WS_B_PATH}/日志.md`), { timeout: 240_000, intervals: [2_000] }).toMatch(/research:done \| 报告 v1/);
});
