import { describe, expect, it } from 'vitest';
import { hasQuestionTree, parseWorkplanTree, WORKPLAN_SECTIONS, workplanTreeProblems, workplanTreeWarnings } from '@/lib/workplan/workplan-tree';

const SECTIONS = (tree: string, mece = '三问按采购的先后排。不重叠：各管一件事。不遗漏：少一问答不了。') => `# WS-A workplan v1

## 要回答的问题与要支撑的决策
企业会为员工端侧个人 AI 的哪一部分付钱？

## 前提
W1 的决定。

## Day-1 answer
会为管理栈付钱。

## 问题树与假设
${tree}

## MECE 和充分必要的自检
${mece}

## 每个假设怎么验证
H1：条件、证据、去哪里查、反证。

## 金字塔骨架
结论 → 子问题的回答 → 证据。

## 风险和待确认
- 凭什么是联想：交给 W5。

## next action
- 明天先查 H1。
`;

const TWO_LEVELS = `### Q1 谁决定买，谁出钱？
**假设 H1**：IT 决定能不能进机队。[[WS-A-H1 选型权在IT]]

### Q2 买方按什么标准放行？
#### Q2-1 管得住是准入要求吗？
**假设 H2-1**：是准入要求。[[WS-A-H2 可管理性是准入]]
#### Q2-2 都管得住时按什么选？
**假设 H2-2**：看价格和合同打包。[[WS-A-H3 过门后看价格]]`;

describe('parseWorkplanTree', () => {
  it('reads one level and two levels, leaves in reading order', () => {
    const t = parseWorkplanTree(SECTIONS(TWO_LEVELS));
    expect(t.roots.map((r) => r.qid)).toEqual(['Q1', 'Q2']);
    expect(t.leaves.map((l) => [l.qid, l.label, l.parent])).toEqual([
      ['Q1', 'H1', null],
      ['Q2-1', 'H2-1', 'Q2'],
      ['Q2-2', 'H2-2', 'Q2'],
    ]);
    expect(t.leaves[1].hypothesis).toBe('[[WS-A-H2 可管理性是准入]]');
    expect(t.roots[1].leaf).toBeNull();
  });

  it('knows the format from the section', () => {
    expect(hasQuestionTree(SECTIONS(TWO_LEVELS))).toBe(true);
    expect(hasQuestionTree('# w\n\n## 论点与假设\n- 论点 1\n')).toBe(false);
  });
});

describe('workplanTreeProblems', () => {
  it('passes a well-formed tree', () => {
    expect(workplanTreeProblems(SECTIONS(TWO_LEVELS))).toEqual([]);
    expect(WORKPLAN_SECTIONS).toHaveLength(9);
  });

  it('names a missing section and an empty MECE check', () => {
    const body = SECTIONS(TWO_LEVELS, '').replace('## 金字塔骨架\n结论 → 子问题的回答 → 证据。\n\n', '');
    const p = workplanTreeProblems(body);
    expect(p.join('\n')).toContain('「金字塔骨架」');
    expect(p.join('\n')).toContain('是空的');
  });

  it('wants a hypothesis under every lowest-level sub-question, and only one', () => {
    const none = workplanTreeProblems(SECTIONS('### Q1 谁决定买？\n没有假设。'));
    expect(none.join('\n')).toContain('Q1 下面没有假设');
    const two = workplanTreeProblems(SECTIONS('### Q1 谁决定买？\n**假设 H1**：a [[A]]\n**假设 H1**：b [[B]]'));
    expect(two.join('\n')).toContain('Q1 下面有 2 个假设');
    const noLink = workplanTreeProblems(SECTIONS('### Q1 谁决定买？\n**假设 H1**：a'));
    expect(noLink.join('\n')).toContain('没有链接');
  });

  it('keeps the hypothesis label in step with the sub-question', () => {
    const p = workplanTreeProblems(SECTIONS('### Q1 谁决定买？\n**假设 H2**：a [[A]]'));
    expect(p.join('\n')).toContain('应该叫 H1');
  });

  it('allows two levels only, a split has two or more parts, the parent has no hypothesis of its own', () => {
    const third = workplanTreeProblems(SECTIONS('### Q1 买不买？\n#### Q1-1 谁买？\n**假设 H1-1**：a [[A]]\n#### Q1-2 谁付钱？\n**假设 H1-2**：b [[B]]\n##### Q1-2-1 付多少？'));
    expect(third.join('\n')).toContain('第三层');
    const single = workplanTreeProblems(SECTIONS('### Q1 买不买？\n#### Q1-1 谁买？\n**假设 H1-1**：a [[A]]'));
    expect(single.join('\n')).toContain('只拆出 1 个');
    const parent = workplanTreeProblems(SECTIONS('### Q1 买不买？\n**假设 H1**：a [[A]]\n#### Q1-1 谁买？\n**假设 H1-1**：a [[A]]\n#### Q1-2 谁付？\n**假设 H1-2**：b [[B]]'));
    expect(parent.join('\n')).toContain('它自己不挂假设');
  });

  it('wants the numbers in reading order', () => {
    const p = workplanTreeProblems(SECTIONS('### Q2 谁决定买？\n**假设 H2**：a [[A]]'));
    expect(p.join('\n')).toContain('### Q1');
    const p2 = workplanTreeProblems(SECTIONS('### Q1 买不买？\n#### Q1-2 谁买？\n**假设 H1-2**：a [[A]]\n#### Q1-1 谁付？\n**假设 H1-1**：b [[B]]'));
    expect(p2.join('\n')).toContain('#### Q1-1');
  });

  it('says so when the tree has no sub-question at all', () => {
    expect(workplanTreeProblems(SECTIONS('还没想好。')).join('\n')).toContain('里没有子问题');
  });
});

describe('workplanTreeWarnings', () => {
  it('only advises: not a question, too many, no 凭什么是我们', () => {
    const w = workplanTreeWarnings(SECTIONS('### Q1 市场规模\n**假设 H1**：a [[A]]'));
    expect(w.join('\n')).toContain('不像问句');
    expect(w.join('\n')).toContain('凭什么是我们');
    const ok = workplanTreeWarnings(SECTIONS(TWO_LEVELS, '凭什么是联想交给 W5。'));
    expect(ok).toEqual([]);
  });
});
