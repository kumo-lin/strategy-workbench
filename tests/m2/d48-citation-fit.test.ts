/**
 * D-48 第 3 轮: "引用对得上吗". Every footnote of the Summary and the recommendation, its sentence paired with its
 * original, judged in one call; a 挂错 one is switched to a key that holds the sentence, else taken out and the
 * sentence said one notch softer; what is still 挂错 is citation_flags (not blocking). Fixtures: WS-A v6's [^22]
 * ("主要障碍是 ROI" on "77% 的 CIO 认为安全与风险是最大障碍") and [^9].
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildToolContext } from '@/lib/harness';
import { citationFit, citationFixesOf, citationFlagsOf, citationSites, keepEndMark, sentencesOf, swapKey } from '@/lib/research/citation-fit';
import type { Evidence } from '@/lib/research/evidence';
import { executeResearch } from '@/lib/research/execute';
import type { ClaimResult } from '@/lib/research/judge';
import { clearPageCache } from '@/lib/research/page-cache';
import { judgmentSchema, summarySchema } from '@/lib/research/schemas';
import { ROLES } from '../helpers/fixture-vault';
import { ev } from './research-evidence';
import { fakeWeb, PLAN, RDIR, scriptedModel, setup, WS } from './research-fixture';

vi.setConfig({ testTimeout: 90_000 });

const e12 = ev({ quote: 'ROI、数据与人才是企业落地 AI 的主要绊脚石' });
const e22 = ev({ quote: '77%的CIO认为安全与风险是规模化落地的最大障碍' });
const e9 = ev({ quote: '80%的AI支出发生在IT预算之外' });
const e4 = ev({ quote: '22% 的企业由 IT 集中管理 AI 预算' });
const keyed = new Map<string, Evidence>([['E12', e12], ['E22', e22], ['E9', e9], ['E4', e4]]);

const judgment = judgmentSchema.parse({ verdict: '需要修改', reasoning: 'r', support_lines: [], counter_lines: [], challenge_responses: [], model_knowledge: [], so_what: [], gaps: [], expert_questions: [], answer: '准入由 IT 管住 [E4]；钱多半不在软件科目 [E9]', reasons: ['准入在 IT [E4]'] });
const card = { claim: { id: 'C1', question: '谁拍板？' }, label: 'H1', judgment, keyed } as unknown as ClaimResult;
/** WS-A v6's [^22], in a card's answer (repaired) and in the Summary's one-line answer (only flagged, 第 4 轮 D). */
const BARRIER = '付钱的是席位与服务；未采购的主要障碍是 ROI、数据与人才 [E22][E12]。';
const card2 = { claim: { id: 'C2', question: '钱从哪来？' }, label: 'H2', judgment: { ...judgment, answer: BARRIER, reasons: ['IT 集中管 [E4]'] }, keyed } as unknown as ClaimResult;
const draft = () => ({
  results: [card, card2],
  summary: summarySchema.parse({
    so_what: BARRIER,
    results: ['H1 → x'],
    answers: [{ id: 'Q3', answer: '钱多半不在软件科目 [E9]' }],
  }),
});
const answerOf = (d: { results: ClaimResult[] }, id: string) => d.results.find((r) => r.claim.id === id)!.judgment.answer;

/** A run whose calls answer by task; `asked` keeps what each call was given. */
function fakeRun(answers: Record<string, (prompt: string) => unknown>) {
  const asked: { task: string; prompt: string }[] = [];
  return {
    asked,
    run: {
      signal: undefined,
      log: vi.fn(async () => {}),
      llm: vi.fn(async (task: string, p: { prompt: string }) => {
        asked.push({ task, prompt: p.prompt });
        return answers[task]?.(p.prompt) ?? { items: [] };
      }),
    } as never,
  };
}
const ids = (prompt: string) => [...prompt.matchAll(/^- id：(\S+)$/gm)].map((m) => m[1]);
const judgeAll = (wrong: (id: string) => boolean, reason = '原文讲的是安全与风险') => (prompt: string) => ({ items: ids(prompt).map((id) => ({ id, fit: wrong(id) ? '挂错' : '撑得住', reason: wrong(id) ? reason : '' })) });

describe('the footnotes checked', () => {
  it('sentences keep the footnotes after their end mark; every key of the Summary, the card answers and the recommendation', () => {
    expect(sentencesOf('付钱的是席位。[E7] 硬件没有条目 [E10]；还缺报价')).toEqual(['付钱的是席位。[E7]', '硬件没有条目 [E10]；', '还缺报价']);
    expect(citationSites(draft(), keyed).map((s) => `${s.part}:${s.key}`)).toEqual(['summary:so_what:E22', 'summary:so_what:E12', 'summary:answer:Q3:E9', 'card:C1:answer:E4', 'card:C1:answer:E9', 'card:C2:answer:E22', 'card:C2:answer:E12']);
  });

  it('a key swapped or taken out of its bracket; the others kept', () => {
    expect(swapKey('主要障碍是 ROI [E22][E12]。', 'E22', 'E12')).toBe('主要障碍是 ROI [E12]。');
    expect(swapKey('主要障碍是 ROI [E22, E12]。', 'E22', null)).toBe('主要障碍是 ROI [E12]。');
    expect(swapKey('钱不在软件科目 [E9]', 'E9', null)).toBe('钱不在软件科目');
  });

  it('no footnote: no call', async () => {
    const { run, asked } = fakeRun({});
    const d = { results: [], summary: summarySchema.parse({ so_what: '还答不了', results: ['H1 → x'] }) };
    expect((await citationFit(run, d, keyed)).changed).toBe(false);
    expect(asked).toEqual([]);
  });
});

describe('第 4 轮 D: in the Summary and the recommendation a 挂错 footnote is only flagged', () => {
  it('the Summary\'s [^22] flagged, its words left as they were; the card\'s repaired', async () => {
    const { run, asked } = fakeRun({ 'citation-fit': judgeAll((id) => id.endsWith(':E22')), 'citation-fit:repair': (p) => ({ items: ids(p).map((id) => ({ id, action: 'replace', key: 'E4', sentence: '' })) }), 'citation-fit:verify': judgeAll(() => false) });
    const out = await citationFit(run, draft(), keyed);
    expect(out.summary.so_what).toBe(BARRIER);
    expect(answerOf(out, 'C2')).toBe('付钱的是席位与服务；未采购的主要障碍是 ROI、数据与人才 [E4][E12]。');
    expect(out.misfits).toEqual([{ key: 'E22', sentence: '未采购的主要障碍是 ROI、数据与人才 [E22][E12]。', quote: e22.quote, reason: '原文讲的是安全与风险' }]);
    expect(out.counts).toEqual({ checked: 7, replaced: 1, removed: 0, flagged: 1 });
    // only the card's goes to the repair
    expect(ids(asked[1].prompt)).toEqual(['card:C2:answer#1:E22']);
  });

  it('only the Summary\'s wrong: no repair call at all', async () => {
    const { run, asked } = fakeRun({ 'citation-fit': judgeAll((id) => id.startsWith('summary:') && id.endsWith(':E22')) });
    const out = await citationFit(run, draft(), keyed);
    expect(out).toMatchObject({ changed: false, fixes: [], counts: { checked: 7, flagged: 1 } });
    expect(asked.map((x) => x.task)).toEqual(['citation-fit']);
  });
});

describe('挂错 in a card: switched, softened, or flagged', () => {
  const wrongE22 = judgeAll((id) => id.startsWith('card:') && id.endsWith(':E22'));
  const replace = (key: string) => (p: string) => ({ items: ids(p).map((id) => ({ id, action: 'replace', key, sentence: '' })) });

  it('switched to a key the same hypothesis uses, judged 撑得住 before the switch ([^22] → [^4]); citation_fixes says from and to', async () => {
    const { run, asked } = fakeRun({ 'citation-fit': wrongE22, 'citation-fit:repair': replace('E4'), 'citation-fit:verify': judgeAll(() => false) });
    const out = await citationFit(run, draft(), keyed);
    expect(answerOf(out, 'C2')).toBe('付钱的是席位与服务；未采购的主要障碍是 ROI、数据与人才 [E4][E12]。');
    expect(out).toMatchObject({ changed: true, misfits: [], counts: { checked: 7, replaced: 1, removed: 0, flagged: 0 } });
    expect(out.fixes).toEqual([{ key: 'E22', action: '换编号', from: 'E22', to: 'E4', before: '未采购的主要障碍是 ROI、数据与人才 [E22][E12]。', after: '未采购的主要障碍是 ROI、数据与人才 [E4][E12]。' }]);
    expect(asked.map((x) => x.task)).toEqual(['citation-fit', 'citation-fit:repair', 'citation-fit:verify']);
    // one call judges every pair: the sentence and the original side by side
    expect(asked[0].prompt).toContain('句子：未采购的主要障碍是 ROI、数据与人才 [E22][E12]。\n  这个脚注：[E22]\n  原文：77%的CIO认为安全与风险是规模化落地的最大障碍');
    // the repair is offered only the hypothesis' own keys: those the card's judgment and the sentence cite
    expect(asked[1].prompt).toMatch(/可以换的证据：\n {4}\[E12\].*\n {4}\[E4\].*\n {4}\[E9\]/);
    // the before is numbered as the report before the fix numbered it, the after as this one does
    const before = [`[^1]: “x”${e22.ref}`, `[^2]: “x”${e12.ref}`].join('\n');
    // the final body: the renderer put the segment's "（还缺证据）" after it; the entry says the sentence as shown
    const after = ['- 回答：付钱的是席位与服务；未采购的主要障碍是 ROI、数据与人才（还缺证据）[^1][^2]。', '', `[^1]: “x”${e4.ref}`, `[^2]: “x”${e12.ref}`].join('\n');
    expect(citationFixesOf(out.fixes, before, after, keyed)).toEqual([{ footnote: '[^1]', ref: e22.ref, action: '换编号', from: '[^1]', to: '[^1]', sentence_before: '未采购的主要障碍是 ROI、数据与人才[^1][^2]。', sentence_after: '未采购的主要障碍是 ROI、数据与人才（还缺证据）[^1][^2]。' }]);
    // 第 5 轮 (c): the switched-in key is not in the final body (the renderer dropped it): the entry goes
    const dropped = ['- 回答：付钱的是席位与服务；未采购的主要障碍是 ROI、数据与人才[^2]。', '', `[^2]: “x”${e12.ref}`].join('\n');
    expect(citationFixesOf(out.fixes, before, dropped, keyed)).toEqual([]);
  });

  it('a key judged 撑得住 in that sentence already: the wrong one just goes, no further call', async () => {
    const { run, asked } = fakeRun({ 'citation-fit': wrongE22, 'citation-fit:repair': replace('E12') });
    const out = await citationFit(run, draft(), keyed);
    expect(answerOf(out, 'C2')).toBe('付钱的是席位与服务；未采购的主要障碍是 ROI、数据与人才 [E12]。');
    expect(asked.map((x) => x.task)).toEqual(['citation-fit', 'citation-fit:repair']);
  });

  it('never a key nobody judged 撑得住: not the hypothesis\' (E99), or judged 部分 when proposed: not switched, flagged', async () => {
    for (const [key, verify] of [['E99', undefined], ['E4', '部分']] as const) {
      const { run, asked } = fakeRun({
        'citation-fit': wrongE22,
        'citation-fit:repair': replace(key),
        'citation-fit:verify': (p) => ({ items: ids(p).map((id) => ({ id, fit: verify, reason: '只讲预算' })) }),
      });
      const out = await citationFit(run, draft(), keyed);
      expect(answerOf(out, 'C2')).toContain('[E22][E12]');
      expect(out).toMatchObject({ changed: false, fixes: [], counts: { replaced: 0, flagged: 1 } });
      expect(out.misfits).toEqual([expect.objectContaining({ key: 'E22', reason: '原文讲的是安全与风险' })]);
      expect(asked.some((x) => x.task === 'citation-fit:verify')).toBe(key === 'E4');
    }
  });

  it('nothing to switch to: the footnote goes, the sentence one notch softer, its other footnotes kept (删脚注 + 降语气); a softening that adds a number is not taken', async () => {
    const soft = fakeRun({
      'citation-fit': judgeAll((id) => id.startsWith('card:C1:answer#1') || (id.startsWith('card:C2') && id.endsWith(':E22')), '原文讲预算在不在 IT，不讲科目'),
      'citation-fit:repair': (p) => ({
        items: ids(p).map((id) => (id.startsWith('card:C1') ? { id, action: 'drop', sentence: '钱记在哪个科目还缺证据' } : { id, action: 'drop', sentence: '未采购的主要障碍多半是 ROI、数据与人才（约 6 成）[E12]。' })),
      }),
    });
    const out = await citationFit(soft.run, draft(), keyed);
    expect(answerOf(out, 'C1')).toBe('准入由 IT 管住 [E4]；钱记在哪个科目还缺证据');
    expect(out.fixes.map((f) => [f.action, f.from, f.after])).toEqual([['删脚注', 'E9', '钱记在哪个科目还缺证据'], ['降语气', null, '钱记在哪个科目还缺证据']]);
    // the Summary's own "[E9]" sentence was not judged 挂错: left as it was
    expect(out.summary.answers).toEqual([{ id: 'Q3', answer: '钱多半不在软件科目 [E9]' }]);
    // "约 6 成" is a number the sentence did not have: not taken, flagged
    expect(answerOf(out, 'C2')).toContain('[E22][E12]');
    expect(out.misfits).toEqual([expect.objectContaining({ key: 'E22', reason: '原文讲预算在不在 IT，不讲科目' })]);
    expect(out.counts).toEqual({ checked: 7, replaced: 0, removed: 1, flagged: 1 });
  });

  it('a sentence with a number keeps its footnote: not taken out, only flagged', async () => {
    const d = draft();
    d.results[0] = { ...card, judgment: { ...judgment, answer: 'AI 预算 22% 由 IT 集中管 [E9]' } };
    const { run } = fakeRun({
      'citation-fit': judgeAll((id) => id.startsWith('card:C1')),
      'citation-fit:repair': (p) => ({ items: ids(p).map((id) => ({ id, action: 'drop', sentence: 'AI 预算多半由 IT 集中管' })) }),
    });
    const out = await citationFit(run, d, keyed);
    expect(answerOf(out, 'C1')).toBe('AI 预算 22% 由 IT 集中管 [E9]');
    expect(out).toMatchObject({ changed: false, fixes: [], counts: { removed: 0, flagged: 1 } });
    expect((run as unknown as { log: { mock: { calls: string[][] } } }).log.mock.calls.some((c) => c[0] === 'research:citation-fit-kept')).toBe(true);
  });

  it('still 挂错: citation_flags, the footnote as the report numbers it', async () => {
    const { run } = fakeRun({ 'citation-fit': judgeAll((id) => id.startsWith('card:') && id.endsWith(':E22'), '原文讲安全与风险') });
    const out = await citationFit(run, draft(), keyed);
    expect(out.misfits).toEqual([{ key: 'E22', sentence: '未采购的主要障碍是 ROI、数据与人才 [E22][E12]。', quote: e22.quote, reason: '原文讲安全与风险' }]);
    // 第 5 轮 (b): the sentence as the final body has it (rendered from the segments, its words joined differently)
    const body = ['- H2 的回答：席位与服务付钱；未采购的主要障碍多半是 ROI、数据与人才[^5][^3]。', '- 别的一句[^3]。', '', `[^3]: “${e12.quote}”（B 级）${e12.ref}`, `[^5]: “${e22.quote}”（C 级）${e22.ref}`].join('\n');
    expect(citationFlagsOf(out.misfits, body, keyed)).toEqual([{ footnote: '[^5]', ref: e22.ref, sentence: '未采购的主要障碍多半是 ROI、数据与人才[^5][^3]。', quote: e22.quote, reason: '原文讲安全与风险' }]);
    // a footnote no longer in the report: nothing to flag
    expect(citationFlagsOf(out.misfits, `正文[^3]。\n\n[^3]: “x”${e12.ref}`, keyed)).toEqual([]);
  });
});

describe('WS-A v7: the end mark, and a switch that narrows the words', () => {
  const e2 = ev({ quote: '银行保险机构应当建立模型算法产品外部引入的准入机制' });
  const e14 = ev({ quote: '监管要求与机队部署都把接入放在 IT 侧' });
  const keyed7 = new Map<string, Evidence>([...keyed, ['E2', e2], ['E14', e14]]);
  const answer = '准入由 IT 拍板 [E2]；决策与预算多半分散在 IT 与业务线 [E4]';
  const draft7 = () => {
    const j = judgmentSchema.parse({ ...judgment, answer, conditions: [{ n: 1, status: '成立', keys: ['E14'], note: '' }] });
    const r = { ...card, judgment: j, keyed: keyed7, conditions: [{ n: 1, label: '①', text: '准入在 IT 侧', status: '成立', keys: ['E14'], note: '' }] } as unknown as ClaimResult;
    return { results: [r], summary: summarySchema.parse({ so_what: '还答不了', results: ['H1 → x'] }) };
  };
  const wrongE2 = judgeAll((id) => id.endsWith(':E2'), '原文只要求建立准入机制，没说由 IT 拍板');

  it('the end mark stays: a softening without "；" gets it back, a different mark is put back', () => {
    expect(keepEndMark('准入由 IT 拍板 [E2]；', '准入是否由 IT 拍板，还缺证据')).toBe('准入是否由 IT 拍板，还缺证据；');
    expect(keepEndMark('准入由 IT 拍板 [E2]；', '准入多半在 IT 侧 [E14]。')).toBe('准入多半在 IT 侧 [E14]；');
    expect(keepEndMark('准入由 IT 拍板 [E2]', '准入多半在 IT 侧')).toBe('准入多半在 IT 侧');
  });

  it('a sentence with a "；" in it: the footnote taken out, the punctuation kept, the next clause as it was', async () => {
    const { run } = fakeRun({ 'citation-fit': wrongE2, 'citation-fit:repair': (p) => ({ items: ids(p).map((id) => ({ id, action: 'drop', sentence: '准入是否由 IT 拍板，还缺证据' })) }) });
    const out = await citationFit(run, draft7(), keyed7);
    expect(out.results[0].judgment.answer).toBe('准入是否由 IT 拍板，还缺证据；决策与预算多半分散在 IT 与业务线 [E4]');
  });

  it('switched to the card\'s own key with the words narrowed to its original ("由 IT 拍板" → "在 IT 侧"), judged before; the repair is told what the hypothesis holds', async () => {
    const { run, asked } = fakeRun({
      'citation-fit': wrongE2,
      'citation-fit:repair': (p) => ({ items: ids(p).map((id) => ({ id, action: 'replace', key: 'E14', sentence: '准入在 IT 侧 [E14]' })) }),
      'citation-fit:verify': judgeAll(() => false),
    });
    const out = await citationFit(run, draft7(), keyed7);
    expect(out.results[0].judgment.answer).toBe('准入在 IT 侧 [E14]；决策与预算多半分散在 IT 与业务线 [E4]');
    expect(out.fixes.map((f) => [f.action, f.from, f.to])).toEqual([['换编号', 'E2', 'E14'], ['降语气', null, null]]);
    expect(out.counts).toMatchObject({ replaced: 1, removed: 0, flagged: 0 });
    expect(asked[1].prompt).toContain('这个假设已经判成立的：H1 ① 准入在 IT 侧');
    expect(asked[1].prompt).toContain('    [E14] 监管要求与机队部署都把接入放在 IT 侧');
    // the narrowed sentence is what was judged
    expect(asked[2].prompt).toContain('句子：准入在 IT 侧 [E14]；\n  这个脚注：[E14]');
    // a narrowing that drops the other key or adds a number is not taken: the bare switch is judged instead
    const bad = fakeRun({ 'citation-fit': wrongE2, 'citation-fit:repair': (p) => ({ items: ids(p).map((id) => ({ id, action: 'replace', key: 'E14', sentence: '80% 的准入在 IT 侧 [E14]' })) }), 'citation-fit:verify': judgeAll(() => false) });
    await citationFit(bad.run, draft7(), keyed7);
    expect(bad.asked[2].prompt).toContain('句子：准入由 IT 拍板 [E14]；');
  });
});

describe('第 5 轮: a card with answer_segments is checked as it renders (W5 v6: a switch in `answer` never reached the page)', () => {
  const segCard = () => {
    const j = judgmentSchema.parse({ ...judgment, answer: '旧的整句 [E22]', answer_segments: [{ text: '准入由 IT 管住', cond: '①', keys: ['E22', 'E99'] }, { text: '预算多半分散', cond: '②', keys: ['E9'] }] });
    const r = { ...card, judgment: j, conditions: [{ n: 1, label: '①', text: 't', status: '成立', keys: ['E22', 'E4'], note: '' }, { n: 2, label: '②', text: 't', status: '证据不足', keys: ['E9'], note: '' }] } as unknown as ClaimResult;
    return { results: [r], summary: summarySchema.parse({ so_what: '还答不了', results: ['H1 → x'] }) };
  };

  it('each segment with its condition\'s keys (E99 is not shown, so not checked); `answer` not at all; a switch only to the condition\'s keys, written into the segment', async () => {
    expect(citationSites(segCard(), keyed).map((x) => `${x.part}:${x.key}:${x.sentence}`)).toEqual(['card:C1:seg:0:E22:准入由 IT 管住 [E22]', 'card:C1:seg:1:E9:预算多半分散 [E9]']);
    const { run, asked } = fakeRun({ 'citation-fit': judgeAll((id) => id.endsWith(':E22')), 'citation-fit:repair': (p) => ({ items: ids(p).map((id) => ({ id, action: 'replace', key: 'E4', sentence: '' })) }), 'citation-fit:verify': judgeAll(() => false) });
    const out = await citationFit(run, segCard(), keyed);
    expect(asked[1].prompt).toMatch(/可以换的证据：\n {4}\[E4\][^\n]*\n\n/); // only ①'s other key
    expect(out.results[0].judgment.answer_segments[0]).toEqual({ text: '准入由 IT 管住', cond: '①', keys: ['E4'] });
    expect(out.results[0].judgment.answer).toBe('旧的整句 [E22]');
    expect(out.counts).toMatchObject({ replaced: 1 });
  });
});

describe('a mocked full run', () => {
  let cleanup: (() => Promise<void>) | undefined;
  afterEach(async () => {
    vi.unstubAllGlobals();
    await cleanup?.();
    cleanup = undefined;
  });

  it('a footnote still 挂错 is written to frontmatter citation_flags; the report is delivered', async () => {
    clearPageCache();
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 200 })));
    const fx = await setup({ approved: true, claims: 1 });
    cleanup = fx.cleanup;
    const note = await fx.vault.read(PLAN);
    const data = note.data as Record<string, unknown> & { claims: Record<string, unknown>[] };
    data.claims = data.claims.map((c) => ({ ...c, question: '谁决定买？', parent: null }));
    data.mece_check = '一道关';
    await fx.vault.write(PLAN, { frontmatter: data, body: note.body }, { overwrite: true });
    let judged = 0;
    const m = scriptedModel({
      citationFit: (items) => {
        judged = items.length;
        return items.map((i, n) => ({ id: i.id, fit: n === 0 ? '挂错' : '撑得住', reason: n === 0 ? '原文讲的是别的事' : '' }));
      },
    });
    const ctx = await buildToolContext({ vault: fx.vault, role: ROLES.juniorA, workspacePath: WS, researchDir: RDIR, track: 'research', now: () => new Date('2026-10-26T10:00:00Z') });
    const r = await executeResearch({ ctx, mode: 'small', model: m.model, webClient: fakeWeb() });
    const report = await fx.vault.read(r.reportPath);
    const log = await fx.vault.readLog(fx.ctx.logPath);
    expect(judged).toBeGreaterThan(0);
    expect(m.tasks.filter((t) => t === 'citation-fit')).toHaveLength(1);
    // the first footnote is the Summary's: only flagged, nothing to repair (第 4 轮 D)
    expect(m.tasks).not.toContain('citation-fit:repair');
    expect(r.delivered).toBe(true);
    expect(report.data.citation_flags).toEqual([{ footnote: expect.stringMatching(/^\[\^\d+\]$/), ref: expect.stringMatching(/^\[\[.+#\^c\d+\]\]$/), sentence: expect.any(String), quote: expect.any(String), reason: '原文讲的是别的事' }]);
    const flag = (report.data.citation_flags as { footnote: string; sentence: string }[])[0];
    expect(report.body).toContain(`${flag.footnote}:`);
    expect(flag.sentence).not.toMatch(/E\d+/);
    expect(log.some((x) => x.action === 'research:citation-fit' && /用了 \d+ 秒/.test(x.change))).toBe(true);
    expect(log.some((x) => x.action === 'research:citation-flagged')).toBe(true);
    // nothing switched or taken out (the scripted repair proposes nothing): no citation_fixes; the appendix says so
    expect(report.data.citation_fixes).toBeUndefined();
    expect(report.body).toContain(`- 引用核对：查了 ${judged} 个，换了 0 个，删了 0 个，标了 1 个`);
  });

  it('a footnote taken out and the sentence softened: citation_fixes in frontmatter, the appendix line counts it', async () => {
    clearPageCache();
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 200 })));
    const fx = await setup({ approved: true, claims: 1 });
    cleanup = fx.cleanup;
    const note = await fx.vault.read(PLAN);
    const data = note.data as Record<string, unknown> & { claims: Record<string, unknown>[] };
    data.claims = data.claims.map((c) => ({ ...c, question: '谁决定买？', parent: null }));
    data.mece_check = '一道关';
    await fx.vault.write(PLAN, { frontmatter: data, body: note.body }, { overwrite: true });
    let target = '';
    const m = scriptedModel({
      judge: ({ supports, conditions }) => ({
        verdict: '成立', rebutted: [], revised_statement: null, support_lines: [`IT 主导 [${supports[0]}]`], counter_lines: ['已专门检索反证，没有找到 A/B 级的反证'], challenge_responses: [], reasoning: `准入在 IT [${supports[0]}]`, model_knowledge: [], so_what: ['所以联想先打 IT'], gaps: [], expert_questions: [],
        ...(conditions.length ? { conditions: conditions.map((n) => ({ n, status: '成立', keys: supports, note: '' })), changed: '没改', answer: `买方的关键是 IT 可管理性 [${supports[0]}]`, reasons: [`准入在 IT [${supports[0]}]`], short_statement: 'IT 把关' } : {}),
      }),
      citationFit: (items) => {
        target = items.find((i) => i.id.startsWith('card:'))!.id;
        return items.map((i) => ({ id: i.id, fit: i.id === target ? '挂错' : '撑得住', reason: i.id === target ? '原文讲的是别的事' : '' }));
      },
      citationRepair: (items) => items.map((i) => ({ id: i.id, action: 'drop', sentence: `多半${i.sentence.replace(/\s*\[E\d+\]/g, '')}` })),
    });
    const ctx = await buildToolContext({ vault: fx.vault, role: ROLES.juniorA, workspacePath: WS, researchDir: RDIR, track: 'research', now: () => new Date('2026-10-26T10:00:00Z') });
    const r = await executeResearch({ ctx, mode: 'small', model: m.model, webClient: fakeWeb() });
    const report = await fx.vault.read(r.reportPath);
    expect(r.delivered).toBe(true);
    expect(report.data.citation_flags).toBeUndefined();
    expect(report.data.citation_fixes).toEqual([
      { footnote: expect.stringMatching(/^\[\^\d+\]$/), ref: expect.stringMatching(/^\[\[/), action: '删脚注', from: expect.stringMatching(/^\[\^\d+\]$/), to: null, sentence_before: expect.stringMatching(/\[\^\d+\]/), sentence_after: expect.stringMatching(/^多半/) },
      expect.objectContaining({ action: '降语气', from: null, to: null }),
    ]);
    expect(report.body).toMatch(/多半买方的关键是 IT 可管理性/);
    expect(report.body).toMatch(/- 引用核对：查了 \d+ 个，换了 0 个，删了 1 个，标了 0 个/);
  });
});
