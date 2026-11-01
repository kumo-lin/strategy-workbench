/**
 * Model text that code follows with its own mark loses its end mark first. Fixture: the sentences of WS-A 报告 v4,
 * W5 报告 v2 and the WS-A follow-ups, where code doubled it:
 *   - 量级 "…跑 2 个季度。" + "。怎么估的（推断）" → "。。"
 *   - 模型知识 "…多来自受监管行业。" + "；" → "。；"; 仍要问专家 "…还是放在评分表里加分？" + "；" → "？；"
 *   - a 不选 option, a follow-up's "针对：" statement, a changed part's why, a leaf answer.
 */
import { describe, expect, it } from 'vitest';
import { mergeRecommendation } from '@/lib/research/recommendation-diff';
import { joinClauses, renderRecommendation, trimEndMark } from '@/lib/research/report';
import { recommendationSchema, type Recommendation } from '@/lib/research/schemas';
import { RECOMMENDATION } from './research-fixture';

const rec = (over: Record<string, unknown>): Recommendation => recommendationSchema.parse({ ...RECOMMENDATION, ...over });
const row = (rows: string[], label: string) => rows.find((l) => l.startsWith(`| ${label}`))!;
const same = (t: string) => t;

const W5_SCALE = '2026 年内先在 20–50 家已有 TruScale 商用客户里试点，把打包方案捆进商用 AI PC 新机订单，配 1 支产品线团队加现有服务交付团队，跑 2 个季度。';
const WSA_SCALE = '先在 5–10 家受监管行业客户（银行、保险）落地，12 个月内跑通从签约到策略下发、日志接入的完整流程，投入一个 20–40 人的产品加交付小队。';

describe('量级: an estimate said straight, one full stop', () => {
  it('W5 v2 and WS-A v4: "。。怎么估的" is "。怎么估的"', () => {
    for (const scale of [W5_SCALE, WSA_SCALE]) {
      const r = row(renderRecommendation(rec({ scale, scale_inferred: true }), same, true), '量级');
      expect(r).toBe(`| 量级 | ${scale.slice(0, -1)}。怎么估的（推断）：${RECOMMENDATION.scale_basis} |`);
      expect(r).not.toMatch(/[。！？；，][。！？；，]/);
    }
  });

  it('the older wording, a "！" or a full stop before the footnote: the mark goes, the footnote stays', () => {
    expect(row(renderRecommendation(rec({ scale: WSA_SCALE, scale_inferred: true }), same), '量级')).toBe(`| 量级 | ${WSA_SCALE.slice(0, -1)}（推断；估算依据：${RECOMMENDATION.scale_basis}） |`);
    expect(row(renderRecommendation(rec({ scale: '跑 2 个季度！', scale_inferred: true }), same, true), '量级')).toMatch(/^\| 量级 \| 跑 2 个季度。怎么估的/);
    expect(row(renderRecommendation(rec({ scale: '约 17 万台。[^18]', scale_inferred: true }), same, true), '量级')).toMatch(/^\| 量级 \| 约 17 万台\[\^18\]。怎么估的/);
  });

  it('a scale with evidence and no estimate is left as written', () => {
    expect(row(renderRecommendation(rec({ scale: '约 17 万台 [E18]。', scale_inferred: false }), same, true), '量级')).toBe('| 量级 | 约 17 万台 [E18]。 |');
  });
});

describe('the other rows of the recommendation', () => {
  it('an option that ends with a full stop: "押端侧算力：不选，", not "。：不选，"', () => {
    const rows = renderRecommendation(rec({ alternatives: [{ ...RECOMMENDATION.alternatives[0], option: '押端侧算力。' }, ...RECOMMENDATION.alternatives.slice(1)] }), same, true);
    expect(rows.join('\n')).toContain('| 押端侧算力：不选，买方不为 AI 本身多付钱 |');
  });

  it('指标 and 什么情况下要改 join with one "；"; a question keeps its "？" and needs no "；"', () => {
    const rows = renderRecommendation(rec({ metrics: ['招标条款里是否写了可管性。', '半年内是否进入下一轮采购[^3]。'], change_if: ['资格条款里不满足即出局，还是放在评分表里加分？', '试点客户的 IT 仍然只看价格；'] }), same, true);
    expect(row(rows, '看什么指标')).toBe('| 看什么指标 | 招标条款里是否写了可管性；半年内是否进入下一轮采购[^3] |');
    expect(row(rows, '什么情况下要改')).toBe('| 什么情况下要改 | 资格条款里不满足即出局，还是放在评分表里加分？试点客户的 IT 仍然只看价格 |');
  });
});

describe('joinClauses / trimEndMark (模型知识, 仍要问专家, 针对, 为什么)', () => {
  it('模型知识 in WS-A v3: "。；" is "；"', () => {
    const k = ['模型知识，没有经过资料验证：企业招标文件通常把安全合规资质放进资格条款、把功能细项放进评分表，这一常规可能解释为何公开可见的资格条款实例多来自受监管行业。', '模型知识，没有经过资料验证：银行的终端采购多走集中招标。'];
    expect(joinClauses(k)).toBe(`${k[0].slice(0, -1)}；${k[1].slice(0, -1)}`);
  });

  it('仍要问专家 in WS-A v4: "？；" is "？"', () => {
    const q = ['在你们近两年的终端或 AI 工具招标文件里，设备集中配置、策略下发、日志导出、权限边界这类条款，是放在资格条款里不满足即出局，还是放在评分表里加分？', '受监管行业的采购中，监管条文要求的日志审计是否写进了招标文件？'];
    expect(joinClauses(q)).toBe(q.join(''));
    expect(joinClauses(['', '  ', '只有一条。'])).toBe('只有一条');
  });

  it('trimEndMark: the end mark, also one before trailing footnotes; nothing inside the text', () => {
    expect(trimEndMark('管不住的产品即使 AI 能力更强也不会被规模采购。')).toBe('管不住的产品即使 AI 能力更强也不会被规模采购');
    expect(trimEndMark('约 17 万台。[^18][^19] ')).toBe('约 17 万台[^18][^19]');
    expect(trimEndMark('约 17 万台[^18]；')).toBe('约 17 万台[^18]');
    expect(trimEndMark('先试点。再推广')).toBe('先试点。再推广');
    expect(trimEndMark('Inc.')).toBe('Inc.');
  });

  it('a changed part\'s why that ends with a full stop: "不能沿用；改按试点周期估算", not "。；"', () => {
    const before = renderRecommendation(rec({ scale: '受监管行业的实例证据只到单个机构的制度层面[^6]', scale_inferred: false }), same, true);
    const after = renderRecommendation(rec({ scale: '先在 3–5 家客户试点', scale_inferred: true }), same, true);
    const { changes } = mergeRecommendation(before, after, { scale: { changed: true, why: '改按试点周期估算。' } } as never, new Set(['6']));
    expect(changes.find((c) => c.part === 'scale')!.why).toBe('上一版依据的来源已证伪（[^6]），这一格不能沿用；改按试点周期估算');
  });
});
