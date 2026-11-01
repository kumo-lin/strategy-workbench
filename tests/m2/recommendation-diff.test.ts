/** The recommendation table across versions: replace in Summary, keep the old one in the appendix, diff by code. */
import { describe, expect, it } from 'vitest';
import { mergeRecommendation, recommendationRows, recommendationText, renderPartChanges, replaceRecommendation } from '@/lib/research/recommendation-diff';

const table = (doWhat: string, scale = '2–3 家（推断；估算依据：x）') => [
  '- AI 的推荐判断（提议，待你拍板）：',
  '',
  '| | 提议 |',
  '|---|---|',
  '| 对决策的回答 | 押管理栈 |',
  `| 做什么 | ${doWhat}[^3] |`,
  `| 量级 | ${scale} |`,
  '',
  '以上全部是 AI 提议，状态只有人能改。',
];

describe('recommendation tables across versions', () => {
  it('rows are read without footnote markers; the text form feeds the next model call', () => {
    expect(recommendationRows(table('预装管理栈'))).toEqual([
      { label: '对决策的回答', text: '押管理栈' },
      { label: '做什么', text: '预装管理栈' },
      { label: '量级', text: '2–3 家（推断；估算依据：x）' },
    ]);
    expect(recommendationText(['## Summary', ...table('预装管理栈')].join('\n'))).toBe('- 对决策的回答：押管理栈\n- 做什么：预装管理栈\n- 量级：2–3 家（推断；估算依据：x）');
  });

  it('an old-format report has no table: the new one goes to the end of Summary, and the change says so', () => {
    const body = ['# R', '', '## Summary', '- So what：x', '', '## 怎么查的', '- 查了'];
    const r = replaceRecommendation(body, table('预装管理栈'), 1);
    expect(r.oldRows).toBeNull();
    expect(r.lines.indexOf('- AI 的推荐判断（提议，待你拍板）：')).toBeLessThan(r.lines.indexOf('## 怎么查的'));
  });

  it('the old table moves to the appendix (made when the report has none), relabelled and without the closing line', () => {
    const body = ['## Summary', ...table('预装管理栈'), '', '## 逐个假设', '### H1', '', '## 引文出处', '[^3]: “q”（B 级，知识库）[[a#^c1]]'];
    const r = replaceRecommendation(body, table('合作预装'), 2);
    const app = r.lines.slice(r.lines.indexOf('## 附录：过程记录'), r.lines.indexOf('## 引文出处'));
    expect(app[1]).toBe('- v2 的推荐判断（已被本版替换）：');
    expect(app).toContain('| 做什么 | 预装管理栈[^3] |');
    expect(app).not.toContain('以上全部是 AI 提议，状态只有人能改。');
    expect(r.lines.filter((l) => l === '- AI 的推荐判断（提议，待你拍板）：')).toHaveLength(1);
  });
});

describe('part by part (D-21 (b): every cell reworded, 2 parts really changed)', () => {
  const v1 = ['- AI 的推荐判断（提议，待你拍板）：', '', '| | 提议 |', '|---|---|', '| 对决策的回答 | 押管理栈 |', '| 做什么 | 预装管理栈[^3] |', '| 量级 | 各覆盖至少一家（推断；估算依据：x） |', '| 其他选项（押别的层） | 押端侧算力：不选，A[^4] |', '| 其他选项（换一种拿法：合作） | 合作：不选，B |', '', '以上全部是 AI 提议，状态只有人能改。'];
  const v2 = ['- AI 的推荐判断（提议，待你拍板）：', '', '| | 提议 |', '|---|---|', '| 对决策的回答 | 押管理栈，只在大企业 |', '| 做什么 | 预装管理与安全栈[^5] |', '| 量级 | 各至少覆盖一家（推断；估算依据：x） |', '| 其他选项（押别的层） | 押端侧算力：不选，A[^9] |', '| 其他选项（换一种拿法：合作） | 合作：不选，B |', '', '以上全部是 AI 提议，状态只有人能改。'];

  it('unchanged parts keep vN\'s rows character for character, whatever the model wrote; changed parts take the new rows', () => {
    const m = mergeRecommendation(v1, v2, { decision_answer: { changed: true, why: '新证据 [E7]' }, alternatives: { changed: true, why: '换成新证据 [E7]' } });
    expect(m.block).toContain('| 做什么 | 预装管理栈[^3] |');
    expect(m.block).toContain('| 量级 | 各覆盖至少一家（推断；估算依据：x） |');
    expect(m.block).toContain('| 对决策的回答 | 押管理栈，只在大企业 |');
    expect(m.block).toContain('| 其他选项（押别的层） | 押端侧算力：不选，A[^9] |');
    expect(m.keptRows).toBe(2);
    expect(m.changes.map((c) => c.part)).toEqual(['decision_answer', 'alternatives']);
  });

  it('the change lines show the full text before and after, the why, and how many cells stayed', () => {
    const m = mergeRecommendation(v1, v2, { decision_answer: { changed: true, why: '新证据 [E7]' } });
    expect(renderPartChanges(m.changes, m.keptRows, (t) => t.replace('[E7]', '[^12]'))).toEqual([
      '  - 对 D1 的回答（变了）：',
      '    - 改前：押管理栈',
      '    - 改后：押管理栈，只在大企业',
      '    - 为什么：新证据 [^12]',
      '  - 其余 4 格未变',
    ]);
    expect(renderPartChanges([], 5, (t) => t)).toEqual(['  - 各格都没有变：这次的新证据没有改变推荐判断']);
  });

  it('no decisions at all: the whole vN table stays', () => {
    const m = mergeRecommendation(v1, v2, {});
    expect(m.block).toEqual(v1);
    expect(m.keptRows).toBe(5);
  });
});

describe('a row vN did not have (怎么回应高层指示 is new after v3)', () => {
  it('it is taken from the new table and listed as new, without a changed flag', () => {
    const oldT = ['- AI 的推荐判断（提议，待你拍板）：', '', '| | 提议 |', '|---|---|', '| 对决策的回答 | 押管理栈 |', '| 做什么 | 预装 |', '', '以上全部是 AI 提议，状态只有人能改。'];
    const newT = ['- AI 的推荐判断（提议，待你拍板）：', '', '| | 提议 |', '|---|---|', '| 对决策的回答 | 押管理栈 |', '| 怎么回应高层指示 | 修正：要收窄[^4] |', '| 做什么 | 预装 |', '', '以上全部是 AI 提议，状态只有人能改。'];
    const m = mergeRecommendation(oldT, newT, {});
    expect(m.block).toContain('| 怎么回应高层指示 | 修正：要收窄[^4] |');
    expect(m.block.indexOf('| 怎么回应高层指示 | 修正：要收窄[^4] |')).toBeLessThan(m.block.indexOf('| 做什么 | 预装 |'));
    expect(renderPartChanges(m.changes, m.keptRows, (t) => t)).toEqual([
      '  - 怎么回应高层指示（变了）：',
      '    - 改前：（没有）',
      '    - 改后：修正：要收窄[^4]',
      '    - 为什么：上一版没有这一格，这一版新加',
      '  - 其余 2 格未变',
    ]);
  });
});
