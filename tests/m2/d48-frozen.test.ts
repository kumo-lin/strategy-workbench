/**
 * D-48 第 4 轮 A: the judgment a report was written on (报告 vN.judgment.json), and the rewrite of the writing only
 * that keeps it. Read back from the real WS-A 报告 v7 and W5 报告 v5 (tests/fixtures/d48, copied from C's S3), which
 * were written before the file existed: every hypothesis comes back, its states and footnotes as the body shows them.
 */
import { readFileSync } from 'node:fs';
import { access, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildToolContext } from '@/lib/harness';
import { verdictFromConditions } from '@/lib/research/evidence';
import { executeResearch } from '@/lib/research/execute';
import { footnoteRefs, frozenFromBody, frozenFromFile, judgmentFileFromBody, judgmentFilePath, readJudgmentFile } from '@/lib/research/judgment-file';
import { clearPageCache } from '@/lib/research/page-cache';
import { backfillJudgment, rewriteReport } from '@/lib/research/rewrite';
import { createVault } from '@/lib/vault';
import type { ResearchPlanNote } from '@/lib/notes/schema';
import { ROLES } from '../helpers/fixture-vault';
import { fakeWeb, PLAN, RDIR, scriptedModel, setup, WS } from './research-fixture';

vi.setConfig({ testTimeout: 120_000 });

const FIX = 'tests/fixtures/d48';
let root = '';
afterEach(async () => {
  vi.unstubAllGlobals();
  if (root) await rm(root, { recursive: true, force: true });
  root = '';
});

/** A plan note from the fixtures, read the way the vault reads it. */
async function planFrom(file: string): Promise<ResearchPlanNote> {
  root = await mkdtemp(path.join(tmpdir(), 'd48-frozen-'));
  await writeFile(path.join(root, 'plan.md'), readFileSync(path.join(FIX, file), 'utf8'));
  return (await createVault(root).read('plan.md')).note as ResearchPlanNote;
}

/** "  - ① … → 成立：…[^15][^14]" as the body writes it: the label, the state and the footnotes, read directly. */
function bodyConditions(body: string, label: string) {
  const lines = body.split('\n');
  const start = lines.findIndex((l) => new RegExp(`^#{3,4} 假设 ${label}：`).test(l));
  const out: { status: string; notes: string[] }[] = [];
  for (let i = start + 1; i < lines.length && !/^#{2,4} /.test(lines[i]); i++) {
    const m = /^ {2}- [①②③④⑤] .* → (成立|不成立|证据不足)(.*)$/.exec(lines[i]);
    if (m) out.push({ status: m[1], notes: [...m[2].matchAll(/\[\^(\d+)\]/g)].map((x) => x[1]) });
  }
  return out;
}

describe('read back from the real reports (written before judgment files)', () => {
  it('WS-A 报告 v7: all 6 hypotheses come back, each state and footnote as the body shows it, the verdict derived as written', async () => {
    const body = readFileSync(path.join(FIX, 'WS-A 报告 v7.md'), 'utf8');
    const plan = await planFrom('WS-A 计划 v3.md');
    const { frozen, unreadable } = frozenFromBody(body, plan);
    expect(unreadable).toEqual([]);
    expect(frozen.map((f) => f.label)).toEqual(['H1', 'H2-1', 'H2-2', 'H3-1', 'H3-2', 'H3-3']);
    const refs = footnoteRefs(body);
    for (const f of frozen) {
      const shown = bodyConditions(body, f.label);
      expect(f.conditions.map((c) => c.status)).toEqual(shown.map((c) => c.status));
      // the footnotes of each condition, as block links, in the order they stood
      expect(f.conditions.map((c) => c.refs)).toEqual(shown.map((c) => [...new Set(c.notes.map((n) => refs.get(n)!))]));
      expect(verdictFromConditions(f.conditions.map((c) => c.status))).toBe(f.verdict);
    }
    expect(frozen[0].conditions.map((c) => c.status)).toEqual(['成立', '证据不足', '证据不足']);
    expect(frozen[1].conditions.map((c) => c.status)).toEqual(['证据不足', '不成立', '证据不足']);
    // the note keeps where its footnotes stood
    expect(frozen[0].conditions[0].note).toBe('监管要求与机队部署都把接入放在 IT 侧⟦0⟧⟦1⟧⟦2⟧');
    expect(frozen[0].conditions[0].refs[0]).toBe(refs.get('15'));
  });

  it('W5 报告 v5: all 3 come back; the condition code checked keeps its 系统复核', async () => {
    const body = readFileSync(path.join(FIX, 'W5 报告 v5.md'), 'utf8');
    const plan = await planFrom('W5 计划 v1.md');
    const { frozen, unreadable } = frozenFromBody(body, plan);
    expect(unreadable).toEqual([]);
    expect(frozen).toHaveLength(3);
    for (const f of frozen) expect(f.conditions.map((c) => c.status)).toEqual(bodyConditions(body, f.label).map((c) => c.status));
    expect(frozen.flatMap((f) => f.conditions).some((c) => c.adjusted)).toBe(body.includes('（系统复核：'));
  });

  it('the backfilled file reads back to the same judgment (keys = footnote numbers, mapped to block links)', async () => {
    const body = readFileSync(path.join(FIX, 'WS-A 报告 v7.md'), 'utf8');
    const plan = await planFrom('WS-A 计划 v3.md');
    const { frozen } = frozenFromBody(body, plan);
    const file = judgmentFileFromBody('…/报告 v7.md', body, frozen);
    expect(file.source).toBe('body');
    expect(file.claims[0].conditions[0]).toMatchObject({ status: '成立', keys: ['E15', 'E14', 'E19'], note: '监管要求与机队部署都把接入放在 IT 侧[E15][E14][E19]' });
    expect(file.claims[0].judgment).toMatchObject({ verdict: '需要修改', changed: '改成 IT 管准入和日志，决策与预算由 IT、业务线、高层分担' });
    expect(frozenFromFile(JSON.parse(JSON.stringify(file))).frozen).toEqual(frozen);
  });
});

describe('a run writes its judgment file; a rewrite keeps it', () => {
  async function treeRun(claims = 1) {
    clearPageCache();
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 200 })));
    const fx = await setup({ approved: true, claims });
    const note = await fx.vault.read(PLAN);
    const data = note.data as Record<string, unknown> & { claims: Record<string, unknown>[] };
    data.claims = data.claims.map((c, i) => ({ ...c, question: ['谁决定买？', '按什么放行？'][i], parent: null, conditions: ['采购由 IT 牵头', '预算由 IT 出'] }));
    data.mece_check = '一道关';
    await fx.vault.write(PLAN, { frontmatter: data, body: note.body }, { overwrite: true });
    const ctx = await buildToolContext({ vault: fx.vault, role: ROLES.juniorA, workspacePath: WS, researchDir: RDIR, track: 'research', now: () => new Date('2026-10-26T10:00:00Z') });
    return { fx, ctx };
  }
  // v1: ① 成立, ② 证据不足 → 需要修改
  const v1Judge = ({ supports, conditions }: { supports: string[]; conditions: number[] }) => ({
    verdict: '需要修改', rebutted: [], revised_statement: null, support_lines: [`IT 主导 [${supports[0]}]`], counter_lines: ['已专门检索反证，没有找到 A/B 级的反证'], challenge_responses: [], reasoning: `准入在 IT [${supports[0]}]`, model_knowledge: [], so_what: ['所以联想先打 IT'], gaps: [], expert_questions: [],
    ...(conditions.length ? { conditions: [{ n: 1, status: '成立', keys: supports, note: `采购由 IT 牵头 [${supports[0]}]` }, { n: 2, status: '证据不足', keys: [], note: '缺预算归属' }], changed: '改成 IT 牵头采购，预算待证', answer: `IT 牵头 [${supports[0]}]；预算多半分散，还缺证据`, reasons: [`准入在 IT [${supports[0]}]`], short_statement: 'IT 牵头' } : {}),
  });
  // a rewrite's model would say all 成立: it must not count
  const rewriteJudge = ({ supports }: { supports: string[] }) => ({ ...v1Judge({ supports, conditions: [1, 2] }), verdict: '成立', conditions: [{ n: 1, status: '成立', keys: supports, note: '' }, { n: 2, status: '成立', keys: supports, note: '' }], changed: '没改', answer: `IT 牵头 [${supports[0]}]；预算多半分散，还缺证据` });

  it('v1 writes 报告 v1.judgment.json; v2 keeps v1\'s conditions though the model says otherwise, the model asked only to write', async () => {
    const { fx, ctx } = await treeRun();
    try {
      const v1 = await executeResearch({ ctx, mode: 'small', model: scriptedModel({ judge: v1Judge }).model, webClient: fakeWeb() });
      expect(v1.delivered).toBe(true);
      const file = await readJudgmentFile(fx.vault, v1.reportPath);
      expect(file?.claims.map((c) => [c.label, c.verdict, c.conditions.map((x) => x.status)])).toEqual([['H1', '需要修改', ['成立', '证据不足']]]);
      expect(Object.values(file!.keyed).every((ref) => /^\[\[.+#\^c\d+\]\]$/.test(ref))).toBe(true);

      const locked: boolean[] = [];
      const m = scriptedModel({ judge: (k) => (locked.push(k.locked), rewriteJudge(k)) });
      const v2 = await rewriteReport({ ctx, reportPath: v1.reportPath, model: m.model });
      expect(locked).toEqual([true]); // the writing call: conditions given, not asked
      expect(v2.delivered).toBe(true);
      expect(v2.claims.find((c) => c.id === 'C1')).toMatchObject({ verdict: '需要修改' });
      const v2file = await readJudgmentFile(fx.vault, v2.reportPath);
      expect(v2file?.claims[0].conditions.map((c) => c.status)).toEqual(['成立', '证据不足']);
      const log = await fx.vault.readLog(fx.ctx.logPath);
      expect(log.some((x) => x.action === 'research:frozen' && x.change.includes('判断文件'))).toBe(true);
      expect(log.some((x) => x.action === 'research:frozen-fallback')).toBe(false);
      const body = (await fx.vault.read(v2.reportPath)).body;
      expect(body).toMatch(/② 预算由 IT 出 → 证据不足/);
      expect(body).toContain('- 判断都没变（沿用 v1 的逐条判断）\n');
      expect(body).not.toContain('同一个判断模型自己跟自己约 84% 一致');

      // no judgment file: read back from v1's body, the same
      await rm(path.join(fx.vault.root, judgmentFilePath(v1.reportPath)));
      const v3 = await rewriteReport({ ctx, reportPath: v1.reportPath, model: scriptedModel({ judge: (k) => rewriteJudge(k) }).model });
      expect((await readJudgmentFile(fx.vault, v3.reportPath))?.claims[0].conditions.map((c) => c.status)).toEqual(['成立', '证据不足']);
      expect((await fx.vault.readLog(fx.ctx.logPath)).some((x) => x.action === 'research:frozen' && x.change.includes('从正文读回'))).toBe(true);

      // --backfill-judgment writes v1's file back from its body, and never overwrites one
      const b = await backfillJudgment(ctx, v1.reportPath);
      expect(b).toMatchObject({ claims: ['H1'], unreadable: [] });
      await access(path.join(fx.vault.root, b.path));
      await expect(backfillJudgment(ctx, v1.reportPath)).rejects.toThrow(/已经有了/);
    } finally {
      await fx.cleanup();
    }
  });

  it('a hypothesis vN cannot give back is judged again: research:frozen-fallback, said in 本版变化; none kept: as before', async () => {
    const { fx, ctx } = await treeRun(2);
    try {
      const v1 = await executeResearch({ ctx, mode: 'full', model: scriptedModel({ judge: v1Judge }).model, webClient: fakeWeb() });
      expect(v1.claims.map((c) => c.verdict)).toEqual(['需要修改', '需要修改']);
      await rm(path.join(fx.vault.root, judgmentFilePath(v1.reportPath)));
      // H2's condition lines gone from the body: nothing to read back for it
      const note = await fx.vault.read(v1.reportPath);
      const h2 = note.body.indexOf('假设 H2：');
      await fx.vault.write(v1.reportPath, { frontmatter: note.data, body: note.body.slice(0, h2) + note.body.slice(h2).replace(/^ {2}- [①②] .*$/gm, '') }, { overwrite: true });
      const v2 = await rewriteReport({ ctx, reportPath: v1.reportPath, model: scriptedModel({ judge: (k) => rewriteJudge(k) }).model });
      expect(v2.claims.map((c) => [c.id, c.verdict])).toEqual([['C1', '需要修改'], ['C2', '成立']]); // C2 judged again: the model's all 成立
      const log = await fx.vault.readLog(fx.ctx.logPath);
      expect(log.some((x) => x.action === 'research:frozen-fallback' && x.change.startsWith('C2（H2）：正文里逐条对照的条件有 0 条'))).toBe(true);
      expect((await fx.vault.read(v2.reportPath)).body).toContain('- 判断都没变（沿用 v1 的逐条判断）；H2 读不回来，重新判断：需要修改 → 成立（正文里逐条对照的条件有 0 条，计划里要判的是 2 条）');

      // nothing to read back at all (a report from before conditions were judged one by one): judged again, compared as before
      await fx.vault.write(v1.reportPath, { frontmatter: note.data, body: note.body.replace(/^ {2}- [①②] .*$/gm, '') }, { overwrite: true });
      const v3 = await rewriteReport({ ctx, reportPath: v1.reportPath, model: scriptedModel({ judge: (k) => rewriteJudge(k) }).model });
      expect((await fx.vault.read(v3.reportPath)).body).toMatch(/^- 判断变了的：H1：需要修改 → 成立；H2：需要修改 → 成立$/m);
    } finally {
      await fx.cleanup();
    }
  });

  /** A card's section with each footnote as its block link (the numbers follow the whole report's order). */
  const cardOf = (body: string, label: string) => {
    const refs = footnoteRefs(body);
    const lines = body.split('\n');
    const start = lines.findIndex((l) => new RegExp(`^#{3,4} 假设 ${label}：`).test(l));
    const end = lines.findIndex((l, i) => i > start && /^#{2,4} /.test(l));
    return lines.slice(start, end).join('\n').replace(/\[\^(\d+)\]/g, (_, n: string) => refs.get(n) ?? `[^${n}]`);
  };

  it('第 5 轮 --only H2: H1\'s card word for word as v1 had it, no model call for it; so_what and the recommendation kept from v1\'s file', async () => {
    const { fx, ctx } = await treeRun(2);
    try {
      const v1 = await executeResearch({ ctx, mode: 'full', model: scriptedModel({ judge: v1Judge }).model, webClient: fakeWeb() });
      const v1file = await readJudgmentFile(fx.vault, v1.reportPath);
      expect(v1file?.summary?.so_what).toBeTruthy();
      expect(v1file?.recommendation?.action).toBeTruthy();
      const calls: boolean[] = [];
      const m = scriptedModel({ judge: (k) => (calls.push(k.locked), { ...rewriteJudge(k), answer: '改写过的回答', answer_segments: [] }) });
      const v2 = await rewriteReport({ ctx, reportPath: v1.reportPath, model: m.model, only: ['H2'] });
      expect(v2.delivered).toBe(true);
      expect(calls).toEqual([true]); // H2 only, the writing call
      expect(m.tasks).not.toContain('summary');
      expect(m.tasks).not.toContain('recommend');
      const [b1, b2] = [(await fx.vault.read(v1.reportPath)).body, (await fx.vault.read(v2.reportPath)).body];
      expect(cardOf(b1, 'H1')).toMatch(/^#{3,4} 假设 H1：[\s\S]*当时的假设，逐条对照[\s\S]*So What/);
      expect(cardOf(b2, 'H1')).toBe(cardOf(b1, 'H1'));
      expect(cardOf(b2, 'H2')).not.toBe(cardOf(b1, 'H2'));
      expect(b2).toContain('- 局部重做：H2；其余原样沿用 v1；判断都没变\n');
      const so = (b: string) => /- 回答（一句话）：(.*)/.exec(b)?.[1].replace(/\[\^\d+\]/g, '');
      expect(so(b2)).toBe(so(b1));

      // a file without so_what and the recommendation (written before 第 5 轮): those are written again, and said
      const f = (await readJudgmentFile(fx.vault, v1.reportPath))!;
      delete f.summary;
      delete f.recommendation;
      await writeFile(path.join(fx.vault.root, judgmentFilePath(v1.reportPath)), JSON.stringify(f));
      const m3 = scriptedModel({ judge: (k) => rewriteJudge(k) });
      const v3 = await rewriteReport({ ctx, reportPath: v1.reportPath, model: m3.model, only: ['H2'] });
      expect(m3.tasks).toContain('summary');
      expect(m3.tasks).toContain('recommend');
      expect((await fx.vault.read(v3.reportPath)).body).toContain('- 局部重做：H2、一句话回答、推荐表；其余原样沿用 v1；判断都没变\n');
      await expect(rewriteReport({ ctx, reportPath: v1.reportPath, model: m3.model, only: ['H9'] })).rejects.toThrow(/H9 不是这份报告里的假设/);
    } finally {
      await fx.cleanup();
    }
  });
});
