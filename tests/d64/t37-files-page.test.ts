/** D-64 T37 (ui-3, ui-5): the files page — five groups, tick and star, the web switch, and 按你的任务找资料. */
import { renderToString } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Role } from '@/lib/config/roles';
import { buildToolContext, executeTool } from '@/lib/harness';
import { PHASE_TOOLS } from '@/lib/harness/phases';
import { readSelection, writeSelection } from '@/lib/research/selection';
import { createMockModel } from '@/lib/testing/mock-model';
import type { Vault } from '@/lib/vault';
import { makeFixtureVault, ROLES } from '../helpers/fixture-vault';

const mocked = vi.hoisted(() => ({ vault: null as unknown as Vault, role: null as unknown as Role }));
vi.mock('@/lib/session/role', async (orig) => ({ ...(await orig<typeof import('@/lib/session/role')>()), getCurrentRole: async () => mocked.role }));
vi.mock('@/lib/vault', async (orig) => ({ ...(await orig<typeof import('@/lib/vault')>()), getVault: () => mocked.vault }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh() {} }), usePathname: () => '/x', notFound: () => {} }));
vi.mock('@/lib/models/provider', async (orig) => ({ ...(await orig<typeof import('@/lib/models/provider')>()), getModel: async () => ({ model: createMockModel(), providerId: 'mock', label: 'mock', model_id: 'mock' }) }));

const WS = '20_项目/P/WS-A';
const DECISION = `---
id: d-m1
type: decision
status: 已确认
created: "2026-10-28"
updated: "2026-10-28"
author: AI
derived_from: ["[[20_项目/P/项目|项目]]"]
relates_to: ["[[20_项目/P/项目|项目]]"]
decided_by: Senior
trigger: "[[20_项目/P/项目|项目]]"
reason: 因为
affects: []
scope: 拿到数据前有效
---
# 跨设备先分场景验证

## 决定

跨设备先分场景验证。
`;
let cleanup: () => Promise<void> = async () => {};
afterEach(async () => cleanup());

async function fixture() {
  const fx = await makeFixtureVault({ '20_项目/P/决策/跨设备先分场景验证.md': DECISION });
  cleanup = fx.cleanup;
  mocked.vault = fx.vault;
  return fx;
}
const page = async (role: Role) => {
  mocked.role = role;
  const { default: Page } = await import('@/app/workspace/[project]/[workspace]/files/page');
  return renderToString((await Page({ params: Promise.resolve({ project: 'P', workspace: 'WS-A' }), searchParams: Promise.resolve({}) })) as never).replace(/<!-- -->/g, '');
};

describe('T37 the files page', () => {
  it('every text and testid of ui-3; the groups in order; ticks and stars from 资料选择.json', async () => {
    const fx = await fixture();
    await writeSelection(fx.vault, ROLES.juniorA, WS, { excluded: ['10_资料库/资料甲.md'], starred: ['20_项目/P/决策/跨设备先分场景验证.md'], web: false });
    const out = await page(ROLES.juniorA);
    for (const t of ['默认全选 · 取消勾选的 AI 不读 · ★ 为优先阅读', '＋ 上传文件', '项目产出', '项目背景', '公司资料', '公开数据源', '公司资产', '按你的任务找资料']) expect(out, t).toContain(t);
    expect([...out.matchAll(/data-testid="files-group" data-group="(\w+)"/g)].map((m) => m[1])).toEqual(['outputs', 'background', 'company', 'public', 'assets']);
    for (const id of ['file-row', 'file-check', 'file-star', 'web-toggle', 'files-chat']) expect(out, id).toContain(`data-testid="${id}"`);
    expect(out).toMatch(/data-path="10_资料库\/资料甲.md" data-checked="false" data-starred="false"/);
    expect(out).toMatch(/data-path="20_项目\/P\/决策\/跨设备先分场景验证.md" data-checked="true" data-starred="true"/);
  });

  it('someone who is not the owner sees it, cannot change it', async () => {
    await fixture();
    const out = await page(ROLES.juniorB);
    expect(out).not.toContain('＋ 上传文件');
    expect(out).toMatch(/data-testid="file-check"[^>]*disabled/);
  });
});

describe('T37 the files chat', () => {
  it('files_chat offers only read_task_context, vault_search, set_selection', () => {
    expect([...PHASE_TOOLS.files_chat].sort()).toEqual(['read_task_context', 'set_selection', 'vault_search']);
  });

  it('set_selection only proposes: 资料选择.json is unchanged until the analyst agrees on the card', async () => {
    const fx = await fixture();
    const ctx = await buildToolContext({ vault: fx.vault, role: ROLES.juniorA, workspacePath: WS, track: 'files' });
    expect(ctx.phase).toBe('files_chat');
    const out = (await executeTool('set_selection', { exclude: ['10_资料库/资料甲.md', '10_资料库/没有这份.md'], web: false, reason: '和任务无关', why: 'x' }, ctx)) as { applied: boolean; changes: string[]; unknown: string[]; proposal: { excluded: string[]; web: boolean } };
    expect(out).toMatchObject({ applied: false, changes: ['不读：资料甲', '关掉联网'], unknown: ['10_资料库/没有这份.md'], proposal: { excluded: ['10_资料库/资料甲.md'], web: false } });
    expect(await readSelection(fx.vault, WS)).toEqual({ version: 1, excluded: [], starred: [], web: true });
  });

  it('the first reply lists what to read for the task, the confirmed decision first (ui-5)', async () => {
    await fixture();
    mocked.role = ROLES.juniorA;
    const { POST } = await import('@/app/api/agent/route');
    const res = await POST(new Request('http://x/api/agent', { method: 'POST', body: JSON.stringify({ workspacePath: WS, track: 'files', messages: [{ id: 'u1', role: 'user', parts: [{ type: 'text', text: '这次要先读什么？' }] }] }) }));
    expect(res.status).toBe(200);
    const text = await res.text();
    expect([...new Set([...text.matchAll(/"toolName":"([a-z_]+)"/g)].map((m) => m[1]))]).toEqual(['read_task_context', 'vault_search']);
    expect(text).toMatch(/① 跨设备先分场景验证（项目里已确认的决定/);
  });
});

describe('T37 saving', () => {
  it('a newer server selection (after the chat\'s 同意) is told apart by value, not by object identity', async () => {
    const { sameSelection } = await import('@/components/files/files-manager');
    const a = { version: 1 as const, excluded: ['10_资料库/资料甲.md'], starred: [], web: true };
    expect(sameSelection(a, { ...a, excluded: [...a.excluded] })).toBe(true);
    expect(sameSelection(a, { ...a, excluded: [] })).toBe(false);
    expect(sameSelection(a, { ...a, starred: ['x.md'] })).toBe(false);
    expect(sameSelection(a, { ...a, web: false })).toBe(false);
  });

  it('two saves at the same moment both land (each writes its own temp file)', async () => {
    const fx = await fixture();
    await Promise.all([
      writeSelection(fx.vault, ROLES.juniorA, WS, { excluded: ['10_资料库/资料甲.md'], starred: [], web: true }),
      writeSelection(fx.vault, ROLES.juniorA, WS, { excluded: ['10_资料库/资料甲.md'], starred: [], web: false }),
    ]);
    expect((await readSelection(fx.vault, WS)).excluded).toEqual(['10_资料库/资料甲.md']);
  });
});
