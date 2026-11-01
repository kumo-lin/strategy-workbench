/** D-64 T18: a Senior publishes a confirmed report or decision as a company asset; other projects then see it. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Role } from '@/lib/config/roles';
import { ApprovalDenied } from '@/lib/harness/events';
import { publishAsset } from '@/lib/assets/publish';
import { loadFiles } from '@/lib/workplan/files-view';
import type { Vault } from '@/lib/vault';
import { makeFixtureVault, ROLES } from '../helpers/fixture-vault';

const note = (lines: string, body = '# x\n') => `---\n${lines.trim()}\n---\n${body}`;
const common = (id: string, type: string, extra: string, author = 'Senior', status = '已确认') => `
id: ${id}
type: ${type}
status: ${status}
created: "2026-10-27"
updated: "2026-10-28"
author: ${author}
derived_from: ["[[团队]]"]
relates_to: ["[[团队]]"]
${extra}`;
const report = (id: string) => note(common(id, 'report', 'version: 2\nresearch_plan: null\nmode: team\nexploratory: false', 'AI', '推断'));
const review = (id: string, derived: string) =>
  note(common(id, 'review', 'requester: Junior A\nreviewer: Senior\nresult: 通过\ngate: 结论', 'Junior A').replace('derived_from: ["[[团队]]"]', `derived_from: ["${derived}"]`));

const CONFIRMED = '20_项目/P/WS-A/调查/跨设备/报告 v2.md';
const UNCONFIRMED = '20_项目/P/WS-A/调查/跨设备/报告 v1.md';
const DECISION = '20_项目/P/决策/先验证高频场景.md';

const mocked = vi.hoisted(() => ({ vault: null as unknown as Vault, role: null as unknown as Role }));
vi.mock('@/lib/session/role', () => ({ getCurrentRole: async () => mocked.role }));
vi.mock('@/lib/vault', async (orig) => ({ ...(await orig<typeof import('@/lib/vault')>()), getVault: () => mocked.vault }));

let vault: Vault;
let cleanup: () => Promise<void>;
beforeEach(async () => {
  ({ vault, cleanup } = await makeFixtureVault({
    [CONFIRMED]: report('r2'),
    [UNCONFIRMED]: report('r1'),
    '20_项目/P/WS-A/review/结论 2026-10-28.md': review('rev', `[[${CONFIRMED.replace(/\.md$/, '')}]]`),
    [DECISION]: note(common('dec', 'decision', `decided_by: Senior\ntrigger: "[[${CONFIRMED.replace(/\.md$/, '')}]]"\nreason: 理由\naffects: []`, 'AI')),
    '20_项目/Q/项目.md': note(common('proj-q', 'project', 'owner: Senior\nsponsor: VP\ncore_question: 问题？')),
    '20_项目/Q/WS-X/workspace.md': note(common('ws-x', 'workspace', 'owner: Junior B\nreviewer: Senior\nstage: 拆题中\nflags: []\ndepends_on: []')),
  }));
  mocked.vault = vault;
});
afterEach(async () => cleanup());

const NOW = new Date('2026-10-28T10:00:00Z');

describe('T18 publish as a company asset', () => {
  it('a Senior publishes: published_by and published_at are written, the log says asset.publish', async () => {
    await publishAsset(vault, ROLES.senior, CONFIRMED, NOW);
    const n = await vault.read(CONFIRMED);
    expect(n.data).toMatchObject({ published_by: 'Senior', published_at: '2026-10-28' });
    expect((await vault.readLog('20_项目/P/WS-A/日志.md')).some((e) => e.action === 'asset.publish')).toBe(true);
    await publishAsset(vault, ROLES.senior, DECISION, NOW);
    expect((await vault.read(DECISION)).data.published_by).toBe('Senior');
  });

  it('a Junior gets 403', async () => {
    await expect(publishAsset(vault, ROLES.juniorA, CONFIRMED, NOW)).rejects.toBeInstanceOf(ApprovalDenied);
    mocked.role = ROLES.juniorA;
    const { POST } = await import('@/app/api/asset/publish/route');
    const res = await POST(new Request('http://x/api/asset/publish', { method: 'POST', body: JSON.stringify({ path: CONFIRMED }) }));
    expect(res.status).toBe(403);
  });

  it('an unconfirmed report cannot be published', async () => {
    await expect(publishAsset(vault, ROLES.senior, UNCONFIRMED, NOW)).rejects.toThrow(/确认/);
    mocked.role = ROLES.senior;
    const { POST } = await import('@/app/api/asset/publish/route');
    const res = await POST(new Request('http://x/api/asset/publish', { method: 'POST', body: JSON.stringify({ path: UNCONFIRMED }) }));
    expect(res.status).toBe(409);
  });

  it("once published, another project's files show it under assets", async () => {
    expect((await loadFiles(vault, '20_项目/Q/WS-X', '/x')).assets).toEqual([]);
    await publishAsset(vault, ROLES.senior, CONFIRMED, NOW);
    expect((await loadFiles(vault, '20_项目/Q/WS-X', '/x')).assets.map((a) => a.path)).toEqual([CONFIRMED]);
  });
});
