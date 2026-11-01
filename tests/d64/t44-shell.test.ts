/** D-64 T44: public navigation and vocabulary, without changing internal workflow states. */
import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Vault } from '@/lib/vault';
import { makeFixtureVault, ROLES } from '../helpers/fixture-vault';
const mocked = vi.hoisted(() => ({ vault: null as unknown as Vault }));
vi.mock('@/lib/vault', async (orig) => ({ ...(await orig<typeof import('@/lib/vault')>()), getVault: () => mocked.vault }));
vi.mock('@/lib/session/role', () => ({ getCurrentRole: async () => ROLES.juniorA, getRoles: async () => Object.values(ROLES), getWindowRoleId: async () => null }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh() {}, push() {} }), usePathname: () => '/', notFound: () => { throw new Error('not found'); } }));
let cleanup: () => Promise<void>;
beforeEach(async () => { const fx = await makeFixtureVault(); mocked.vault = fx.vault; cleanup = fx.cleanup; });
afterEach(async () => cleanup());
const forbidden = /G1|G2|G3|PDCA|工作循环|内部资料清单|对比/;
describe('T44 public shell', () => {
  it('the sidebar, current identity and role switcher remain usable', async () => {
    const { default: Layout, generateMetadata } = await import('@/app/layout');
    const out = renderToString(await Layout({ children: '页面' }));
    for (const text of ['AI 协作战略工作台', '首页', '待你处理', '项目', '团队资料库', '方法与配置', '当前身份', 'Junior A']) expect(out, text).toContain(text);
    for (const id of ['side-nav', 'side-nav-home', 'side-nav-inbox', 'side-nav-project-P', 'side-nav-library', 'side-nav-config', 'current-identity', 'role-switcher']) expect(out, id).toContain(`data-testid="${id}"`);
    expect(out).not.toMatch(forbidden);
    expect(await generateMetadata()).toMatchObject({ title: '[Junior A] AI 协作战略工作台' });
  });
  it('all required routes render without internal workflow vocabulary', async () => {
    const { default: Layout } = await import('@/app/layout');
    const pages = [
      async () => (await import('@/app/page')).default(),
      async () => (await import('@/app/new/page')).default({ searchParams: Promise.resolve({}) }),
      async () => (await import('@/app/inbox/page')).default({ searchParams: Promise.resolve({}) }),
      async () => (await import('@/app/config/page')).default({ searchParams: Promise.resolve({}) }),
      async () => (await import('@/app/project/[name]/page')).default({ params: Promise.resolve({ name: 'P' }) }),
      async () => (await import('@/app/workspace/[project]/[workspace]/page')).default({ params: Promise.resolve({ project: 'P', workspace: 'WS-A' }) }),
      async () => (await import('@/app/workspace/[project]/[workspace]/files/page')).default({ params: Promise.resolve({ project: 'P', workspace: 'WS-A' }), searchParams: Promise.resolve({}) }),
    ];
    for (const page of pages) {
      const out = renderToString(await Layout({ children: await page() }));
      expect(out).not.toMatch(forbidden);
      expect(out).not.toMatch(/\[\[|#\^|项目\.md/);
    }
  });
});