/**
 * M3 3.4 acceptance (mock model, fixture vault):
 *   - Junior B opens a new Deep Research in WS-B: the CONFIRMED decision from WS-A shows up as a tool card
 *     (found along relates_to) and the report cites it
 *   - a decision still in 推断 does not show up anywhere
 *   - a non-Senior confirming gets 403 and nothing changes
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Role } from '@/lib/config/roles';
import { draftDecision } from '@/lib/decisions/draft';
import { confirmDecision, decisionsOfReport } from '@/lib/decisions/review';
import { findRelatedDecisions } from '@/lib/decisions/retrieve';
import { ApprovalDenied } from '@/lib/harness/events';
import { executeResearch } from '@/lib/research/execute';
import { clearPageCache } from '@/lib/research/page-cache';
import type { ProgressEvent } from '@/lib/research/progress';
import type { Vault } from '@/lib/vault';
import { fakeWeb, scriptedModel } from '../m2/research-fixture';
import { confirmedDecision, ctxFor, DECISIONS, GOOD_DRAFT, jsonModel, makeM3Vault, RDIR_B, REPORT, reportWithInsufficient, ROLES, WS_A, WS_B } from './fixture';

let vault: Vault;
let cleanup: () => Promise<void>;
beforeEach(async () => {
  clearPageCache();
  vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 200 })));
  ({ vault, cleanup } = await makeM3Vault());
});
afterEach(async () => {
  vi.unstubAllGlobals();
  vi.doUnmock('@/lib/session/role');
  await cleanup();
});

const { report: _report, ...DRAFT_JSON } = { ...GOOD_DRAFT, report: '' };
const decisionPath = `${DECISIONS}/${GOOD_DRAFT.name}.md`;

async function draft() {
  return draftDecision({ ctx: await ctxFor(vault, ROLES.senior), reportPath: REPORT, model: jsonModel(DRAFT_JSON).model });
}

/** Junior B runs a small Deep Research in WS-B; returns the tool cards and the stored report. */
async function juniorBResearch() {
  const ctx = await ctxFor(vault, ROLES.juniorB, WS_B, RDIR_B);
  expect(ctx.phase).toBe('research_execute');
  const events: ProgressEvent[] = [];
  const result = await executeResearch({ ctx, mode: 'small', model: scriptedModel().model, webClient: fakeWeb(), emit: (e) => events.push(e) });
  const cards = events.filter((e): e is Extract<ProgressEvent, { kind: 'tool-start' }> => e.kind === 'tool-start');
  const report = await vault.read(result.reportPath);
  return { ctx, events, cards, result, report };
}

const decisionCards = (cards: { tool: string; input: unknown }[], name: string) => cards.filter((c) => c.tool === 'vault_read' && JSON.stringify(c.input).includes(name));

describe('3.2: Senior drafts from the report, AI never confirms', () => {
  it('draftDecision writes a 推断 note through propose_decision; a Junior cannot ask for it', async () => {
    const r = await draft();
    expect(r.path).toBe(decisionPath);
    expect((await vault.read(decisionPath)).data).toMatchObject({ status: '推断', decided_by: null, author: 'AI' });
    await expect(draftDecision({ ctx: await ctxFor(vault, ROLES.juniorA), reportPath: REPORT, model: jsonModel(DRAFT_JSON).model })).rejects.toBeInstanceOf(ApprovalDenied);
    const listed = await decisionsOfReport(vault, '20_项目/P', REPORT);
    expect(listed.map((d) => [d.name, d.status, d.problems])).toEqual([[GOOD_DRAFT.name, '推断', []]]);
  });

  it('when the model cites something the report never cited, the system rejects and the model gets one more try', async () => {
    const bad = { ...DRAFT_JSON, reasons: [{ kind: '事实', text: '段落论断', cites: ['[[资料甲#^c3]]'] }] };
    let n = 0;
    const m = jsonModel(() => (n++ === 0 ? bad : DRAFT_JSON));
    await draftDecision({ ctx: await ctxFor(vault, ROLES.senior), reportPath: REPORT, model: m.model });
    expect(m.calls).toHaveLength(2);
    expect(m.calls[1]).toContain('报告里没有引用过');
    // the prompt lists the valid targets for "影响" and the blocks the report cited
    expect(m.calls[0]).toContain('20_项目/P/WS-B/workspace|WS-B');
    expect(m.calls[0]).toContain('[[资料甲#^c2]]');
    expect(m.calls[0]).not.toContain('[[资料甲#^c3]]');
    expect((await vault.read(decisionPath)).data.status).toBe('推断');
  });
});

describe('3.2c prompt input', () => {
  it('marks evidence that only backs a 证据不足 claim, and lists the project decision and the 事实/推断 rule', async () => {
    await vault.write(REPORT, { frontmatter: (await vault.read(REPORT)).data, body: reportWithInsufficient().split(/^---\n[\s\S]*?\n---\n/)[1] }, { overwrite: true });
    const m = jsonModel(DRAFT_JSON);
    await draftDecision({ ctx: await ctxFor(vault, ROLES.senior), reportPath: REPORT, model: m.model });
    expect(m.calls[0]).toMatch(/\[\[资料甲#\^c3\]\]（B 级，[^）]*只在证据不足的论点下，不能当理由）/);
    expect(m.calls[0]).not.toMatch(/\[\[资料甲#\^c1\]\]（B 级，[^）]*证据不足/);
    expect(m.calls[0]).toContain('项目要支撑的决策');
    expect(m.calls[0]).toContain('的论点，不能拿来当支撑决定的理由');
  });
});

describe('3.3 + 3.4: Junior B finds the confirmed decision, not the draft', () => {
  it('a 推断 decision does not show up in Junior B\'s tool cards or report; after the Senior confirms it does', async () => {
    await draft();
    const before = await juniorBResearch();
    expect(decisionCards(before.cards, GOOD_DRAFT.name)).toHaveLength(0);
    expect(JSON.stringify(before.events)).not.toContain(GOOD_DRAFT.name);
    expect(before.report.body).not.toContain(GOOD_DRAFT.name);
    expect(before.report.body).toContain('遵循的已确认决定（沿关联找到）：无');

    const done = await confirmDecision({ vault, actor: ROLES.senior, decisionPath });
    expect(done).toMatchObject({ status: '已确认', decidedBy: 'Senior' });
    expect((await vault.read(decisionPath)).data).toMatchObject({ status: '已确认', decided_by: 'Senior' });
    expect((await vault.read(decisionPath)).body).toMatch(/^> \*\*已确认\*\*：Senior 于 2026-\d\d-\d\d 确认/m);
    expect((await vault.read(decisionPath)).body).not.toContain('草稿，状态');
    expect((await vault.readLog(`${WS_A}/日志.md`)).at(-1)).toMatchObject({ actor: 'Senior', action: 'event:decision.confirm' });

    const after = await juniorBResearch();
    expect(after.result.delivered).toBe(true);
    const cards = decisionCards(after.cards, GOOD_DRAFT.name);
    expect(cards).toHaveLength(1);
    expect(cards[0].tool).toBe('vault_read');
    expect((cards[0].input as { path: string; why: string }).path).toBe(decisionPath);
    expect((cards[0].input as { why: string }).why).toMatch(/relates_to/);
    const ends = after.events.filter((e) => e.kind === 'tool-end' && e.ok);
    expect(JSON.stringify(ends)).toContain('买方侧先验证 IT 管理场景');
    expect(after.report.body).toMatch(/遵循的已确认决定（沿关联找到）：“[^”]+”（Senior 确认；[^）]*）\[\[20_项目\/P\/决策\/WS-A决定-先打IT管理场景\|WS-A决定-先打IT管理场景\]\]/);
    // the decision is in the model's context for the run, and the log shows the card
    expect((await vault.readLog(`${WS_B}/日志.md`)).some((r) => r.action === 'tool:vault_read' && r.reason.includes('沿 relates_to'))).toBe(true);
  }, 30_000);

  it('only decisions related to this research are returned: relates_to / affects must reach the project, the workspace, an upstream workspace or its hypotheses', async () => {
    await vault.write(`${DECISIONS}/项目级.md`, { frontmatter: matter(confirmedDecision('项目级', { relates: '"[[20_项目/P/项目|项目]]"', affects: '' })), body: '# 项目级\n\n## 决定\n\n项目级决定\n' });
    await vault.write(`${DECISIONS}/只管WS-A.md`, { frontmatter: matter(confirmedDecision('只管WS-A', { relates: '"[[20_项目/P/WS-A/workspace|WS-A]]"', affects: '' })), body: '# x\n' });
    await vault.write(`${DECISIONS}/影响WS-B.md`, { frontmatter: matter(confirmedDecision('影响WS-B', { relates: '"[[20_项目/P/WS-A/workspace|WS-A]]"', affects: '"[[20_项目/P/WS-B/workspace|WS-B]]"' })), body: '# x\n' });
    await vault.write(`${DECISIONS}/草稿.md`, { frontmatter: matter(confirmedDecision('草稿', { status: '推断' })), body: '# x\n' });
    await vault.write(`${DECISIONS}/已否决.md`, { frontmatter: matter(confirmedDecision('已否决', { status: '已否决' })), body: '# x\n' });
    const ctx = await ctxFor(vault, ROLES.juniorB, WS_B, RDIR_B);
    const found = await findRelatedDecisions(ctx);
    expect(found.map((d) => [d.name, d.rank])).toEqual([['影响WS-B', 0], ['项目级', 2]]);
    expect(found[0].via).toEqual(['affects → 本 Workspace「WS-B」']);
  });
});

function matter(md: string): Record<string, unknown> {
  // confirmedDecision returns a whole note; tests above only need its frontmatter
  const yaml = /^---\n([\s\S]*?)\n---/.exec(md)![1];
  return Object.fromEntries(
    yaml.split('\n').map((l) => {
      const i = l.indexOf(':');
      const k = l.slice(0, i).trim();
      const v = l.slice(i + 1).trim();
      if (v.startsWith('[')) return [k, v === '[]' ? [] : [...v.matchAll(/"(\[\[[^"]+\]\])"/g)].map((m) => m[1])];
      return [k, v === 'null' ? null : v.replace(/^"|"$/g, '')];
    }),
  );
}

describe('3.4: confirming is a Senior-only human event', () => {
  it('a Junior (even the owner) is denied; the decision stays 推断', async () => {
    await draft();
    for (const actor of [ROLES.juniorA, ROLES.juniorB]) {
      await expect(confirmDecision({ vault, actor, decisionPath })).rejects.toBeInstanceOf(ApprovalDenied);
    }
    expect((await vault.read(decisionPath)).data).toMatchObject({ status: '推断', decided_by: null });
  });

  it('POST /api/decision/confirm answers 403 for a Junior and 200 for the Senior', async () => {
    await draft();
    let role: Role = ROLES.juniorB;
    vi.resetModules();
    vi.doMock('@/lib/session/role', () => ({ getCurrentRole: async () => role }));
    vi.doMock('@/lib/vault', async (orig) => ({ ...(await orig<typeof import('@/lib/vault')>()), getVault: () => vault }));
    const { POST } = await import('@/app/api/decision/confirm/route');
    const call = () => POST(new Request('http://x/api/decision/confirm', { method: 'POST', body: JSON.stringify({ decision: decisionPath }) }));

    const denied = await call();
    expect(denied.status).toBe(403);
    expect((await vault.read(decisionPath)).data.status).toBe('推断');

    role = ROLES.senior;
    const ok = await call();
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ status: '已确认', decidedBy: 'Senior' });
    vi.doUnmock('@/lib/vault');
  });

  it('the Senior cannot confirm a draft whose reasons lost their citations (409), but can after fixing the text', async () => {
    await draft();
    const broken = (await vault.read(decisionPath)).body.replace(/^- \*\*推断\*\*：.*$/m, '- **推断**：这一条没有引用');
    await expect(confirmDecision({ vault, actor: ROLES.senior, decisionPath, body: broken })).rejects.toThrow(/还不能确认.*没有报告里的块引用/);
    expect((await vault.read(decisionPath)).data.status).toBe('推断');
    // the broken edit was kept as a draft, not lost
    expect((await vault.read(decisionPath)).body).toContain('这一条没有引用');
    const fixed = broken.replace('这一条没有引用', '这一条有了 “预算主要来自 IT 部门。”（B 级，网络 · AI 定级）[[资料甲#^c2]]');
    const done = await confirmDecision({ vault, actor: ROLES.senior, decisionPath, body: fixed });
    expect(done.status).toBe('已确认');
    expect((await vault.read(decisionPath)).data).toMatchObject({ edited_by: 'Senior', decided_by: 'Senior' });
  });
});

describe('D-23: which model drafted the decision', () => {
  const dLog = async () => (await vault.readLog(`${WS_A}/日志.md`)).filter((r) => r.action === 'tool:propose_decision').at(-1);

  it('the log row, the note and the card say which model drafted it (label and model, as research:done does)', async () => {
    const modelInfo = { providerId: 'kimi', label: 'Kimi', model: 'kimi-k2' };
    await draftDecision({ ctx: await ctxFor(vault, ROLES.senior), reportPath: REPORT, model: jsonModel(DRAFT_JSON).model, modelInfo });
    expect((await dLog())?.change).toContain('模型：Kimi（kimi-k2）');
    expect((await vault.read(decisionPath)).data.drafted_by_model).toBe('Kimi（kimi-k2）');
    const [card] = await decisionsOfReport(vault, '20_项目/P', REPORT);
    expect(card.draftedByModel).toBe('Kimi（kimi-k2）');
  });

  it('is kept when the Senior confirms (the human fields change, the drafting provenance does not)', async () => {
    await draftDecision({ ctx: await ctxFor(vault, ROLES.senior), reportPath: REPORT, model: jsonModel(DRAFT_JSON).model, modelInfo: { providerId: 'kimi', label: 'Kimi', model: 'kimi-k2' } });
    const done = await confirmDecision({ vault, actor: ROLES.senior, decisionPath });
    expect(done.status).toBe('已确认');
    expect((await decisionsOfReport(vault, '20_项目/P', REPORT))[0].draftedByModel).toBe('Kimi（kimi-k2）');
    expect((await vault.read(decisionPath)).data).toMatchObject({ status: '已确认', decided_by: 'Senior', drafted_by_model: 'Kimi（kimi-k2）' });
  });

  it('without an explicit model it is the active provider in 90_配置/模型.md, and follows `active`', async () => {
    vi.stubEnv('MODEL_PROVIDER', '');
    await draft();
    expect((await dLog())?.change).toContain('模型：Alpha（alpha-1）');
    expect((await vault.read(decisionPath)).data.drafted_by_model).toBe('Alpha（alpha-1）');

    const cfg = await vault.read('90_配置/模型.md');
    await vault.write('90_配置/模型.md', { frontmatter: { ...cfg.data, active: 'beta' }, body: cfg.body }, { overwrite: true });
    await draft(); // another model: saved next to the first draft, not over it (D-26)
    expect((await vault.read(decisionPath)).data.drafted_by_model).toBe('Alpha（alpha-1）');
    expect((await vault.read(`${DECISIONS}/${GOOD_DRAFT.name}（Beta）.md`)).data.drafted_by_model).toBe('Beta（beta-1）');
    expect((await dLog())?.change).toContain('模型：Beta（beta-1）');
    vi.unstubAllEnvs();
  });

  it('a note drafted before this field existed has no model and the card says nothing', async () => {
    await draft();
    const n = await vault.read(decisionPath);
    const { drafted_by_model: _m, ...rest } = n.data;
    await vault.write(decisionPath, { frontmatter: rest, body: n.body }, { overwrite: true });
    const [card] = await decisionsOfReport(vault, '20_项目/P', REPORT);
    expect(card.draftedByModel).toBeNull();
  });
});

describe('D-26: two models draft from the same report, side by side, neither replaces the other', () => {
  const ds = { providerId: 'deepseek', label: 'DeepSeek', model: 'deepseek-v4-flash' };
  const kimi = { providerId: 'kimi', label: 'Kimi', model: 'kimi-k2' };
  const by = async (modelInfo: typeof ds) => draftDecision({ ctx: await ctxFor(vault, ROLES.senior), reportPath: REPORT, model: jsonModel(DRAFT_JSON).model, modelInfo });
  const files = async () => (await vault.list(DECISIONS)).filter((e) => e.kind === 'file' && e.path.includes(GOOD_DRAFT.name)).map((e) => e.path).sort();

  it('a second model gets its own file named with its label; each keeps its own drafted_by_model', async () => {
    const a = await by(ds);
    const b = await by(kimi);
    expect(a.path).toBe(decisionPath);
    expect(b.path).toBe(`${DECISIONS}/${GOOD_DRAFT.name}（Kimi）.md`);
    expect(b.replaced).toBe(false);
    expect(await files()).toHaveLength(2);
    const cards = await decisionsOfReport(vault, '20_项目/P', REPORT);
    expect(cards.map((c) => [c.status, c.draftedByModel]).sort()).toEqual([['推断', 'DeepSeek（deepseek-v4-flash）'], ['推断', 'Kimi（kimi-k2）']]);
    expect((await vault.read(b.path)).body).toMatch(/^# .*（Kimi）/m);
    expect((await vault.read(decisionPath)).data.drafted_by_model).toBe('DeepSeek（deepseek-v4-flash）');
  });

  it('the same model redrafting replaces its own draft (still 2 files), the other one is untouched', async () => {
    await by(ds);
    const b = await by(kimi);
    const before = await vault.read(decisionPath);
    const b2 = await by(kimi);
    expect(b2).toMatchObject({ path: b.path, replaced: true });
    const a2 = await by(ds);
    expect(a2).toMatchObject({ path: decisionPath, replaced: true });
    expect(await files()).toHaveLength(2);
    expect((await vault.read(decisionPath)).data.created).toBe(before.data.created);
  });

  it('a third model, or the same label with another model name, gets a numbered file instead of overwriting', async () => {
    await by(ds);
    await by(kimi);
    const other = await by({ providerId: 'kimi2', label: 'Kimi', model: 'kimi-k3' });
    expect(other.path).toBe(`${DECISIONS}/${GOOD_DRAFT.name}（Kimi） 2.md`);
    expect(await files()).toHaveLength(3);
    expect((await vault.read(`${DECISIONS}/${GOOD_DRAFT.name}（Kimi）.md`)).data.drafted_by_model).toBe('Kimi（kimi-k2）');
  });

  it('a confirmed decision is never overwritten, by the same model or another', async () => {
    await by(ds);
    await confirmDecision({ vault, actor: ROLES.senior, decisionPath });
    await expect(by(ds)).rejects.toThrow(/不能覆盖/);
    await expect(by(kimi)).rejects.toThrow(/不能覆盖/);
    expect(await files()).toHaveLength(1);
    expect((await vault.read(decisionPath)).data).toMatchObject({ status: '已确认', decided_by: 'Senior' });
  });

  it('confirming one of the two leaves the other a draft', async () => {
    await by(ds);
    const b = await by(kimi);
    await confirmDecision({ vault, actor: ROLES.senior, decisionPath: b.path });
    const cards = await decisionsOfReport(vault, '20_项目/P', REPORT);
    expect(cards.map((c) => `${c.draftedByModel}:${c.status}`).sort()).toEqual(['DeepSeek（deepseek-v4-flash）:推断', 'Kimi（kimi-k2）:已确认']);
  });
});
