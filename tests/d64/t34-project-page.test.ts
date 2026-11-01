/** D-64 T34 (ui-1): the project page — the decision contract on top, the issue tree left to right, 确定，指派负责人. */
import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { renderToString } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Role } from '@/lib/config/roles';
import { confirmContract, loadProjectPage } from '@/lib/project/contract';
import { createVault, type Vault } from '@/lib/vault';
import { ApprovalDenied } from '@/lib/harness/events';

const mocked = vi.hoisted(() => ({ vault: null as unknown as Vault, role: null as unknown as Role }));
vi.mock('@/lib/session/role', async (orig) => ({ ...(await orig<typeof import('@/lib/session/role')>()), getCurrentRole: async () => mocked.role }));
vi.mock('@/lib/vault', async (orig) => ({ ...(await orig<typeof import('@/lib/vault')>()), getVault: () => mocked.vault }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh() {} }), usePathname: () => '/project/x', notFound: () => {} }));

const P = '个人AI战略';
const SENIOR: Role = { id: 'senior', name: 'Senior', kind: 'senior' };
const JUNIOR: Role = { id: 'junior-a', name: '分析师甲', kind: 'junior' };
let root = '';
afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
  root = '';
});
async function m1() {
  root = await mkdtemp(path.join(tmpdir(), 't34-'));
  await cp('demo-vault/.snapshots/m1-qira', root, { recursive: true });
  mocked.vault = createVault(root);
  return mocked.vault;
}

describe('T34 project page', () => {
  it('the issue tree: each item says where it is (未开始, 深挖中, 等 M1 的决定)', async () => {
    const page = await loadProjectPage(await m1(), P);
    expect(page.contract?.question).toContain('联想应在个人 AI 中占据什么战略位置');
    const item = (id: string) => page.tree!.lines.flatMap((l) => l.items).find((i) => i.id === id)!;
    expect(item('M1')).toMatchObject({ status: 'active', label: '深挖中' });
    expect(item('M2')).toMatchObject({ status: 'todo', label: '未开始' });
    expect(item('L2')).toMatchObject({ status: 'waiting', label: '等 M1 的决定' });
  });

  it('the page: every text and testid of ui-1; no roadmap, no dependencies', async () => {
    await m1();
    mocked.role = SENIOR;
    const { default: Page } = await import('@/app/project/[name]/page');
    const out = renderToString((await Page({ params: Promise.resolve({ name: encodeURIComponent(P) }) })) as never).replace(/<!-- -->/g, '');
    for (const t of ['决策契约', '原题', '决策负责人', '时间', '要做的决定', '地域', '产品范围', '不研究', '议题树与工作线', '要回答的问题', '确定，指派负责人']) expect(out, t).toContain(t);
    for (const id of ['contract-card', 'issue-tree', 'issue-line', 'issue-item', 'assign-owners']) expect(out, id).toContain(`data-testid="${id}"`);
    expect(out).toMatch(/data-testid="issue-line"[^>]*data-line="A"|data-line="A"[^>]*data-testid="issue-line"/);
    expect(out).toMatch(/data-item="L2"[^>]*data-status="waiting"|data-status="waiting"[^>]*data-item="L2"/);
    expect(out).toContain('等 M1 的决定');
    expect(out).not.toContain('data-testid="roadmap"');
    expect(out).not.toContain('data-testid="dependencies"');
  });

  it('only the Senior confirms: the contract becomes 已确认 with who and when', async () => {
    const vault = await m1();
    await expect(confirmContract(vault, JUNIOR, P, new Date('2026-10-28T09:00:00Z'))).rejects.toBeInstanceOf(ApprovalDenied);
    await confirmContract(vault, SENIOR, P, new Date('2026-10-28T09:00:00Z'));
    expect((await vault.read(`20_项目/${P}/决策契约.md`)).data).toMatchObject({ status: '已确认', approved_by: 'Senior', approved_at: '2026-10-28' });
  });

  it('a project without an issue tree keeps the older page', async () => {
    const vault = createVault(path.resolve('demo-vault/.snapshots/S3-D48'));
    mocked.vault = vault;
    expect((await loadProjectPage(vault, P)).tree).toBeNull();
  });
});
