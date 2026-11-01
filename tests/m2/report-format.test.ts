/**
 * D-20 report format: Chinese claims + key numbers + footnote markers in the body, the verbatim quote, grade and
 * source in footnotes (still checked by check_citations); tables; "怎么查的" in three lines plus an appendix; no
 * internal ids; "AI 的推荐判断（提议，待你拍板）" at the end of Summary, where an estimate marked 推断 with its basis passes.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { executeResearch } from '@/lib/research/execute';
import { clearPageCache } from '@/lib/research/page-cache';
import { Footnotes, footnotesIn, keyNumbers, plainWords, withFootnotesInline } from '@/lib/research/report';
import { checkReportText } from '@/lib/research/selfcheck';
import type { Evidence } from '@/lib/research/evidence';
import { fakeWeb, RECOMMENDATION, scriptedModel, setup } from './research-fixture';

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

async function report(script: Parameters<typeof scriptedModel>[0] = {}, opts: Parameters<typeof setup>[0] = {}) {
  const fx = await setup({ expert: true, ...opts });
  cleanup = fx.cleanup;
  const sm = scriptedModel(script);
  const r = await executeResearch({ ctx: fx.ctx, mode: 'small', model: sm.model, webClient: fakeWeb() });
  return { ...fx, r, sm, body: (await fx.vault.read(r.reportPath)).body };
}

const section = (body: string, h: string) => {
  const lines = body.split('\n');
  const i = lines.findIndex((l) => l === `## ${h}`);
  const j = lines.findIndex((l, k) => k > i && /^## /.test(l));
  return lines.slice(i + 1, j < 0 ? undefined : j).filter((l) => l.trim());
};

describe('the delivered report in the D-20 format', () => {
  it('body lines carry footnote markers, never quotes; every footnote is a verified citation', async () => {
    const { r, body, vault } = await report();
    expect(r.delivered).toBe(true);
    const main = body.split('## 引文出处')[0];
    const claims = main.split('## 逐个假设')[1].split('## 对 workplan 的影响')[0];
    expect(claims).not.toMatch(/\[\[[^\]]+#\^c\d+\]\]/); // no block citation inline in the claims
    expect(claims).toMatch(/\[\^\d+\]/);
    const notes = section(body, '引文出处');
    expect(notes.length).toBeGreaterThan(0);
    expect(notes.every((l) => /^\[\^\d+\]: “[^”]+”（[^）]+）\[\[[^\]]+#\^[ce]\d+\]\]$/.test(l))).toBe(true);
    const checks = await vault.checkCitations(body);
    expect(checks.length).toBe(notes.length + checks.filter((c) => !notes.some((n) => n.includes(c.link))).length);
    expect(checks.every((c) => c.ok && c.quote)).toBe(true);
  });

  it('Summary: the claims table and the recommendation table, closing with the proposal line', async () => {
    const { body } = await report();
    const s = section(body, 'Summary');
    expect(s).toContain('| 论点 | 提议的判断 | 理由 | 证据 |');
    expect(s.some((l) => /^\| H1 .* \| (成立|不成立|需要修改|证据不足) \| .* \| 支持 .* · 反证 \d+/.test(l))).toBe(true);
    expect(s).toContain('- AI 的推荐判断（提议，待你拍板）：');
    for (const row of ['| 做什么 |', '| 量级 |', '| 看什么指标 |', '| 其他选项（押别的层） |', '| 其他选项（换一种拿法：合作） |', '| 其他选项（换一种拿法：收购） |', '| 什么情况下要改 |']) expect(s.some((l) => l.startsWith(row))).toBe(true);
    expect(s.find((l) => l.startsWith('| 量级 |'))).toMatch(/（推断；估算依据：按一个试点周期/);
    expect(s).toContain('以上全部是 AI 提议，状态只有人能改。');
  });

  it('怎么查的 is three lines (the starting point first); the rest of the record is in the appendix', async () => {
    const { body } = await report({}, { meeting: true });
    const how = section(body, '怎么查的').filter((l) => /^- /.test(l));
    expect(how).toHaveLength(3);
    expect(how[0]).toMatch(/^- 这次调查的出发点/);
    expect(how[1]).toMatch(/^- 查了：/);
    expect(how[2]).toMatch(/^- 判断标准：至少 2 个互相独立的来源支持/);
    const appendix = section(body, '附录：过程记录');
    expect(appendix.some((l) => l.startsWith('- 调查计划：'))).toBe(true);
    expect(appendix.some((l) => l.startsWith('- H1 的检索：'))).toBe(true);
  });

  it('no section numbers, gate codes or field names in the text (links keep their names)', async () => {
    const { body } = await report();
    const prose = body.replace(/\[\[[^\]]*\]\]/g, '');
    expect(prose).not.toMatch(/§\s*\d|derived_from|relates_to|\bG1\b/);
  });

  it('support and challenge tables: one row per line, the challenge answered with its effect', async () => {
    const { body } = await report();
    expect(body).toContain('| 论断 | 关键数字 | 等级 | 出处 |');
    expect(body).toContain('| 挑战 | 回应 | 结论 | 出处 |');
    expect(body).toMatch(/^\| 说换机由别的原因推动、员工会绕开管理 \| 不否定 IT 在采购里的决策角色\[\^\d+\] \| 不影响判断 \| \[\^\d+\] \|$/m);
  });

  it('a recommendation without the build / partner / buy dimension, or without the estimate basis, is not delivered', async () => {
    const noBuy = { ...RECOMMENDATION, alternatives: RECOMMENDATION.alternatives.filter((a) => a.kind !== '收购') };
    const a = await report({ recommendation: noBuy });
    expect(a.r.delivered).toBe(false);
    expect(a.r.failedChecks.join('\n')).toMatch(/推荐判断不完整：其他选项里没有覆盖“收购”/);
    await cleanup?.();
    cleanup = null;
    const b = await report({ recommendation: { ...RECOMMENDATION, scale_basis: '' } });
    expect(b.r.delivered).toBe(false);
    expect(b.r.failedChecks.join('\n')).toMatch(/量级标了推断，但没有写是怎么估的/);
    expect(b.sm.tasks).toContain('recommend:repair'); // what was missing went back to the recommendation call
  });
});

describe('self-check rules for the new format', () => {
  const base = (rec: string) => `# R 调查报告 v1

## Summary
- 要回答的问题：x
- 一句话答案：门槛[^1]
- AI 的推荐判断（提议，待你拍板）：

| | 提议 |
|---|---|
${rec}

以上全部是 AI 提议，状态只有人能改。

## 怎么查的
- 查了：知识库 3 份

## 逐个假设
### H1 x
- 提议的判断：证据不足（AI 提议）
- 支持的证据：

| 论断 | 关键数字 | 等级 | 出处 |
|---|---|---|---|
| 77% 的 CIO 把安全列为最大障碍 | 77% | B | [^1] |

- 反证和挑战（逐条回应）：
  - 已专门检索反证，没有找到 A/B 级的反证
- 推导（推断）：x[^1]

## 对 workplan 的影响
- 无

## 引文出处
[^1]: “77% of CIOs said security”（B 级，知识库）[[资料#^c1]]
`;
  it('an estimate in 量级 passes when it says 推断 and how it was estimated; a number elsewhere in the recommendation does not', () => {
    expect(checkReportText(base('| 量级 | 2–3 家客户、6–9 个月（推断；估算依据：一个采购评审周期） |'))).toEqual([]);
    const f = checkReportText(base('| 量级 | 2–3 家客户（推断；估算依据：没有写） |\n| 看什么指标 | 6 个月内 30% 写进条款 |\n| 做什么 | 先访谈 10 家 |'));
    expect(f.map((x) => x.code)).toEqual(['uncited_number', 'uncited_number']); // 量级 without its basis, and 做什么
    expect(f[1].message).toMatch(/推荐判断里这一行有数字但没有出处/);
    expect(f.some((x) => x.excerpt?.includes('看什么指标'))).toBe(false); // a target and a time point are proposals
  });
  it('a footnote marker without a definition fails; a support row without a marker fails', () => {
    const missing = base('| 做什么 | x |').replace('x[^1]', 'x[^9]');
    expect(checkReportText(missing).map((x) => x.code)).toContain('unknown_footnote');
    const uncited = base('| 做什么 | x |').replace('| 77% | B | [^1] |', '| 77% | B | — |');
    expect(checkReportText(uncited).map((x) => x.code)).toContain('uncited_line');
  });
});

describe('footnote helpers', () => {
  const ev = (ref: string, quote: string) => ({ ref, quote, grade: 'B', origin: '知识库', gradedBy: 'AI', sourceKind: 'source' }) as unknown as Evidence;
  it('one number per block, numbering continues from a seed', () => {
    const n = new Footnotes();
    expect(n.cite(ev('[[a#^c1]]', 'x'))).toBe('[^1]');
    expect(n.cite(ev('[[b#^c1]]', 'y'))).toBe('[^2]');
    expect(n.cite(ev('[[a#^c1]]', 'x'))).toBe('[^1]');
    const seed = footnotesIn(`## 引文出处\n${n.lines().join('\n')}\n`);
    const m = new Footnotes({ byRef: seed.byRef, max: seed.max });
    expect(m.cite(ev('[[a#^c1]]', 'x'))).toBe('[^1]');
    expect(m.cite(ev('[[c#^c2]]', 'z'))).toBe('[^3]');
    expect(m.lines()).toEqual(['[^3]: “z”（B 级，知识库）[[c#^c2]]']);
  });
  it('withFootnotesInline puts the definition next to its marker (for readers of block citations, e.g. M3)', () => {
    const body = '### H1\n- 支持 x[^1]\n\n## 引文出处\n[^1]: “q”（B 级，知识库）[[a#^c1]]\n';
    expect(withFootnotesInline('- 支持 x[^1]', body)).toBe('- 支持 x[^1]（“q”（B 级，知识库）[[a#^c1]]）');
  });
  it('plainWords and keyNumbers', () => {
    expect(plainWords('按 §9.5 判断，G1 之前跑的，见 [[G1 2026-10-24]]')).toBe('按判断标准判断，研究计划批准之前跑的，见 [[G1 2026-10-24]]');
    expect(keyNumbers('77% 的 CIO，2026 年，82.9% 被推迟[^3]')).toBe('77%、82.9%');
  });
});

describe('readers of the report in other modules', () => {
  it('M4 readTeamReport counts the challenge table rows and their footnote citations', async () => {
    const { readTeamReport } = await import('@/evals/report-reader');
    const { body } = await report();
    const f = readTeamReport(body);
    expect(f.claimsWithCounter).toBe(1);
    expect(f.counterBullets).toBeGreaterThan(0);
    expect(f.counterCited).toBe(f.counterBullets);
    expect(f.searches).not.toBeNull();
  });

  it('M3 insufficientOnlyBlocks finds the blocks a 证据不足 claim cites through its footnotes', async () => {
    const { insufficientOnlyBlocks } = await import('@/lib/decisions/check');
    const weak = await report({ judge: (k) => ({ verdict: '证据不足', rebutted: [], revised_statement: null, support_lines: k.supports.slice(0, 1).map((e) => `IT 参与采购 [${e}]`), counter_lines: [], challenge_responses: k.refutes.map((c) => ({ key: c, challenge: '员工会绕开', response: '证据不足以判断', effect: '推不翻' })), reasoning: '还不够', model_knowledge: [], so_what: [], gaps: [], expert_questions: [] }) });
    const blocks = await insufficientOnlyBlocks(weak.vault, weak.body, weak.r.reportPath);
    expect(blocks.size).toBeGreaterThan(0);
  });
});

describe('a long answer that is not valid JSON (live run 10/25: the summary with its recommendation)', () => {
  it('parseLenient repairs unescaped quotes and raw newlines inside strings', async () => {
    const { extractJson } = await import('@/lib/research/llm');
    expect(extractJson('{"scale": "2–3 家（标"推断"）", "basis": "按一个\n周期估"}')).toEqual({ scale: '2–3 家（标"推断"）', basis: '按一个\n周期估' });
    expect(extractJson('```json\n{"a": ["x "y" z", "w"]}\n```')).toEqual({ a: ['x "y" z', 'w'] });
  });

  it('a summary that never parses does not end the run: the answer falls back to the verdicts, the recommendation has its own call', async () => {
    const { r, vault, ctx, body, sm } = await report({ brokenSummary: true });
    expect(r.reportPath).toBeTruthy();
    expect(body).toMatch(/- 一句话答案：H1 (成立|不成立|需要修改|证据不足)/);
    expect(sm.tasks).toContain('recommend');
    expect(body).toContain('| 做什么 |');
    const log = await vault.readLog(ctx.logPath);
    expect(log.some((l) => l.action === 'research:summary-fallback')).toBe(true);
  });
});

describe('the same evidence twice in one sentence', () => {
  it('both markers stay (footnotes), so the sentence is not left with a hole', async () => {
    const { expandCitations } = await import('@/lib/research/report');
    const e = { ref: '[[a#^c1]]', quote: 'x', grade: 'B', origin: '知识库', gradedBy: 'AI', sourceKind: 'source' } as unknown as Evidence;
    const f = { ref: '[[b#^c1]]', quote: 'y', grade: 'B', origin: '知识库', gradedBy: 'AI', sourceKind: 'source' } as unknown as Evidence;
    const keyed = new Map([['E2', e], ['E4', f]]);
    expect(expandCitations('[E2] 显示门槛，且 [E4] 与 [E2] 同出 IDC', keyed, new Footnotes()).text).toBe('[^1] 显示门槛，且[^2] 与[^1] 同出 IDC');
  });
});

describe('recommendation alternatives in the shapes the model really returns', () => {
  it('strings and name/reason objects become {option, kind, why_not}', async () => {
    const { recommendationSchema } = await import('@/lib/research/schemas');
    const r = recommendationSchema.parse({
      ...RECOMMENDATION,
      alternatives: ['收购：收购一家终端管理公司：不选，量级不匹配', { name: '和平台厂商合作', reason: '差异化落在对方平台上' }],
    });
    expect(r.alternatives).toEqual([
      { option: '收购', kind: '收购', why_not: '收购一家终端管理公司：不选，量级不匹配', dimension: 'acquire' },
      expect.objectContaining({ option: '和平台厂商合作', kind: '合作', why_not: '差异化落在对方平台上' }),
    ]);
  });
});

describe('the recommendation call', () => {
  it('a model that leaves it out (twice) gets the report kept as a draft, with the gap named', async () => {
    const { r, sm } = await report({ recommendation: null });
    expect(r.delivered).toBe(false);
    expect(r.failedChecks.join('\n')).toMatch(/推荐判断不完整：推荐判断整段没有写/);
    expect(sm.tasks.filter((t) => t.startsWith('recommend')).length).toBeGreaterThan(1);
  });
  it('near-miss shapes are accepted: scale as an object, metrics as one string, a missing why_not is flagged', async () => {
    const { recommendationSchema } = await import('@/lib/research/schemas');
    const { recommendationGaps } = await import('@/lib/research/report');
    const r = recommendationSchema.parse({ ...RECOMMENDATION, scale: { range: '2–3 家', time: '6 个月' }, metrics: '一；二', alternatives: [...RECOMMENDATION.alternatives, { option: '自建平台', kind: '自研' }] });
    expect(r.scale).toBe('2–3 家；6 个月');
    expect(r.metrics).toEqual(['一', '二']);
    expect(recommendationGaps(r)).toEqual(['其他选项“自建平台”没有写不选的理由']);
  });
});

describe('table cells keep a reference made inside the sentence', () => {
  it('only the markers at the end move to the 出处 column', async () => {
    const { splitMarkers } = await import('@/lib/research/report');
    expect(splitMarkers('与[^5] 同向，说明门槛在执行层面松[^6]。')).toEqual({ claim: '与[^5] 同向，说明门槛在执行层面松。', markers: '[^6]' });
    expect(splitMarkers('IT 部门主导采购 [^1][^2]')).toEqual({ claim: 'IT 部门主导采购', markers: '[^1][^2]' });
    expect(splitMarkers('没有出处')).toEqual({ claim: '没有出处', markers: '' });
  });
});

describe('the recommendation answers the business decision (项目.md D1), not the next research step', () => {
  const SAMPLE = '由 Senior 拍板、Junior A 执行一次小规模补证，分两条并行推进：一是找一家第三方研究机构，在 CIO / IT 负责人样本里做一份短问卷，强制对「集中部署配置、数据边界、审计追责、安全合规」与「端侧 AI 算力、AI 功能」做同一问卷内的排序';
  it('a research step is not a business action (the live sample of 10/25); a business action is', async () => {
    const { isResearchAction } = await import('@/lib/research/report');
    expect(isResearchAction(SAMPLE)).toBe(true);
    expect(isResearchAction('委托研究机构做 CIO 问卷，再决定押哪一层')).toBe(true);
    expect(isResearchAction(RECOMMENDATION.action)).toBe(false);
    expect(isResearchAction('与一家终端管理厂商合作，把管理栈预装进商用 AI PC，先在 3 家客户试点部署，同时访谈它们的 IT')).toBe(false);
  });

  it('the recommendation prompt carries the project decision; a research-only action is not delivered', async () => {
    const decision = '联想明年在商用 AI PC / 个人 AI 上，差异化押哪一层（管理 / 安全栈、端侧算力、agent 本身）× 怎么拿到（自研 / 合作 / 收购）。';
    const fx = await setup({ expert: true });
    cleanup = fx.cleanup;
    const proj = await fx.vault.read('20_项目/P/项目.md');
    await fx.vault.write('20_项目/P/项目.md', { frontmatter: proj.data, body: `# 项目\n\n## 顶层问题和它支撑的决策\n\n**问题**：x\n**支撑的决策**：${decision}\n` }, { overwrite: true });
    const prompts: string[] = [];
    const sm = scriptedModel({ recommendation: { ...RECOMMENDATION, action: SAMPLE, action_kind: '其他' }, onPrompt: (p) => prompts.push(p) });
    const r = await executeResearch({ ctx: fx.ctx, mode: 'small', model: sm.model, webClient: fakeWeb() });
    const recPrompt = prompts.find((p) => p.includes('写"AI 的推荐判断（提议，待人拍板）"'))!;
    expect(recPrompt).toContain(`**这个项目要支撑的业务决策**：${decision}`);
    expect(recPrompt).toContain('自研 / 合作 / 收购说的是联想获得能力的方式');
    expect(r.delivered).toBe(false);
    expect(r.failedChecks.join('\n')).toMatch(/“做什么”写的是研究动作/);
    expect(sm.tasks).toContain('recommend:repair');
  });

  it('the default (business) recommendation is delivered, with the answer to the decision in its own row', async () => {
    const { r, body } = await report();
    expect(r.delivered).toBe(true);
    expect(body).toMatch(/^\| 对决策的回答 \| 押管理和安全栈，自研为主（提议） \|$/m);
  });
});

describe('questions for experts in 对 workplan 的影响 are not claims', () => {
  it('"要问的专家二：…过去 12 个月…" passes (live sample 10/25); a plain claim with an uncited number still fails', () => {
    const body = (line: string) => `# R\n\n## Summary\n- 要回答的问题：x\n\n## 怎么查的\n- 查了：x\n\n## 逐个假设\n### H1 x\n- 提议的判断：证据不足\n- 支持的证据：\n  - （无）\n- 反证和挑战（逐条回应）：\n  - 已专门检索反证，没有找到 A/B 级的反证\n- 推导（推断）：x\n\n## 对 workplan 的影响\n${line}\n`;
    expect(checkReportText(body('- 要问的专家二：CIO——过去 12 个月被否决的端侧 AI 项目，原因是什么？'))).toEqual([]);
    expect(checkReportText(body('- 过去 12 个月有 30% 的项目被否决')).map((f) => f.code)).toEqual(['uncited_number']);
  });
});

describe('estimate basis label', () => {
  it('a basis that starts with its own label is not labelled twice', async () => {
    const { body } = await report({ recommendation: { ...RECOMMENDATION, scale_basis: '推断依据：按一个试点周期估' } });
    expect(body).toContain('（推断；估算依据：按一个试点周期估）');
  });
});

describe('the two dimensions of the alternatives (D1: which layer × how to get it)', () => {
  it('rows are labelled by dimension, layer first; "押端侧算力" tagged 自研 by the model (live sample) is still a layer row', async () => {
    const alts = [
      { option: '押端侧算力（NPU 与本地推理）', kind: '自研', why_not: '算力本身没有被证明能拉动付费' }, // no dimension: inferred from "押"
      { dimension: 'acquire', option: '与管理软件厂商合作提供套件', kind: '合作', why_not: '数据边界交给第三方' },
      { dimension: 'layer', option: '押 agent 本身', kind: '其他', why_not: '没有模型优势' },
      { dimension: 'acquire', option: '收购一家终端安全厂商', kind: '收购', why_not: '探索阶段无法定价' },
    ];
    const { body, r } = await report({ recommendation: { ...RECOMMENDATION, alternatives: alts } });
    expect(r.delivered).toBe(true);
    const rows = body.split('\n').filter((l) => l.startsWith('| 其他选项'));
    expect(rows.map((l) => l.split('|')[1].trim())).toEqual(['其他选项（押别的层）', '其他选项（押别的层）', '其他选项（换一种拿法：合作）', '其他选项（换一种拿法：收购）']);
    expect(rows[0]).toContain('押端侧算力');
  });
  it('another layer does not count as a way to get this one; a list without any other layer is incomplete', async () => {
    const { recommendationSchema } = await import('@/lib/research/schemas');
    const { recommendationGaps } = await import('@/lib/research/report');
    const onlyLayers = recommendationSchema.parse({ ...RECOMMENDATION, alternatives: [{ dimension: 'layer', option: '押端侧算力', kind: '收购', why_not: 'x' }] });
    expect(recommendationGaps(onlyLayers).join('\n')).toMatch(/没有覆盖“合作、收购”/);
    const noLayer = recommendationSchema.parse({ ...RECOMMENDATION, alternatives: RECOMMENDATION.alternatives.filter((a) => a.dimension === 'acquire') });
    expect(recommendationGaps(noLayer)).toEqual(['其他选项里没有“押别的层”（决策里列出的其他层各写一项）']);
  });
});
