/**
 * D-64 T55: the web address decides the role (senior.localhost / junior-b.localhost), and a read-only note links to the
 * owner's window. Moved here from demo-flow.spec.ts, which the to-be walkthrough replaced; nothing else covers it.
 */
import { expect, test } from '@playwright/test';
import { APP_PORT } from './support/env';
import { openAs, WS_B, type RoleWindow } from './support/roles';
import { resetVault } from './support/vault';

const B_NAME = '员工自带AI的程度';
const B_URL = `${WS_B}/research/${encodeURIComponent(B_NAME)}`;

let senior: RoleWindow;
test.beforeAll(async ({ browser }) => {
  await resetVault('e2e-vault-demo');
  senior = await openAs(browser, 'senior');
});
test.afterAll(async () => {
  await senior?.context.close();
});

test('the web address decides the role: a fixed window has no switcher, and a read-only note links to the owner\'s window', async ({ browser }) => {
  const host = (role: string) => `http://${role}.localhost:${APP_PORT}`;
  // the cookie says Junior A; the address says Senior, and the address wins
  const context = await browser.newContext();
  await context.addCookies([{ name: 'sw-role', value: 'junior-a', url: host('senior') }]);
  const page = await context.newPage();
  await page.goto(`${host('senior')}/`);
  await expect(page.getByTestId('role-nameplate')).toContainText('Senior · 审批者');
  await expect(page.getByTestId('role-lock')).toContainText('本窗口');
  await expect(page.getByTestId('role-switcher')).toHaveCount(0);
  await expect(page).toHaveTitle('[Senior] AI 协作战略工作台');
  // Senior opens WS-B's plan (Junior B's): read-only, and the way out is a link to junior-b's window, same page
  await page.goto(`${host('senior')}${B_URL}`);
  const notice = page.getByTestId('readonly-notice').first();
  await expect(notice).toContainText('只读：这份调查计划');
  const link = notice.getByTestId('window-link');
  await expect(link).toContainText('在 Junior B 的窗口打开这一页');
  await expect(link).toHaveAttribute('href', `${host('junior-b')}${B_URL}`);
  await context.close();

  const b = await browser.newContext();
  const pb = await b.newPage();
  await pb.goto(`${host('junior-b')}/`);
  await expect(pb.getByTestId('role-nameplate')).toContainText('Junior B · 执行者');
  await pb.getByTestId('role-lock').click();
  await expect(pb.getByTestId('role-lock-hint')).toContainText('要换角色，请用对应网址的窗口');
  // a bare address (the e2e's own 127.0.0.1) still has the cookie and the switcher
  await senior.page.goto('/');
  await expect(senior.page.getByTestId('role-switcher')).toBeVisible();
  await b.close();
});
