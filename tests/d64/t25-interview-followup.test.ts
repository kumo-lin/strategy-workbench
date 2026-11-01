/**
 * D-64 T25: interviews come in, the AI finds the judgments they touch, re-judges only those (never up to 成立) and
 * writes v2 with a table of what changed. No web search.
 */
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Role } from '@/lib/config/roles';
import { executeResearch } from '@/lib/research/execute';
import { executeInterviewFollowUp, INTERVIEW_HITS_FILE, saveInterview, validHits } from '@/lib/research/interview-followup';
import { judgmentFilePath } from '@/lib/research/judgment-file';
import { clearPageCache } from '@/lib/research/page-cache';
import { createMockModel } from '@/lib/testing/mock-model';
import type { Vault } from '@/lib/vault';
import { POST } from '@/app/api/research/interviews/route';
import { ROLES } from '../helpers/fixture-vault';
import { fakeWeb, RDIR, scriptedModel, setup, WS } from '../m2/research-fixture';

const mocked = vi.hoisted(() => ({ vault: null as unknown as Vault, role: null as unknown as Role }));
vi.mock('@/lib/session/role', () => ({ getCurrentRole: async () => mocked.role }));
vi.mock('@/lib/vault', async (orig) => ({ ...(await orig<typeof import('@/lib/vault')>()), getVault: () => mocked.vault }));

const HEAVY = '访谈-多设备重度用户';
const PRIVACY = '访谈-隐私与信任团队负责人';
const TEXT = (name: string) => `# ${name}\n\n## 问：哪类事你不会交给 AI？\n\n受访者：日历可以给它看，但不让它代发邮件。\n`;

let cleanup: (() => Promise<void>) | null = null;
beforeEach(() => {
  clearPageCache();
  vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 200 })));
});
afterEach(async () => {
  vi.unstubAllGlobals();
  await cleanup?.();
  cleanup = null;
});

/** v1: a delivered report in the fixed structure; its judgments set to C1 成立 (K1), C2 证据不足 and C3 不成立 (K3), C4 需要修改 (K4). */
async function withV1() {
  const fx = await setup({ keys: ['K1', 'K3', 'K3', 'K4'], subQuestions: 1 });
  cleanup = fx.cleanup;
  mocked.vault = fx.vault;
  const extra = (k: string | undefined) => ({
    reasons: [{ title: 'IT 部门拍板', basis: [{ text: '采购由 IT 部门主导', kind: '事实', source: '资料甲', refs: k ? [k] : [] }] }],
    gaps: [{ question: 'K3 跨设备是否解决真实问题？', missing: '没有留存对比', how: '访谈' }],
    recommendations: [{ title: '先打 IT 管理场景', how: '先找 IT 部门试点', refs: ['H1'] }],
  });
  const r = await executeResearch({ ctx: fx.ctx, mode: 'full', model: scriptedModel({ summaryExtra: extra }).model, webClient: fakeWeb() });
  expect(r.delivered).toBe(true);
  const jf = path.join(fx.root, judgmentFilePath(r.reportPath));
  const file = JSON.parse(await readFile(jf, 'utf8'));
  const set: Record<string, string> = { C1: '成立', C2: '证据不足', C3: '不成立', C4: '需要修改' };
  for (const c of file.claims) c.verdict = set[c.claimId];
  await writeFile(jf, JSON.stringify(file));
  return { ...fx, v1: r.reportPath };
}

async function interview(fx: Awaited<ReturnType<typeof withV1>>, name: string) {
  return (await saveInterview(fx.vault, ROLES.juniorA, WS, { name, content: TEXT(name), simulated: true })).path;
}

const run = async (fx: Awaited<ReturnType<typeof withV1>>, names: string[]) => {
  const paths = [];
  for (const n of names) paths.push(await interview(fx, n));
  const r = await executeInterviewFollowUp({ ctx: fx.ctx, interviews: paths, model: createMockModel() });
  return { r, body: (await fx.vault.read(r.reportPath)).body };
};

describe('T25 upload', () => {
  const post = (b: unknown) => POST(new Request('http://x/api/research/interviews', { method: 'POST', body: JSON.stringify(b) }));

  it('1. .md and .txt are saved as 访谈/<name>.md with simulated as ticked; anything else is 415', async () => {
    const fx = await setup();
    cleanup = fx.cleanup;
    mocked.vault = fx.vault;
    mocked.role = ROLES.juniorA;
    const res = await post({ workspacePath: WS, simulated: false, files: [{ filename: '访谈-甲.md', content: '# 访谈-甲\n\n问答\n' }, { filename: '访谈-乙.txt', content: '问：…\n答：…' }] });
    expect(res.status).toBe(200);
    const a = await fx.vault.read('20_项目/P/访谈/访谈-甲.md');
    expect(a.data).toMatchObject({ type: 'meeting', kind: '访谈', simulated: false });
    expect((await fx.vault.read('20_项目/P/访谈/访谈-乙.md')).body).toContain('答：…');
    expect((await post({ workspacePath: WS, simulated: true, files: [{ filename: '访谈.pdf', content: 'x' }] })).status).toBe(415);
    mocked.role = ROLES.juniorB;
    expect((await post({ workspacePath: WS, simulated: true, files: [{ filename: '访谈-丙.md', content: 'x' }] })).status).toBe(403);
    // with an investigation that has no report yet: the follow-up cannot run (409)
    mocked.role = ROLES.juniorA;
    expect((await post({ workspacePath: WS, researchDir: RDIR, simulated: true, files: [{ filename: '访谈-丁.md', content: 'x' }] })).status).toBe(409);
  });
});

describe('T25 the follow-up', () => {
  it('2. which judgments each interview touches: ids must exist and the reason must be there; written to 访谈命中.json', async () => {
    expect(validHits({ claims: ['C2', 'C9'], reason: '提到了' }, ['C1', 'C2'])).toEqual({ claims: ['C2'], reason: '提到了' });
    expect(validHits({ claims: ['C2'], reason: ' ' }, ['C2'])).toBeNull();
    expect(validHits({ claims: ['C2'], reason: '提到了', by_claim: { C2: '说了甲', C1: '没命中的不留' } }, ['C1', 'C2'])).toEqual({ claims: ['C2'], reason: '提到了', says: { C2: '说了甲' } });
    expect(validHits({ claims: ['C9'], reason: 'x' }, ['C2'])).toBeNull();
    const fx = await withV1();
    await run(fx, [HEAVY]);
    const hits = JSON.parse(await readFile(path.join(fx.root, RDIR, INTERVIEW_HITS_FILE), 'utf8'));
    expect(hits).toEqual([{ interview: HEAVY, claims: ['C2', 'C3', 'C4'], reason: expect.stringMatching(/\S/), says: expect.objectContaining({ C2: expect.stringMatching(/\S/) }) }]); // 复核 B3: what it said, per judgment
  });

  it('3. only the touched judgments are judged again; the others say 沿用 v1', async () => {
    const fx = await withV1();
    const { r, body } = await run(fx, [HEAVY]);
    expect(r.rejudged.sort()).toEqual(['C2', 'C3', 'C4']);
    expect(body).toMatch(/^- H1：沿用 v1/m);
    expect(body).toMatch(/^- H2：证据不足 → 访谈支持/m);
  });

  it('4. only the privacy team\'s interview: only K4 is judged again', async () => {
    const fx = await withV1();
    const { r } = await run(fx, [PRIVACY]);
    expect(r.rejudged).toEqual(['C4']);
  });

  it('5. the change table: So what, then each key question v1 and v2; untouched ones 不变（访谈没有涉及）', async () => {
    const fx = await withV1();
    const { body } = await run(fx, [HEAVY]);
    const lines = body.split('\n');
    const at = lines.indexOf('## 因为追加了访谈，结论变了什么');
    expect(at).toBeGreaterThan(0);
    const table = lines.slice(at + 1).filter((l) => l.startsWith('|'));
    expect(table[0]).toBe('| | v1 | v2 |');
    expect(table[2]).toMatch(/^\| So what \| .+ \| .+ \|$/);
    expect(table).toContain('| K1 | 成立 | 不变（访谈没有涉及） |');
    expect(table).toContain('| K3 | 证据不足 | 访谈支持 |');
    expect(table).toContain('| K4 | 部分支持 | 部分支持 |');
  });

  it('6. an interview never lifts a judgment to 成立', async () => {
    const fx = await withV1();
    const { r } = await run(fx, [HEAVY]);
    expect(r.verdicts).toEqual({ C1: '成立', C2: '访谈支持', C3: '不成立', C4: '需要修改' });
  });

  it('7. no new web search', async () => {
    const fx = await withV1();
    const before = (await fx.vault.readLog(`${WS}/日志.md`)).length;
    await run(fx, [HEAVY, PRIVACY]);
    const after = (await fx.vault.readLog(`${WS}/日志.md`)).slice(before);
    expect(after.some((e) => e.action === 'research:interview-followup')).toBe(true);
    expect(after.filter((e) => /^tool:(web_search|web_fetch|ingest_source)$/.test(e.action))).toEqual([]);
  });
});
