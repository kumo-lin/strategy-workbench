/** D-64 T32: the home page is project cards (counts from the vault); /inbox lists what waits on you (ui-0a, ui-2b). */
import { writeFile } from 'node:fs/promises';
import { renderToString } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Role } from '@/lib/config/roles';
import { loadInbox } from '@/lib/inbox';
import { loadProjectCards } from '@/lib/project/cards';
import type { Vault } from '@/lib/vault';
import { makeFixtureVault, ROLES } from '../helpers/fixture-vault';

const mocked = vi.hoisted(() => ({ vault: null as unknown as Vault, role: null as unknown as Role }));
vi.mock('@/lib/session/role', async (orig) => ({ ...(await orig<typeof import('@/lib/session/role')>()), getCurrentRole: async () => mocked.role }));
vi.mock('@/lib/vault', async (orig) => ({ ...(await orig<typeof import('@/lib/vault')>()), getVault: () => mocked.vault }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh() {}, push() {} }), usePathname: () => '/inbox' }));

const fm = (s: string) => `---\n${s.trim()}\n---\n`;
const review = (gate: string, name: string, result = 'null') =>
  `${fm(`
id: rev-${gate === "G1" ? "g1" : "jl"}-${result === "null" ? "open" : "done"}-${name.slice(-2)}
type: review
status: 进行中
created: "2026-10-27"
updated: "2026-10-27"
author: Junior A
derived_from: ["[[20_项目/P/WS-A/workplan v1|workplan v1]]"]
relates_to: ["[[20_项目/P/WS-A/workspace|WS-A]]"]
requester: Junior A
reviewer: Senior
result: ${result}
gate: ${gate}
version: 1
`)}\n# ${name}\n\n## Comment\n`;
const report = (n: number) =>
  `${fm(`
id: r${n}
type: report
status: 进行中
created: "2026-10-27"
updated: "2026-10-27"
author: AI
derived_from: ["[[20_项目/P/WS-A/workplan v1|workplan v1]]"]
relates_to: ["[[20_项目/P/WS-A/workspace|WS-A]]"]
version: ${n}
research_plan: null
mode: team
exploratory: false
delivery: 已交付
`)}\n# 报告 v${n}\n`;
const decision = (status: string) =>
  `${fm(`
id: d-${status}
type: decision
status: ${status}
created: "2026-10-27"
updated: "2026-10-27"
author: AI
derived_from: ["[[20_项目/P/项目|项目]]"]
relates_to: ["[[20_项目/P/项目|项目]]"]
decided_by: ${status === '已确认' ? 'Senior' : 'null'}
trigger: "[[20_项目/P/项目|项目]]"
reason: 因为
affects: []
`)}\n# 决定\n`;

let cleanup: () => Promise<void> = async () => {};
afterEach(async () => cleanup());

async function vaultWithWork() {
  const fx = await makeFixtureVault({
    '20_项目/P/WS-A/review/G1 2026-10-27.md': review('G1', 'G1 2026-10-27'),
    '20_项目/P/WS-A/review/结论 2026-10-27.md': review('结论', '结论 2026-10-27'),
    '20_项目/P/WS-B/review/G1 2026-10-20.md': review('G1', 'G1 2026-10-20', '通过'),
    '20_项目/P/WS-A/调查/R1/报告 v1.md': report(1),
    '20_项目/P/WS-A/调查/R1/报告 v2.md': report(2),
    '20_项目/P/决策/定了.md': decision('已确认'),
    '20_项目/P/决策/草稿.md': decision('推断'),
  });
  cleanup = fx.cleanup;
  mocked.vault = fx.vault;
  return fx;
}
const html = async (el: Promise<unknown> | unknown) => renderToString((await el) as never).replace(/<!-- -->/g, '');

describe('T32 home', () => {
  it('counts come from the vault: workspaces, reports, confirmed decisions', async () => {
    const fx = await vaultWithWork();
    expect(await loadProjectCards(fx.vault)).toEqual([expect.objectContaining({ project: 'P', workspaces: 2, reports: 2, decisions: 1 })]);
  });

  it('the page: 我的项目, ＋ 新建项目 → /new, the note, one card per project with its counts; no vault tree', async () => {
    await vaultWithWork();
    mocked.role = ROLES.senior;
    const { default: Home } = await import('@/app/page');
    const out = await html(Home());
    for (const t of ['我的项目', '＋ 新建项目', '新项目会自动读取团队资料库和以往已确认的决定']) expect(out).toContain(t);
    expect(out).toMatch(/data-testid="new-project"[^>]*href="\/new"|href="\/new"[^>]*data-testid="new-project"/);
    expect(out).toMatch(/data-testid="project-card"[^>]*data-project="P"|data-project="P"[^>]*data-testid="project-card"/);
    expect(out).toContain('data-testid="project-card-counts"');
    expect(out).not.toContain('vault-tree');
  });
});

describe('T32 inbox', () => {
  it('what waits on Senior: the plan to give an opinion on, the report to confirm; nothing for Junior B', async () => {
    const fx = await vaultWithWork();
    const items = await loadInbox(fx.vault, ROLES.senior);
    expect(items.map((i) => [i.kind, i.workspace])).toEqual([
      ['opinion', 'WS-A'],
      ['confirm', 'WS-A'],
    ]);
    expect(await loadInbox(fx.vault, ROLES.juniorB)).toEqual([]);
  });

  it('the page lists them; one opened for an opinion has the input and the three buttons', async () => {
    const fx = await vaultWithWork();
    mocked.role = ROLES.senior;
    const { default: Inbox } = await import('@/app/inbox/page');
    const list = await html(Inbox({ searchParams: Promise.resolve({}) }));
    for (const t of ['待你处理', '研究计划只是来征求意见，不卡流程；报告要你确认，确认以后才会作为项目产出存入文件管理']) expect(list).toContain(t);
    expect(list.match(/data-testid="inbox-item"/g)).toHaveLength(2);
    const [opinion] = await loadInbox(fx.vault, ROLES.senior);
    const open = await html(Inbox({ searchParams: Promise.resolve({ open: opinion.reviewPath }) }));
    for (const id of ['opinion-input', 'opinion-later', 'opinion-none', 'opinion-send']) expect(open).toContain(`data-testid="${id}"`);
    for (const t of ['你的意见', '稍后', '看过了，没有意见', '发送意见']) expect(open).toContain(t);
  });

  it('a review written with a full timestamp shows its day, not the raw ISO string (走查截图 2.4)', async () => {
    const fx = await vaultWithWork();
    const path = '20_项目/P/WS-A/review/G1 2026-10-27.md';
    await writeFile(`${fx.root}/${path}`, review('G1', 'G1 2026-10-27').replace('created: "2026-10-27"', 'created: "2026-10-30T03:03:44.535Z"'), 'utf8');
    mocked.role = ROLES.senior;
    const { default: Inbox } = await import('@/app/inbox/page');
    const list = await html(Inbox({ searchParams: Promise.resolve({}) }));
    expect(list).toContain('Junior A · 2026-10-30');
    expect(list).not.toContain('T03:03');
  });
});

