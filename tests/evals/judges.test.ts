/** The eval rule judges decide the same way every time; these pin down what passes and what does not. */
import { describe, expect, it } from 'vitest';
import { citationsAllOk, counterOrInsufficient, directiveOrigin, kbKindOf, noUnsourcedNumbers, nowWhatRule, originSection, renderKbUses, statisticsIn } from '../../evals/judges';
import type { CitationDetail } from '@/lib/research/citation-types';

const REPORT = `# R 调查报告 v3

## Summary
- So what：可管理性决定能不能进门，不决定能不能多收钱 “企业 IT 把可管理当入场券”（B 级，知识库）[[资料甲#^c1]]
- 调查得到的结果：
  - C2 → 需要修改（提议）

## 怎么查的
- 模式：小调查；联网搜索 3 次、抓取 3 次，用时 120 秒，涉及 45% 的样本

## 逐个假设
### C2 可管理性三层是采购必要条件  [[WS-A-H2 可管理性是采购必要条件而非溢价]]
- 提议的判断：需要修改（AI 提议，等人拍板后才生效）
- 支持的证据：
  - 63% 的 CIO 把管理能力列为前三 “63% of CIOs rank manageability top three”（B 级，网络 · AI 定级）[[资料乙#^c2]]
- 反证：
  - 员工大量自带工具 “two-thirds of office professionals”（B 级，知识库）[[资料丙#^c1]]
- 推导（推断）：来自 2 家独立发布方；预算增长 12.5% 说明钱在软件科目。
- 模型知识（只是线索，不是证据）：SaaS 时代 80% 的影子 IT 最后被收编。
- 缺口，以及要问专家的问题：
  - 缺口：缺预算口径
`;

describe('① now what', () => {
  it('passes only when an option says "now what" literally (the LLM judge covers paraphrases, marked as llm)', () => {
    expect(nowWhatRule([{ id: 'i1', label: '结论缺 Now What：没说联想明年该做什么' }]).pass).toBe(true);
    expect(nowWhatRule([{ id: 'i1', label: '缺 now-what' }]).pass).toBe(true);
    expect(nowWhatRule([{ id: 'i1', label: '只有事实，没有判断' }, { id: 'i2', label: '表达不清' }]).pass).toBe(false);
  });
});

describe('② counter-evidence or 证据不足', () => {
  it('passes with a cited counter bullet', () => {
    expect(counterOrInsufficient(REPORT).pass).toBe(true);
  });
  it('passes with 证据不足 and no counter evidence; fails with neither', () => {
    const noCounter = REPORT.replace(/- 反证：\n  - [^\n]*\n/, '- 反证：\n  - （无）\n');
    expect(counterOrInsufficient(noCounter).pass).toBe(false);
    expect(counterOrInsufficient(noCounter.replace('需要修改（AI 提议', '证据不足（AI 提议')).pass).toBe(true);
  });
});

describe('③ citations and numbers', () => {
  const c = (ok: boolean): CitationDetail => ({ link: '[[x#^c1]]', ok, sourceName: 'x', sourcePath: null, blockId: 'c1', blockText: null, quote: null, grade: null, gradedBy: null, origin: null, publisher: null, url: null, published: null, ...(ok ? {} : { error: 'quote_mismatch' as const }) });
  it('every citation must pass, and there must be at least one', () => {
    expect(citationsAllOk([c(true), c(true)]).pass).toBe(true);
    expect(citationsAllOk([c(true), c(false)]).pass).toBe(false);
    expect(citationsAllOk([]).pass).toBe(false);
  });

  it('finds statistics outside quotes, the 怎么查的 record, headings and model-knowledge lines; ignores years and small structural counts', () => {
    const cores = statisticsIn(REPORT).map((s) => s.token);
    expect(cores).toEqual(['63%', '12.5%']);
  });

  it('a statistic must be found in a cited block', () => {
    const blocks = ['「63% of CIOs rank manageability top three」— 位置：p.2'];
    const r = noUnsourcedNumbers(REPORT, blocks);
    expect(r.pass).toBe(false);
    expect(r.unsourced.map((u) => u.token)).toEqual(['12.5%']);
    expect(noUnsourcedNumbers(REPORT, [...blocks, '软件预算增长 12.5%']).pass).toBe(true);
    // 1.2 must not match inside 12.5 or 1.25
    expect(noUnsourcedNumbers('## 逐个假设\n### C1 x\n- 推导（推断）：增长 1.2 倍。', ['增长 1.25 倍']).pass).toBe(false);
  });
});

describe('④′ the starting point quotes the directive (D-17)', () => {
  const M1 = '[[20_项目/个人AI战略/会议/2026-10-16 高层周会（模拟）#^m1]]';
  const origin = (quote: string) =>
    `## 怎么查的\n- 这次调查的出发点（系统按计划的 derived_from / relates_to 和它们指向的 workplan、项目、假设写出，不是模型写的）：\n  - 会议「2026-10-16 高层周会（模拟）」：“${quote}”（来自 workplan v1）${M1}\n  - 项目「项目」（来自 计划 v1）：[[20_项目/个人AI战略/项目]]\n- 模式：小调查\n`;
  const cite = (ok: boolean, quote: string | null = '我先插一句') =>
    ({ [M1]: { link: M1, ok, sourceName: 'x', sourcePath: null, blockId: 'm1', blockText: null, quote, grade: null, gradedBy: null, origin: null, publisher: null, url: null, published: null, ...(ok ? {} : { error: 'quote_mismatch' as const }) } }) as Record<string, CitationDetail>;

  it('passes when all three hold', () => {
    const checks = directiveOrigin(origin('我先插一句，方向先别飘。重点看 IT 能不能管。'), cite(true));
    expect(checks.map((c) => c.pass)).toEqual([true, true, true]);
    expect(originSection(origin('x')).lines).toHaveLength(3);
  });
  it('(a) fails without the section, or when it says the plan links to nothing', () => {
    expect(directiveOrigin('## 怎么查的\n- 模式：小调查\n', {})[0].pass).toBe(false);
    expect(directiveOrigin('- 这次调查的出发点：计划没有关联到会议、决定或项目笔记\n', {})[0].pass).toBe(false);
  });
  it('(b) fails when the meeting is quoted at another block, or without the sentence', () => {
    expect(directiveOrigin(origin('重点看 IT 能不能管').replace('#^m1', '#^m3'), cite(true))[1].pass).toBe(false);
    expect(directiveOrigin(origin('W1 先收一下啊。'), cite(true))[1].pass).toBe(false);
  });
  it('(c) fails when check_citations did not pass, or the quote was not checked at all', () => {
    expect(directiveOrigin(origin('重点看 IT 能不能管'), cite(false))[2].pass).toBe(false);
    expect(directiveOrigin(origin('重点看 IT 能不能管'), cite(true, null))[2].pass).toBe(false);
  });
});

describe('④ knowledge-base notes used (record only)', () => {
  it('classifies meetings, decisions, expert input and preset sources; ignores web sources and other notes', () => {
    expect(kbKindOf('20_项目/P/会议/周会.md', 'meeting')).toBe('会议');
    expect(kbKindOf('20_项目/P/决策/W1决定.md', 'decision')).toBe('决定');
    expect(kbKindOf('00_团队知识/专家输入/WS-A 专家访谈（模拟）.md', 'knowledge')).toBe('专家输入');
    expect(kbKindOf('10_资料库/a.md', 'source', '预置')).toBe('预置资料');
    expect(kbKindOf('10_资料库/b.md', 'source', '网络')).toBeNull();
    expect(kbKindOf('20_项目/P/假设/H1.md', 'hypothesis')).toBeNull();
    expect(renderKbUses([{ kind: '会议', name: '周会', where: '出发点' }, { kind: '预置资料', name: 'a', where: '正文' }])).toBe('会议 1 条：周会（出发点）；预置资料 1 条：a');
  });
});
