/**
 * D-64 T04: the base walk — a floor that stays green while the To-Be work changes everything else. With the mock model,
 * open the home page, the project page, WS-A's workbench and its files page: each answers 200, renders without an
 * uncaught page error, and shows no Next error overlay. When a later card moves a route, it updates this list.
 */
import { expect, test } from '@playwright/test';
import { openAs, WS_A } from './support/roles';
import { resetVault } from './support/vault';

const ROUTES = [
  { name: '首页', url: '/' },
  { name: '项目页', url: '/workspace' },
  { name: 'WS-A 工作台', url: WS_A },
  { name: 'WS-A 文件管理', url: `${WS_A}/files` },
  // D-64 T32, T33, T43
  { name: '待你处理', url: '/inbox' },
  { name: '新建项目', url: '/new' },
  { name: '方法与配置', url: '/config' },
];

test.beforeAll(async () => {
  await resetVault('e2e-vault');
});

for (const r of ROUTES) {
  test(`${r.name} opens without an error`, async ({ browser }) => {
    const { context, page } = await openAs(browser, 'junior-a');
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    const res = await page.goto(r.url);
    expect(res?.status()).toBe(200);
    await page.waitForLoadState('networkidle');
    await expect(page.locator('[data-nextjs-dialog], [data-nextjs-error-overlay]')).toHaveCount(0);
    expect(errors).toEqual([]);
    await context.close();
  });
}
