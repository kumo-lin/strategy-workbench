/** D-64 T17: a decision carries 适用边界; the Senior edits it as three fields (决定, 理由, 适用边界), confirms or returns it. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Role } from '@/lib/config/roles';
import { executeTool, type ToolContext } from '@/lib/harness';
import type { Vault } from '@/lib/vault';
import { ctxFor, DECISIONS, GOOD_DRAFT, makeM3Vault, REPORT, ROLES } from '../m3/fixture';

const SCOPE = '适用于个人用户市场；不适用于企业采购。';
const draftPath = `${DECISIONS}/${GOOD_DRAFT.name}.md`;

let vault: Vault;
let cleanup: () => Promise<void>;
let ctx: ToolContext;
const mocked = vi.hoisted(() => ({ vault: null as unknown as Vault, role: null as unknown as Role }));
vi.mock('@/lib/session/role', () => ({ getCurrentRole: async () => mocked.role }));
vi.mock('@/lib/vault', async (orig) => ({ ...(await orig<typeof import('@/lib/vault')>()), getVault: () => mocked.vault }));

beforeEach(async () => {
  ({ vault, cleanup } = await makeM3Vault());
  mocked.vault = vault;
  mocked.role = ROLES.senior;
  ctx = await ctxFor(vault, ROLES.senior);
});
afterEach(async () => cleanup());

const propose = (args: Record<string, unknown> = {}) => executeTool('propose_decision', { ...GOOD_DRAFT, report: REPORT, why: '起草', ...args }, ctx);
const post = async (body: object) => {
  const { POST } = await import('@/app/api/decision/confirm/route');
  return POST(new Request('http://x/api/decision/confirm', { method: 'POST', body: JSON.stringify(body) }));
};

describe('T17 decision scope', () => {
  it('1. proposeDecision without scope is refused', async () => {
    await expect(propose({ scope: undefined })).rejects.toThrow(/scope|适用边界/);
    await expect(propose({ scope: '  ' })).rejects.toThrow(/scope|适用边界/);
  });

  it('2. the body has 适用边界 after 理由, the frontmatter has scope', async () => {
    await propose({ scope: SCOPE });
    const n = await vault.read(draftPath);
    expect(n.data.scope).toBe(SCOPE);
    const order = ['## 决定', '## 理由', '## 适用边界'].map((h) => n.body.indexOf(h));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(n.body.split('## 适用边界')[1]).toContain(SCOPE);
  });

  it('3. /api/decision/confirm takes the three fields and writes each back to its section', async () => {
    await propose({ scope: SCOPE });
    const card = (await (await post({ decision: draftPath, action: 'save', fields: { decision: '先验证高频场景。', reason: (await vault.read(draftPath)).body.split('## 理由')[1].split('\n## ')[0].trim(), scope: '只适用于 2027 年。' } })).json()) as { card: { body: string; fields: Record<string, string> } };
    expect(card.card.fields).toMatchObject({ decision: '先验证高频场景。', scope: '只适用于 2027 年。' });
    const n = await vault.read(draftPath);
    expect(n.body.split('## 决定')[1].split('\n## ')[0].trim()).toBe('先验证高频场景。');
    expect(n.body.split('## 适用边界')[1].split('\n## ')[0].trim()).toBe('只适用于 2027 年。');
    expect(n.data.scope).toBe('只适用于 2027 年。');
    expect(n.data.status).toBe('推断');
    const confirmed = await post({ decision: draftPath, action: 'confirm', fields: { decision: '先验证高频场景。', reason: n.body.split('## 理由')[1].split('\n## ')[0].trim(), scope: '只适用于 2027 年。' } });
    expect(confirmed.status).toBe(200);
    expect((await vault.read(draftPath)).data.status).toBe('已确认');
  });

  it('4. return needs a reason (400 without one); with one, the draft goes back', async () => {
    await propose({ scope: SCOPE });
    expect((await post({ decision: draftPath, action: 'return' })).status).toBe(400);
    const res = await post({ decision: draftPath, action: 'return', reason: '适用边界写得太宽' });
    expect(res.status).toBe(200);
    const n = await vault.read(draftPath);
    expect(n.data.status).toBe('已否决');
    expect(n.data.return_reason).toBe('适用边界写得太宽');
  });
});
