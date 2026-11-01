/**
 * D-21 (b) v4: what the full-budget follow-up got wrong, checked on the real fragments of 报告 v3 / v4
 * (tests/fixtures/d21b-v4, copied from C's run) and on the mock chain.
 */
import { readFileSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildToolContext } from '@/lib/harness';
import { carryHumanEdits, disprovenCitations, mergeSourceWarnings } from '@/lib/research/carry-over';
import { executeResearch } from '@/lib/research/execute';
import { addFollowUpSubQuestion, executeFollowUp, FIRST_HAND_PASSES, forcedGaps, judgmentChanged, revisedIn, rewriteSummary, staleMark } from '@/lib/research/followup';
import { clearPageCache } from '@/lib/research/page-cache';
import { mergeRecommendation, partsCiting, REC_HEADING } from '@/lib/research/recommendation-diff';
import { footnotesIn, renderRecommendation } from '@/lib/research/report';
import { recommendationSchema } from '@/lib/research/schemas';
import type { ClaimResult } from '@/lib/research/judge';
import { createVault } from '@/lib/vault';
import { ROLES } from '../helpers/fixture-vault';
import { fakeWeb, RDIR, RECOMMENDATION, scriptedModel, setup, WS } from './research-fixture';

vi.setConfig({ testTimeout: 60_000 });

const FX = 'tests/fixtures/d21b-v4';
const read = (f: string) => readFileSync(path.join(FX, f), 'utf8');
const v3Rec = read('v3-recommendation.md').trimEnd().split('\n');
const v4Summary = read('v4-summary.md').trimEnd().split('\n');
const v4Rec = v4Summary.slice(v4Summary.findIndex((l) => l.trim() === REC_HEADING));
const DISPROVEN_DEFS = read('v4-footnotes-disproven.md').trimEnd();
const SOURCE = '人工智能在金融领域的2025年法规解读与风险管理可行性分析报告.docx - 建立供应商“准入-监控-退出”全流程管控';
const NOTE = '查无此文件：所称金融监管总局 2024-06《金融机构人工智能风险管理指引（试行）》经人工核实不存在，最接近的金发〔2026〕8号细节对不上；同文档其余匿名机构说法也无法核实。';

/** v3's source_warnings and human_edits, as written by hand in its frontmatter. */
const V3_WARNING = {
  footnotes: ['36', '6', '35'],
  source: `[[10_资料库/${SOURCE}]]`,
  problem: '追加调查要求找一手原文，没有找到；经人工核实，监管总局官网和权威媒体都查无此文件。',
  action: '追加调查 (b) 排除这个来源后重新求证，结果见报告 v4。',
  found_by: '人工核实',
  found_on: '2026-10-25',
};
const V3_EDITS = [
  { kind: '错别字', where: 'Summary · AI 的推荐判断 · 其他选项（换一种拿法：合作）', before: '只所以不列为主路径', after: '之所以不列为主路径', date: '2026-10-25', basis: 'D-24（用户 2026-10-25 确认）', content_changed: false },
  { kind: '错别字', where: 'Summary · AI 的推荐判断 · 其他选项（换一种拿法：收购）', before: '不选，不适用：且本轮判断', after: '不选，不适用：本轮判断', date: '2026-10-25', basis: 'D-24（用户 2026-10-25 确认）', content_changed: false },
];

describe('1. v(N+1) keeps vN\'s source_warnings and human_edits; a disproven source still cited gets a warning by code', () => {
  const body = `## Summary\n- 正文引用 [^6] 和 [^35]、[^36]\n\n## 引文出处\n${DISPROVEN_DEFS}\n`;
  const found = [{ name: SOURCE, link: `[[${SOURCE}]]`, note: NOTE, footnotes: ['6', '35', '36'] }];

  it('vN\'s warning about the source is kept as written (problem by a person), with every footnote still citing it', () => {
    const out = mergeSourceWarnings([V3_WARNING], found, body, { today: '2026-10-26', vNext: 4 });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ problem: V3_WARNING.problem, found_by: '人工核实', source: V3_WARNING.source });
    expect([...out[0].footnotes].sort()).toEqual(['35', '36', '6']);
  });

  it('no warning in vN: code writes one, the problem from the note\'s reliability_note', () => {
    const [w] = mergeSourceWarnings([], found, body, { today: '2026-10-26', vNext: 4 });
    expect(w).toMatchObject({ footnotes: ['6', '35', '36'], source: `[[${SOURCE}]]`, problem: NOTE, found_on: '2026-10-26' });
    expect(w.found_by).toContain('reliability: disproven');
    expect(w.action).toContain('以 v4 的判断和更正为准');
  });

  it('a vN warning is kept only for footnotes the new body still defines', () => {
    const only6 = `## 引文出处\n${DISPROVEN_DEFS.split('\n').find((l) => l.startsWith('[^6]:'))}\n`;
    expect(mergeSourceWarnings([V3_WARNING], [], only6, { today: '2026-10-26', vNext: 4 })[0].footnotes).toEqual(['6']);
    expect(mergeSourceWarnings([V3_WARNING], [], '## 引文出处\n', { today: '2026-10-26', vNext: 4 })).toEqual([]);
  });

  it('disprovenCitations finds the footnotes whose source note is marked disproven (v4\'s [^6] [^35] [^36])', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'sw-v4-'));
    try {
      await mkdir(path.join(root, '10_资料库'), { recursive: true });
      const note = (name: string, extra: string) =>
        writeFile(
          path.join(root, '10_资料库', `${name}.md`),
          `---\nid: ${name.length}\ntype: source\nstatus: 推断\ncreated: "2026-10-24"\nupdated: "2026-10-24"\nauthor: AI\nderived_from: []\nrelates_to: []\nurl: https://www.renrendoc.com/paper/477316881.html\npublisher: 人人文库\ngrade: C\ngraded_by: AI\n${extra}---\n\n# ${name}\n\n## 论断\n\n「某城商行2025年实施的AI服务商白名单制度要求」 ^c1\n\n「另一条」 ^c2\n\n「第三条」 ^c3\n`,
        );
      await note(SOURCE, `reliability: disproven\nreliability_note: "${NOTE}"\n`);
      await note('一份没问题的资料', '');
      const defs = footnotesIn(`## 引文出处\n${DISPROVEN_DEFS}\n`).defs;
      const links = [...defs.values()].map((d) => /\[\[[^\]]+\]\]/.exec(d)?.[0]);
      expect(links.every(Boolean)).toBe(true);
      const ok = '[^90]: “另一条”（C 级，网络 · AI 定级）[[一份没问题的资料#^c2]]';
      const found2 = await disprovenCitations(createVault(root), `## 引文出处\n${DISPROVEN_DEFS}\n${ok}\n`);
      expect(found2).toHaveLength(1);
      expect(found2[0]).toMatchObject({ name: SOURCE, note: NOTE, footnotes: ['6', '35', '36'] });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('human_edits: kept while the corrected text is still in the body; where says so when it moved; dropped when gone', () => {
    const inSummary = `## Summary\n| 其他选项（换一种拿法：合作） | …之所以不列为主路径… |\n\n## 附录：过程记录\n- v3 的推荐判断（已被本版替换）：\n| 其他选项（换一种拿法：收购） | …不选，不适用：本轮判断… |\n`;
    const out = carryHumanEdits(V3_EDITS, inSummary, { from: '[[报告 v3]]', vNext: 4 });
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ where: V3_EDITS[0].where, after: '之所以不列为主路径', carried_from: '[[报告 v3]]', content_changed: false });
    expect(out[1].where).toBe(`${V3_EDITS[1].where}（v4 里在“附录：过程记录”）`);
    expect(carryHumanEdits(V3_EDITS, '## Summary\n（都改写了）\n', { from: '[[报告 v3]]', vNext: 4 })).toEqual([]);
    expect(carryHumanEdits(undefined, inSummary, { from: '[[报告 v3]]', vNext: 4 })).toEqual([]);
  });
});

describe('2. a recommendation cell that stood on a disproven source is never kept as "未变"', () => {
  const disproven = new Set(['6', '35', '36']);

  it('v3\'s 量级 cites [^6] (the anonymous city-bank whitelist): that part is found', () => {
    expect([...partsCiting(v3Rec, disproven)]).toEqual([['scale', ['6']]]);
  });

  it('nothing marked changed: 量级 is still replaced, and why says 上一版依据的来源已证伪', () => {
    const newScale = '| 量级 | 先在 3–5 家已有统一机队管理的受监管行业客户做打包交付试点，周期 2 个换机季度。（推断；估算依据：按一个试点周期覆盖一次采购评审估算） |';
    const newBlock = v4Rec.map((l) => (l.startsWith('| 量级 |') ? newScale : l));
    const { block, changes } = mergeRecommendation(v3Rec, newBlock, {}, disproven);
    expect(block).toContain(newScale);
    expect(block.join('\n')).not.toContain('受监管行业的实例证据只到单个机构的制度层面[^6]');
    const scale = changes.find((c) => c.part === 'scale')!;
    expect(scale.why).toBe('上一版依据的来源已证伪（[^6]），这一格不能沿用');
    // the model's own why, when it gave one, follows (said once)
    const withWhy = mergeRecommendation(v3Rec, newBlock, { scale: { changed: true, why: '改按试点周期估算' } }, disproven);
    expect(withWhy.changes.find((c) => c.part === 'scale')!.why).toBe('上一版依据的来源已证伪（[^6]），这一格不能沿用；改按试点周期估算');
    // without the disproven set, the same unmarked part is vN's
    expect(mergeRecommendation(v3Rec, newBlock, {}).block.join('\n')).toContain('受监管行业的实例证据只到单个机构的制度层面[^6]');
  });

  it('the rewrite has to mark such a part changed (a repair round asks for it)', () => {
    const forced = partsCiting(v3Rec, disproven);
    const rec = recommendationSchema.parse({ ...RECOMMENDATION, changes: { scale: { changed: false, why: '' } } });
    expect(forcedGaps(rec, forced)).toEqual([expect.stringContaining('“量级”这一格上一版依据的来源已证伪（[^6]）')]);
    expect(forcedGaps({ ...rec, changes: { scale: { changed: true, why: '上一版依据的来源已证伪' } } }, forced)).toEqual([]);
  });
});

describe('3. the Summary follows a judgment this version changed', () => {
  const lineOf = (lines: string[], re: RegExp) => lines.find((l) => re.test(l)) ?? '';

  it('v4 as written: H2\'s 理由 and the 一句话答案 still say v3\'s 门槛 / 资格条款 — not rewritten → marked as v3\'s text', () => {
    const { lines, replaced } = rewriteSummary(v4Summary, { label: 'H2', vPrev: 3, vNext: 4, changed: true, reason: '', soWhat: '' });
    expect(replaced).toEqual([]);
    expect(lineOf(lines, /^- 一句话答案：/)).toMatch(/^- 一句话答案：（v3 原文，以本版变化为准）有统一机队管理的大中型企业会把/);
    const h2 = lineOf(lines, /^\| H2 /).split('|');
    expect(h2[3].trim().startsWith(staleMark(3))).toBe(true);
    expect(h2[3]).toContain('白名单式的资格条款');
    // H1 is not touched; the workplan line about H2 is marked, the one about H1 is not
    expect(lineOf(lines, /^\| H1 /)).toBe(lineOf(v4Summary, /^\| H1 /));
    expect(lineOf(lines, /修正 H2：/)).toBe(`  - ${staleMark(3)}修正 H2：可管理性只按「前两层是入围门槛」写，审计追责一层标为空白；产品材料不要把它当涨价理由。`);
    expect(lineOf(lines, /修正 H1：/)).toBe(lineOf(v4Summary, /修正 H1：/));
    // marking twice does not stack; a second follow-up replaces v3's mark with its own
    expect(rewriteSummary(lines, { label: 'H2', vPrev: 3, vNext: 4, changed: true, reason: '', soWhat: '' }).lines).toEqual(lines);
    const v5 = rewriteSummary(lines, { label: 'H2', vPrev: 4, vNext: 5, changed: true, reason: '', soWhat: '' }).lines;
    expect(lineOf(v5, /^- 一句话答案：/)).toMatch(/^- 一句话答案：（v4 原文，以本版变化为准）有统一机队/);
    expect(lineOf(v5, /修正 H2：/)).toBe(`  - ${staleMark(4)}修正 H2：可管理性只按「前两层是入围门槛」写，审计追责一层标为空白；产品材料不要把它当涨价理由。`);
    expect(v5.join('\n')).not.toContain(staleMark(3));
  });

  it('rewritten: the new 理由 and 一句话答案 replace v3\'s, which are returned for the appendix', () => {
    const reason = '安全与 IT 管理工具集成被列为前列挑战[^8]，但没有条款或结果证据显示管不住的产品会被一票否决：先做入围、不承诺门槛。';
    const soWhat = '大中型企业会把可管理性当作采购评审的重要考量，但现有证据不支持把它当门槛[^8]。';
    const { lines, replaced } = rewriteSummary(v4Summary, { label: 'H2', vPrev: 3, vNext: 4, changed: true, reason, soWhat });
    expect(lineOf(lines, /^- 一句话答案：/)).toBe(`- 一句话答案：${soWhat}（v4 按本版判断重写）`);
    expect(lineOf(lines, /^\| H2 /).split('|')[3].trim()).toBe(`${reason}（v4 按本版判断重写）`);
    expect(lineOf(lines, /^\| H2 /).split('|')[2]).toContain('⇒ v4：需要修正'); // the real v4 row, as written then
    expect(replaced[0]).toMatch(/^ {2}- 一句话答案：有统一机队管理的大中型企业会把「能进机队、能被 IT 看见与登记」当作员工端侧个人 AI 的采购门槛/);
    expect(replaced[1]).toMatch(/^ {2}- H2 的理由：安全与治理在多项调研里被列为首要关切/);
  });

  it('judgment unchanged: the Summary is left alone', () => {
    expect(rewriteSummary(v4Summary, { label: 'H2', vPrev: 3, vNext: 4, changed: false, reason: 'x', soWhat: 'y' }).lines).toEqual(v4Summary);
  });

  it('"changed" includes a revised hypothesis that is not vN\'s, with the verdict staying 需要修改 (v4\'s H2)', () => {
    const v3Revised = '在有统一机队管理的大中型企业里，集中部署配置与数据权限边界这两层已经构成员工端侧个人 AI 的入围条件（缺了通常进不了评审）';
    const body = `## 逐个假设\n### H2 可管理性三层 [[x]]\n- 提议的判断：需要修改\n- 修正后的假设：${v3Revised}\n- 支持的证据：\n### H3 乙\n- 修正后的假设：别的\n`;
    expect(revisedIn(body, 'H2')).toBe(v3Revised);
    expect(revisedIn(body, 'H4')).toBeNull();
    const result = (revisedStatement: string | null) => ({ verdict: '需要修改', revisedStatement }) as unknown as ClaimResult;
    expect(judgmentChanged({ from: '需要修改', result: result('只支持可管理性是采购评审中的重要考量之一，没有证据显示它被写成资格条款'), baseRevised: v3Revised })).toEqual({ verdict: false, revised: true, any: true });
    expect(judgmentChanged({ from: '需要修改', result: result(`${v3Revised}。`), baseRevised: v3Revised }).any).toBe(false);
    expect(judgmentChanged({ from: '成立', result: result(null), baseRevised: null })).toEqual({ verdict: true, revised: false, any: true });
  });
});

describe('small: alternatives row by row, and no "不选，不选："', () => {
  it('v4: only the NPU row\'s reason changed — the other three are v3\'s rows word for word (the hand-corrected 之所以 included)', () => {
    const rows = [{ changed: true, why: '[^86][^87][^88] 给押端侧算力补了新的不选理由' }, { changed: false, why: '' }, { changed: false, why: '' }, { changed: false, why: '' }];
    const { block, changes, keptRows } = mergeRecommendation(v3Rec, v4Rec, { alternatives: { changed: true, why: '端侧算力', rows } });
    const alt = (b: string[]) => b.filter((l) => l.startsWith('| 其他选项'));
    const v3Alt = alt(v3Rec);
    const v4Alt = alt(v4Rec);
    expect(alt(block)).toEqual([v4Alt[0], v3Alt[1], v3Alt[2], v3Alt[3]]);
    expect(block.join('\n')).toContain('之所以不列为主路径');
    const c = changes.find((x) => x.part === 'alternatives')!;
    expect(c.before).toHaveLength(1);
    expect(c.after).toHaveLength(1);
    expect(c.before[0]).toMatch(/^其他选项（押别的层）：押端侧算力（NPU）层：/);
    expect(c.why).toBe('[^86][^87][^88] 给押端侧算力补了新的不选理由');
    // 7 single-row parts are untouched (v3 had no 怎么回应高层指示: that row is new) + 3 kept alternatives
    expect(keptRows).toBe(5 + 3);
  });

  it('a row matches vN\'s by its option name even when the punctuation differs (终端管理/安全 vs 终端管理、安全)', () => {
    const swapped = [...v4Rec];
    const i = swapped.findIndex((l) => l.includes('换一种拿法：合作'));
    const rows = swapped.filter((l) => l.startsWith('| 其他选项')).map((l) => ({ changed: l.includes('合作'), why: l.includes('合作') ? '新证据 [^90]' : '' }));
    const { changes } = mergeRecommendation(v3Rec, swapped, { alternatives: { changed: true, why: 'x', rows } });
    const c = changes.find((x) => x.part === 'alternatives')!;
    expect(i).toBeGreaterThan(0);
    expect(c.before).toEqual([expect.stringContaining('与终端管理/安全生态厂商合作补齐管理栈')]);
    expect(c.after).toEqual([expect.stringContaining('与终端管理、安全生态厂商合作补齐管理栈')]);
  });

  it('a why_not that opens with 不选 is not doubled; 不适用 and 不选择 are left as they are', () => {
    const rec = recommendationSchema.parse({
      ...RECOMMENDATION,
      alternatives: [
        { dimension: 'layer', option: '押端侧算力（NPU）层', kind: '其他', why_not: '不选：硬件支出增长主要由 ASP 上涨驱动' },
        { dimension: 'acquire', option: '收购一家终端管理厂商', kind: '收购', why_not: '不适用：投入产出不成立' },
        { dimension: 'acquire', option: '合作', kind: '合作', why_not: '不选择它，是因为差异化落在对方平台上' },
      ],
    });
    const text = renderRecommendation(rec, (t) => t).join('\n');
    expect(text).toContain('押端侧算力（NPU）层：不选，硬件支出增长主要由 ASP 上涨驱动 |');
    expect(text).not.toMatch(/不选，不选[：:，,]/);
    expect(text).toContain('收购一家终端管理厂商：不选，不适用：投入产出不成立 |');
    expect(text).toContain('合作：不选，不选择它，是因为差异化落在对方平台上 |');
  });
});

// ── the mock chain ──────────────────────────────────────────────────────────

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

const QUESTION = '集中部署配置和数据权限边界，是否真的写进了采购的资格条款';

describe('1 + 2 + 4 on the mock chain: carry-over, a disproven source under 量级, a directive row vN did not have', () => {
  it('v2 carries v1\'s warning and edits, warns about the disproven source, rewrites 量级, and logs no revert for the new row', async () => {
    const fx = await setup({ meeting: true, approved: true });
    cleanup = fx.cleanup;
    const first = await executeResearch({ ctx: fx.ctx, mode: 'small', model: scriptedModel().model, webClient: fakeWeb() });
    expect(first.delivered).toBe(true);
    const v1 = await fx.vault.read(first.reportPath);
    // one footnote's source is found wrong after v1 (a person sets reliability: disproven)
    const [n, def] = [...footnotesIn(v1.body).defs].find(([, d]) => /10_资料库|资料/.test(d))!;
    const link = /\[\[([^\]#|]+)/.exec(def)![1];
    const res = await fx.vault.resolveLink(`[[${link}]]`);
    if (!res.ok) throw new Error(`no source note for ${link}`);
    const src = await fx.vault.read(res.path);
    await fx.vault.write(res.path, { frontmatter: { ...src.data, reliability: 'disproven', reliability_note: '经人工核实查无此文件' }, body: src.body }, { overwrite: true });
    // v1 as v3 was: 量级 cites it, no 怎么回应高层指示 row, a hand correction and a warning about another footnote
    const otherFn = [...footnotesIn(v1.body).defs.keys()].find((k) => k !== n)!;
    const body = v1.body
      .split('\n')
      .filter((l) => !l.startsWith('| 怎么回应高层指示 |'))
      .map((l) => (l.startsWith('| 量级 |') ? l.replace(/ \|$/, `[^${n}] |`) : l))
      .join('\n');
    const edit = { kind: '错别字', where: 'Summary · AI 的推荐判断 · 做什么', before: '由商用产品线牵投', after: '由商用产品线牵头', date: '2026-10-25', basis: 'D-24', content_changed: false };
    const warning = { footnotes: [String(otherFn)], source: '[[别的资料]]', problem: '人工发现这条转述有误', action: '以原文为准', found_by: '人工核实', found_on: '2026-10-25' };
    await fx.vault.write(first.reportPath, { frontmatter: { ...v1.data, human_edits: [edit], source_warnings: [warning] }, body }, { overwrite: true });

    const added = await addFollowUpSubQuestion({ vault: fx.vault, workspacePath: WS, researchDir: RDIR, role: ROLES.juniorA, claimId: 'C1', question: QUESTION });
    const ctx = await buildToolContext({ vault: fx.vault, role: ROLES.juniorA, workspacePath: WS, researchDir: RDIR, track: 'research', now: () => new Date('2026-10-26T10:00:00Z') });
    const recommendation = (prompt: string) => {
      const directive = /^\[(M\d+)\]（高层指示/m.exec(prompt)?.[1];
      const key = /关键证据：\[(E\d+)\]/.exec(prompt)?.[1];
      // the prompt names the part that stood on the disproven source
      expect(prompt).toContain('上一版这几格的依据已被人工核实为不可靠');
      expect(prompt).toMatch(/ {2}- 量级：依据的资料「/);
      return {
        ...RECOMMENDATION,
        directive_response: `修正：方向成立，但只在管理严格的企业里 [${directive}]`,
        scale: '先在 2–3 家大客户试点，一个采购周期',
        scale_basis: '按一个试点周期覆盖一次采购评审估算',
        changes: {
          directive_response: { changed: true, why: '上一版的回应口径要改' }, // no new evidence: but v1 had no such row
          scale: { changed: true, why: '上一版依据的来源已证伪，改按试点周期估算' },
        },
        summary_update: { reason: `按这一版的判断重写的理由${key ? ` [${key}]` : ''}`, so_what: '' },
      };
    };
    const follow = await executeFollowUp({ ctx, claimId: 'C1', subQuestionId: added.subQuestionId, model: scriptedModel({ recommendation }).model, webClient: fakeWeb() });
    expect(follow.failedChecks).toEqual([]);
    const v2 = await fx.vault.read(follow.reportPath);

    // 1: carried over, and the disproven source warned about by code
    const warnings = v2.data.source_warnings as { footnotes: string[]; source: string; problem: string; found_by: string }[];
    expect(warnings).toContainEqual(expect.objectContaining({ source: '[[别的资料]]', problem: '人工发现这条转述有误', footnotes: [String(otherFn)] }));
    const auto = warnings.find((w) => w.problem === '经人工核实查无此文件')!;
    expect(auto.footnotes).toContain(String(n));
    expect(auto.found_by).toContain('reliability: disproven');
    expect(v2.data.human_edits).toEqual([{ ...edit, carried_from: expect.stringContaining('报告 v1') }]);

    // 2: 量级 is the new text, and 本版变化 says why
    const change = v2.body.slice(v2.body.indexOf('## 本版变化'), v2.body.indexOf('## 怎么查的'));
    expect(v2.body).toContain('| 量级 | 先在 2–3 家大客户试点，一个采购周期（推断；估算依据：按一个试点周期覆盖一次采购评审估算） |');
    expect(change).toContain('  - 量级（变了）：');
    expect(change).toContain(`    - 为什么：上一版依据的来源已证伪（[^${n}]），这一格不能沿用；改按试点周期估算`);

    // 4: the directive row v1 did not have is new — no "reverted to v1's text" for a row that never existed
    expect(change).toContain('  - 怎么回应高层指示（变了）：');
    expect(change).toContain('    - 为什么：上一版没有这一格，这一版新加');
    const log = await fx.vault.readLog(fx.ctx.logPath);
    expect(log.filter((r) => r.action === 'research:recommend-reverted')).toEqual([]);
  });
});

describe('3 on the mock chain: the verdict moves, the Summary follows', () => {
  async function moved(recommendation?: null) {
    const fx = await setup({ approved: true });
    cleanup = fx.cleanup;
    const first = await executeResearch({ ctx: fx.ctx, mode: 'small', model: scriptedModel().model, webClient: fakeWeb() });
    expect(first.delivered).toBe(true);
    // v1 proposed 证据不足 for H1; the follow-up judges 成立: the verdict moves
    const v1 = await fx.vault.read(first.reportPath);
    await fx.vault.write(first.reportPath, { frontmatter: { ...v1.data, verdicts_proposed: { C1: '证据不足' } }, body: v1.body }, { overwrite: true });
    const added = await addFollowUpSubQuestion({ vault: fx.vault, workspacePath: WS, researchDir: RDIR, role: ROLES.juniorA, claimId: 'C1', question: QUESTION });
    const ctx = await buildToolContext({ vault: fx.vault, role: ROLES.juniorA, workspacePath: WS, researchDir: RDIR, track: 'research' });
    const follow = await executeFollowUp({ ctx, claimId: 'C1', subQuestionId: added.subQuestionId, model: scriptedModel(recommendation === null ? { recommendation: null } : {}).model, webClient: fakeWeb() });
    expect(follow.followUp).toMatchObject({ from: '证据不足', to: '成立', changed: true });
    const v2 = await fx.vault.read(follow.reportPath);
    const summary = v2.body.slice(v2.body.indexOf('## Summary'), v2.body.indexOf('## 本版变化'));
    return { follow, v1, v2, summary };
  }

  it('H1\'s 理由 is the rewrite (v1\'s goes to the appendix); the 一句话答案 the model kept is marked as v1\'s text', async () => {
    const { follow, v1, v2, summary } = await moved();
    expect(follow.delivered).toBe(true);
    const h1 = summary.split('\n').find((l) => l.startsWith('| H1 '))!.split('|');
    expect(h1[3]).toMatch(/^ 按这一版的判断重写的理由\[\^\d+\]（v2 按本版判断重写） $/);
    expect(summary).toMatch(/^- 一句话答案：（v1 原文，以本版变化为准）买方的关键是 IT 可管理性/m);
    const oldReason = v1.body.split('\n').find((l) => l.startsWith('| H1 '))!.split('|')[3].trim();
    const appendix = v2.body.slice(v2.body.indexOf('## 附录'));
    expect(appendix).toContain('- v1 的 Summary 原文（这一版按新的判断重写了的句子）：');
    expect(appendix).toContain(`  - H1 的理由：${oldReason}`);
  });

  it('the rewrite failed: the report is a draft, and H1\'s 理由 is marked as v1\'s text (never left to contradict)', async () => {
    const { follow, summary } = await moved(null);
    expect(follow.delivered).toBe(false);
    expect(summary.split('\n').find((l) => l.startsWith('| H1 '))!.split('|')[3]).toMatch(/^ （v1 原文，以本版变化为准）/);
  });
});

describe('5. a full-budget follow-up looks for first-hand sources before it may stop', () => {
  async function fullFollowUp(web: ReturnType<typeof fakeWeb>) {
    const fx = await setup({ approved: true });
    cleanup = fx.cleanup;
    const first = await executeResearch({ ctx: fx.ctx, mode: 'small', model: scriptedModel().model, webClient: fakeWeb() });
    expect(first.delivered).toBe(true);
    const added = await addFollowUpSubQuestion({ vault: fx.vault, workspacePath: WS, researchDir: RDIR, role: ROLES.juniorA, claimId: 'C1', question: QUESTION });
    const ctx = await buildToolContext({ vault: fx.vault, role: ROLES.juniorA, workspacePath: WS, researchDir: RDIR, track: 'research' });
    const follow = await executeFollowUp({ ctx, claimId: 'C1', subQuestionId: added.subQuestionId, model: scriptedModel().model, webClient: web, budget: 'full' });
    return { fx, follow, v2: await fx.vault.read(follow.reportPath), log: await fx.vault.readLog(fx.ctx.logPath) };
  }

  it('only C-grade pages: every kind of first-hand source, in Chinese and in English, then 证据不足', async () => {
    const web = fakeWeb();
    const { v2, log } = await fullFollowUp(web);
    const passes = log.filter((r) => r.action === 'research:first-hand');
    expect(passes).toHaveLength(FIRST_HAND_PASSES.length * 2);
    for (const p of FIRST_HAND_PASSES) {
      expect(passes.some((r) => r.change.includes(`${p.kind} · 中文`))).toBe(true);
      expect(passes.some((r) => r.change.includes(`${p.kind} · 英文`))).toBe(true);
    }
    // the English passes searched in English
    expect(web.searches.filter((q) => /^enterprise AI PC procurement tender/.test(q))).toHaveLength(FIRST_HAND_PASSES.length);
    expect(web.searches.length).toBeGreaterThanOrEqual(2 + FIRST_HAND_PASSES.length * 2);
    expect(v2.body).toContain('- 追加调查（v2）找一手来源（完整调查的预算：没有 A/B 级一手来源之前不停；查完仍没有找到，这一问判为证据不足，转成要问专家的问题）：');
    expect(v2.body).toMatch(/ {2}- 监管规定原文 · 英文：「enterprise AI PC procurement tender \d+」→ 读了 \d+ 页，新增 A\/B 级一手来源 0 条/);
    expect(v2.body).toContain('  - 这一问的结论：证据不足（这次没有找到一手来源），转成要问专家的问题');
  });

  it('an A-grade page in the first pass: the passes stop there, and the conclusion is not 证据不足', async () => {
    const web = fakeWeb();
    const search = web.search.bind(web);
    let k = 0;
    web.search = async (req) => {
      const out = await search(req);
      if (!req.query.includes('员工 并不在乎')) out.results = out.results.map((r) => ({ ...r, url: `https://www.stats.gov.cn/sj/report/${900 + ++k}`, site_name: '国家统计局' }));
      return out;
    };
    const { v2, log } = await fullFollowUp(web);
    expect(log.filter((r) => r.action === 'research:first-hand').length).toBeLessThanOrEqual(1);
    expect(v2.body).not.toContain('这一问的结论：证据不足（这次没有找到一手来源）');
  });

  it('the small budget is unchanged: no first-hand passes', async () => {
    const fx = await setup({ approved: true });
    cleanup = fx.cleanup;
    const first = await executeResearch({ ctx: fx.ctx, mode: 'small', model: scriptedModel().model, webClient: fakeWeb() });
    expect(first.delivered).toBe(true);
    const added = await addFollowUpSubQuestion({ vault: fx.vault, workspacePath: WS, researchDir: RDIR, role: ROLES.juniorA, claimId: 'C1', question: QUESTION });
    const ctx = await buildToolContext({ vault: fx.vault, role: ROLES.juniorA, workspacePath: WS, researchDir: RDIR, track: 'research' });
    await executeFollowUp({ ctx, claimId: 'C1', subQuestionId: added.subQuestionId, model: scriptedModel().model, webClient: fakeWeb() });
    expect((await fx.vault.readLog(fx.ctx.logPath)).some((r) => r.action === 'research:first-hand')).toBe(false);
  });
});
