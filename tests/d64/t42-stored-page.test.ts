/** D-64 T42: confirmed outputs of this investigation, visible to both roles. */
import { renderToString } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Role } from '@/lib/config/roles';
import type { Vault } from '@/lib/vault';
import { makeFixtureVault, ROLES } from '../helpers/fixture-vault';

const mocked = vi.hoisted(() => ({ vault: null as unknown as Vault, role: null as unknown as Role }));
vi.mock('@/lib/session/role', async (orig) => ({ ...(await orig<typeof import('@/lib/session/role')>()), getCurrentRole: async () => mocked.role }));
vi.mock('@/lib/vault', async (orig) => ({ ...(await orig<typeof import('@/lib/vault')>()), getVault: () => mocked.vault }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh() {}, push() {} }), usePathname: () => '/x', notFound: () => { throw new Error('not found'); } }));
const WS = '20_项目/P/WS-A';
const REPORT = `${WS}/调查/R1/报告 v2.md`;
const INTERVIEW = '20_项目/P/访谈/用户访谈.md';
const note = (id: string, type: string, extra: string, body = '# 内容\n', derived = '[[团队]]') => `---\nid: ${id}\ntype: ${type}\nstatus: 已确认\ncreated: "2026-10-28"\nupdated: "2026-10-28"\nauthor: Senior\nderived_from: ["${derived}"]\nrelates_to: ["[[团队]]"]\n${extra}\n---\n${body}`;
let cleanup: () => Promise<void> = async () => {};
afterEach(async () => cleanup());
async function fixture(confirmed = true) {
  const fx = await makeFixtureVault({
    [REPORT]: note('r2', 'report', 'version: 2\nresearch_plan: null\nmode: team\nexploratory: false\ndelivery: 已交付', '# 调查报告 v2\n\n## So what\n\n先验证。\n', `[[${INTERVIEW.replace(/\.md$/, '')}]]`),
    [`${WS}/review/结论 2026-10-28.md`]: note('rev', 'review', `requester: Junior A\nreviewer: Senior\ngate: 结论\nresult: ${confirmed ? '通过' : 'null'}`, '# 审阅\n', `[[${REPORT.replace(/\.md$/, '')}]]`),
    '20_项目/P/决策/先验证.md': note('d', 'decision', 'decided_by: Senior\ntrigger: "[[团队]]"\nreason: 理由\naffects: []\nscope: 本项目', '# 先验证\n\n## 决定\n\n先验证。\n', `[[${REPORT.replace(/\.md$/, '')}]]`),
    [INTERVIEW]: note('iv', 'meeting', 'kind: 访谈\nsimulated: true\ndate: "2026-10-28"\nattendees: [Senior]\ndecisions: []', '# 用户访谈\n'),
    '20_项目/P/访谈/无关访谈.md': note('other', 'meeting', 'kind: 访谈\nsimulated: false\ndate: "2026-10-28"\nattendees: [Senior]\ndecisions: []', '# 无关访谈\n'),
    '20_项目/P/决策/其他决定.md': note('other-d', 'decision', 'decided_by: Senior\ntrigger: "[[团队]]"\nreason: 理由\naffects: []', '# 其他决定\n'),
  });
  for (const path of [REPORT, INTERVIEW, '20_项目/P/决策/先验证.md', '20_项目/P/决策/其他决定.md']) {
    expect((await fx.vault.read(path)).note, `Fixture must pass schema: ${path}`).not.toBeNull();
  }
  mocked.vault = fx.vault;
  cleanup = fx.cleanup;
  return fx;
}
async function page(role: Role) {
  mocked.role = role;
  const { default: Page } = await import('@/app/workspace/[project]/[workspace]/research/[name]/page');
  return renderToString(await Page({ params: Promise.resolve({ project: 'P', workspace: 'WS-A', name: 'R1' }), searchParams: Promise.resolve({ step: 'stored' }) })).replace(/<!-- -->/g, '');
}
describe('T42 stored project outputs', () => {
  it('ui-4f: all text and testids; exactly the associated report, decision and interview', async () => {
    await fixture();
    const out = await page(ROLES.senior);
    for (const t of ['第 7 步 · 存入项目文件', '存入项目文件的 项目产出', '同一项目里的其他工作区看得到', '发布为公司资产']) expect(out, t).toContain(t);
    for (const id of ['step-stored', 'stored-list', 'publish-asset']) expect(out, id).toContain(`data-testid="${id}"`);
    expect([...out.matchAll(/data-testid="stored-item" data-kind="([^"]+)"/g)].map((m) => m[1])).toEqual(['报告', '决定', '访谈']);
    expect(out).not.toContain('（Senior 可见）');
    expect(out).not.toContain('无关访谈');
    expect(out).not.toContain('其他决定');
    expect(out).not.toMatch(/\[\[|#\^|项目\.md/);
  });
  it('a Junior sees the same outputs, no publish control', async () => {
    await fixture();
    const out = await page(ROLES.juniorA);
    expect(out).toContain('data-testid="stored-list"');
    expect(out.match(/data-testid="stored-item"/g)).toHaveLength(3);
    expect(out).not.toContain('data-testid="publish-asset"');
  });
  it('does not call an unconfirmed report stored', async () => {
    await fixture(false);
    const out = await page(ROLES.juniorA);
    expect(out).not.toContain('data-testid="stored-item"');
    expect(out).not.toContain('data-testid="step-stored"');
  });
});
