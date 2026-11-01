import type { Browser, BrowserContext, Page } from '@playwright/test';
import { BASE_URL } from './env';

/** Role ids from 90_配置/角色.md; the app keeps the current one in the `sw-role` cookie. */
export type RoleId = 'senior' | 'junior-a' | 'junior-b';

export interface RoleWindow {
  context: BrowserContext;
  page: Page;
}

/** One browser context per role: its own cookie jar and localStorage, like a second person's window. */
export async function openAs(browser: Browser, role: RoleId): Promise<RoleWindow> {
  const context = await browser.newContext();
  await context.addCookies([{ name: 'sw-role', value: role, url: BASE_URL }]);
  return { context, page: await context.newPage() };
}

export const WS_A = '/workspace/%E4%B8%AA%E4%BA%BAAI%E6%88%98%E7%95%A5/WS-A%20%E4%B9%B0%E6%96%B9';
export const WS_A_PATH = '20_项目/个人AI战略/WS-A 买方';
export const WS_B = '/workspace/%E4%B8%AA%E4%BA%BAAI%E6%88%98%E7%95%A5/WS-B%20%E7%94%A8%E6%88%B7';
export const WS_B_PATH = '20_项目/个人AI战略/WS-B 用户';

/**
 * POST as a role's browser context. The dev server closes idle keep-alive sockets after a few seconds, and a request
 * that reuses one at that moment fails with ECONNRESET before it reaches the server (seen at load 3, so not load):
 * retry those, and only those.
 */
export async function apiPost(who: RoleWindow, url: string, data: object) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await who.context.request.post(url, { data });
    } catch (e) {
      if (attempt >= 3 || !/ECONNRESET|socket hang up|EPIPE/.test(String(e))) throw e;
      await new Promise((r) => setTimeout(r, 300));
    }
  }
}
