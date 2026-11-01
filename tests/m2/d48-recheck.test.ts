/**
 * D-48: WS-A v9's citation check never ran (86 footnotes in one call, cut off at the 16000-token limit, skipped), nor
 * did its length rewrite. Both now go batch by batch; and a delivered report can have its checks run again
 * (scripts/recheck-citations.ts) without a word of its body or a footnote number changing.
 */
import { readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildToolContext } from '@/lib/harness';
import { CITATION_BATCH, citationFit } from '@/lib/research/citation-fit';
import type { Evidence } from '@/lib/research/evidence';
import { executeResearch } from '@/lib/research/execute';
import type { ClaimResult } from '@/lib/research/judge';
import { shortenLong } from '@/lib/research/length-check';
import { judgmentFilePath } from '@/lib/research/judgment-file';
import { LlmTruncatedError } from '@/lib/research/llm';
import { clearPageCache } from '@/lib/research/page-cache';
import { recheckCitations, RecheckDenied } from '@/lib/research/recheck';
import { judgmentSchema, summarySchema } from '@/lib/research/schemas';
import { ROLES } from '../helpers/fixture-vault';
import { ev } from './research-evidence';
import { fakeWeb, PLAN, RDIR, scriptedModel, setup, WS } from './research-fixture';

vi.setConfig({ testTimeout: 120_000 });

const ids = (prompt: string) => [...prompt.matchAll(/^- id：(\S+)$/gm)].map((m) => m[1]);

describe('86 footnotes: batch by batch, every one judged', () => {
  const keyed = new Map<string, Evidence>(Array.from({ length: 86 }, (_, i) => [`E${i + 1}`, ev({ quote: `原文 ${i + 1}` })]));
  const draft = { results: [], summary: summarySchema.parse({ so_what: Array.from({ length: 86 }, (_, i) => `第 ${i + 1} 句 [E${i + 1}]。`).join(''), results: ['H1 → x'] }) };

  it(`at most ${CITATION_BATCH} per call; a batch cut off at the limit is halved; the 挂错 ones of every batch are flagged`, async () => {
    const sizes: number[] = [];
    let cut = false;
    const run = {
      signal: undefined,
      log: vi.fn(async () => {}),
      llm: vi.fn(async (_task: string, p: { prompt: string }) => {
        const got = ids(p.prompt);
        sizes.push(got.length);
        // the third batch is cut off once, as v9's one call was
        if (!cut && sizes.length === 3) {
          cut = true;
          throw new LlmTruncatedError('输出到了长度上限（16000 tokens）被截断');
        }
        return { items: got.map((id) => ({ id, fit: /:E(7|43|86)$/.test(id) ? '挂错' : '撑得住', reason: '原文讲别的' })) };
      }),
    } as never;
    const out = await citationFit(run, draft, keyed);
    expect(sizes).toEqual([20, 20, 20, 10, 10, 20, 6]);
    expect(out.counts).toEqual({ checked: 86, replaced: 0, removed: 0, flagged: 3 });
    expect(out.misfits.map((m) => m.key)).toEqual(['E7', 'E43', 'E86']);
  });
});

describe('the length rewrite: batch by batch', () => {
  it('45 parts over their limit: 3 calls; a batch that fails keeps its words, the others are rewritten', async () => {
    const reasons = Array.from({ length: 3 }, (_, i) => `理由 ${i}：在有统一机队管理、员工人数较多的大中型企业里，多家独立来源都说采购由 IT 部门牵头并且把关准入 [E1]`);
    const results = Array.from({ length: 15 }, (_, n) => ({
      claim: { id: `C${n + 1}`, question: '谁拍板？' },
      label: `H${n + 1}`,
      conditions: [],
      judgment: judgmentSchema.parse({ verdict: '成立', reasoning: 'r', reasons }),
    })) as unknown as ClaimResult[];
    const summary = summarySchema.parse({ so_what: '付钱的是软件席位', results: ['H1 → x'] });
    const sizes: number[] = [];
    const run = {
      signal: undefined,
      log: vi.fn(async () => {}),
      llm: vi.fn(async (_t: string, p: { prompt: string }) => {
        const got = [...p.prompt.matchAll(/^- id：(\S+)（/gm)].map((m) => m[1]);
        sizes.push(got.length);
        if (sizes.length === 2) throw new LlmTruncatedError('截断');
        return { items: got.map((id) => ({ id, text: 'IT 牵头采购 [E1]' })) };
      }),
    } as never;
    const out = await shortenLong(run, results, summary);
    expect(sizes).toEqual([20, 20, 5]);
    const rewritten = out.results.flatMap((r) => r.judgment.reasons).filter((t) => t === 'IT 牵头采购 [E1]');
    expect(rewritten).toHaveLength(25);
  });
});

describe('scripts/recheck-citations.ts: the checks again on a delivered report', () => {
  let cleanup: (() => Promise<void>) | undefined;
  afterEach(async () => {
    vi.unstubAllGlobals();
    await cleanup?.();
    cleanup = undefined;
  });

  it('citation_flags, entity_flags, citation_fit and the appendix line updated; every other word and footnote number as it was', async () => {
    clearPageCache();
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 200 })));
    const fx = await setup({ approved: true, claims: 1 });
    cleanup = fx.cleanup;
    const note = await fx.vault.read(PLAN);
    const data = note.data as Record<string, unknown> & { claims: Record<string, unknown>[] };
    data.claims = data.claims.map((c) => ({ ...c, question: '谁决定买？', parent: null }));
    data.mece_check = '一道关';
    await fx.vault.write(PLAN, { frontmatter: data, body: note.body }, { overwrite: true });
    const ctx = await buildToolContext({ vault: fx.vault, role: ROLES.juniorA, workspacePath: WS, researchDir: RDIR, track: 'research', now: () => new Date('2026-10-26T10:00:00Z') });
    // the run's own check: all 撑得住 (as if it had been skipped: no flags)
    const v1 = await executeResearch({ ctx, mode: 'small', model: scriptedModel().model, webClient: fakeWeb() });
    expect(v1.delivered).toBe(true);
    const before = await fx.vault.read(v1.reportPath);
    expect(before.data.citation_flags).toBeUndefined();

    let judged = 0;
    const m = scriptedModel({ citationFit: (items) => ((judged += items.length), items.map((i, n) => ({ id: i.id, fit: n === 0 ? '挂错' : '撑得住', reason: n === 0 ? '原文讲的是别的事' : '' }))) });
    const r = await recheckCitations({ ctx, reportPath: v1.reportPath, model: m.model });
    expect(r.checked).toBe(judged);
    expect(r.flagged).toBe(1);
    expect(m.tasks).not.toContain('citation-fit:repair'); // only flagged
    const after = await fx.vault.read(v1.reportPath);
    expect(after.data.citation_flags).toEqual([{ footnote: expect.stringMatching(/^\[\^\d+\]$/), ref: expect.any(String), sentence: expect.any(String), quote: expect.any(String), reason: '原文讲的是别的事' }]);
    expect(after.data.citation_fit).toEqual({ checked: judged, replaced: 0, removed: 0, flagged: 1 });
    expect(after.data.citation_recheck).toEqual({ at: '2026-10-26T10:00:00.000Z', batches: r.batches, note: '引用核对按分批补跑，正文未改' });
    expect(r.batches).toBe(Math.ceil(judged / 20));
    // the body: only the 引用核对 line
    const line = /^- 引用核对：.*$/m;
    expect(after.body).toMatch(new RegExp(`- 引用核对：查了 ${judged} 个，换了 0 个，删了 0 个，标了 1 个`));
    expect(after.body.replace(line, '')).toBe(before.body.replace(line, ''));
    for (const k of ['delivery', 'version', 'verdicts_proposed', 'research_run']) expect(after.data[k]).toEqual(before.data[k]);
    expect((await fx.vault.readLog(fx.ctx.logPath)).some((x) => x.action === 'research:citation-recheck' && x.change.includes('引用核对按分批补跑，正文未改'))).toBe(true);
  });

  it('summary_flags again, by code: the stored one-line answer against the answers the body shows; the body as it was', async () => {
    clearPageCache();
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 200 })));
    const fx = await setup({ approved: true, claims: 1 });
    cleanup = fx.cleanup;
    const note = await fx.vault.read(PLAN);
    const data = note.data as Record<string, unknown> & { claims: Record<string, unknown>[] };
    data.claims = data.claims.map((c) => ({ ...c, question: '谁决定买？', parent: null }));
    data.mece_check = '一道关';
    await fx.vault.write(PLAN, { frontmatter: data, body: note.body }, { overwrite: true });
    const ctx = await buildToolContext({ vault: fx.vault, role: ROLES.juniorA, workspacePath: WS, researchDir: RDIR, track: 'research', now: () => new Date('2026-10-26T10:00:00Z') });
    const v1 = await executeResearch({ ctx, mode: 'small', model: scriptedModel().model, webClient: fakeWeb() });
    // the stored one-line answer says the opposite of Q1 (as v9's did of Q3-1)
    const fp = path.join(fx.vault.root, judgmentFilePath(v1.reportPath));
    const f = JSON.parse(await readFile(fp, 'utf8'));
    const q1 = /^ {2}- Q1 → (.*)$/m.exec((await fx.vault.read(v1.reportPath)).body)![1].replace(/\[\^\d+\]/g, '');
    f.summary.so_what = `${q1.split(/[；。，]/)[0].replace(/不|没|未/g, '')}不成立[Q1]`;
    await writeFile(fp, JSON.stringify(f));
    const before = await fx.vault.read(v1.reportPath);
    const r = await recheckCitations({ ctx, reportPath: v1.reportPath, model: scriptedModel().model });
    const after = await fx.vault.read(v1.reportPath);
    expect(r.summaryFlagged).toBeGreaterThan(0);
    expect(after.data.summary_flags).toEqual(expect.arrayContaining([expect.objectContaining({ q: 'Q1', kind: 'direction' })]));
    const line = /^- 引用核对：.*$/m;
    expect(after.body.replace(line, '')).toBe(before.body.replace(line, ''));
    expect((await fx.vault.readLog(fx.ctx.logPath)).some((x) => x.action === 'research:summary-recheck' && x.change.includes('补跑 summary_flags，正文未改'))).toBe(true);
  });

  it('a draft, or a report without its judgment file, is refused', async () => {
    clearPageCache();
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 200 })));
    const fx = await setup({ approved: true, claims: 1 });
    cleanup = fx.cleanup;
    const v1 = await executeResearch({ ctx: fx.ctx, mode: 'small', model: scriptedModel().model, webClient: fakeWeb() });
    const note = await fx.vault.read(v1.reportPath);
    await fx.vault.write(v1.reportPath, { frontmatter: { ...note.data, delivery: '草稿' }, body: note.body }, { overwrite: true });
    await expect(recheckCitations({ ctx: fx.ctx, reportPath: v1.reportPath, model: scriptedModel().model })).rejects.toThrow(/还没有交付/);
    await fx.vault.write(v1.reportPath, { frontmatter: note.data, body: note.body }, { overwrite: true });
    await rm(path.join(fx.vault.root, judgmentFilePath(v1.reportPath)));
    await expect(recheckCitations({ ctx: fx.ctx, reportPath: v1.reportPath, model: scriptedModel().model })).rejects.toThrow(RecheckDenied);
  });
});
