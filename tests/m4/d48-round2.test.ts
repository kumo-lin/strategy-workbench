/**
 * D-48 第 2 轮 (M4 排版): "- 所以联想：" in a question tree's Summary, from the recommendation's 对决策的回答; a
 * rewrite's search counts said to be vN's; each recommendation cell broken before its first 依据 (`结论<br>依据：…`),
 * shown as a line break on the page.
 */
import { describe, expect, it } from 'vitest';
import { cellText, parseMarkdown } from '@/components/research/markdown-lite';
import { withLenovoLine } from '@/lib/research/followup';
import { renderRecommendation, soLenovo, withBasisBreak } from '@/lib/research/report';
import { recommendationSchema } from '@/lib/research/schemas';
import { checkReportText } from '@/lib/research/selfcheck';
import { RECOMMENDATION } from '../m2/research-fixture';

describe('soLenovo: the first sentence of 对决策的回答', () => {
  it('without "提议：" and a leading 联想; up to its first end mark, its footnotes kept', () => {
    expect(soLenovo('提议：联想明年押管理栈 [E3]。依据：多家买方把管理写进招标 [E4]')).toBe('明年押管理栈 [E3]。');
    expect(soLenovo('提议：押管理栈。[^3] 再看端侧')).toBe('押管理栈。[^3]');
    expect(soLenovo('押管理和安全栈，自研为主（提议）')).toBe('押管理和安全栈，自研为主（提议）');
  });

  it('a 。 inside a quote does not end it; a rendered cell stops at its <br>', () => {
    expect(soLenovo('押管理栈；推断：依赖「监管要求准入。这条…」这条还没验证的判断（见 Q2-1）。依据：…')).toBe('押管理栈；推断：依赖「监管要求准入。这条…」这条还没验证的判断（见 Q2-1）。');
    expect(soLenovo('提议：押管理栈<br>依据：多家买方[^4]')).toBe('押管理栈');
    expect(soLenovo('')).toBe('');
  });
});

describe('withBasisBreak: a recommendation cell', () => {
  it('broken before its first 依据, the conclusion losing its end mark; the suffix with the conclusion', () => {
    expect(withBasisBreak('押管理栈[^3]。依据：多家买方[^4]；另一条。依据：…')).toBe('押管理栈[^3]<br>依据：多家买方[^4]；另一条。依据：…');
    expect(withBasisBreak('做整合层。依据：A[^1]', '（自研）')).toBe('做整合层（自研）<br>依据：A[^1]');
  });

  it('none: as it was (估算依据 is not one)', () => {
    expect(withBasisBreak('做整合层', '（自研）')).toBe('做整合层（自研）');
    expect(withBasisBreak('2–3 家（推断；估算依据：一个试点周期）')).toBe('2–3 家（推断；估算依据：一个试点周期）');
  });

  it('every cell of the table, in the new way; an old recommendation unchanged', () => {
    const rec = recommendationSchema.parse({
      ...RECOMMENDATION,
      decision_answer: '提议：押管理栈。依据：买方把管理写进招标 [E1]',
      action: '做整合层。依据：IT 侧接入 [E1]',
      metrics: ['写进招标条款的客户数。依据：招标文件 [E1]'],
      change_if: ['IT 仍只看价格。依据：价格敏感 [E1]'],
      alternatives: [{ dimension: 'layer', option: '押端侧算力', kind: '其他', why_not: '买方不为 AI 多付钱。依据：问卷 [E1]' }],
    });
    const t = renderRecommendation(rec, (s) => s.replace(' [E1]', '[^1]'), true).join('\n');
    expect(t).toContain('| 对决策的回答 | 提议：押管理栈<br>依据：买方把管理写进招标[^1] |');
    expect(t).toContain('| 做什么 | 做整合层（自研）<br>依据：IT 侧接入[^1] |');
    expect(t).toContain('| 看什么指标 | 写进招标条款的客户数<br>依据：招标文件[^1] |');
    expect(t).toContain('| 什么情况下要改 | IT 仍只看价格<br>依据：价格敏感[^1] |');
    expect(t).toContain('| 其他选项（押别的层） | 押端侧算力：不选，买方不为 AI 多付钱<br>依据：问卷[^1] |');
    expect(renderRecommendation(recommendationSchema.parse(RECOMMENDATION), (s) => s, true).join('\n')).not.toContain('<br>');
  });
});

describe('withLenovoLine: a follow-up keeps "- 所以联想：" with the table', () => {
  const body = (answer: string, lenovo = true) =>
    ['# R', '', '## Summary', '- 核心问题：…', '- 回答（一句话）：…', ...(lenovo ? ['- 所以联想：旧的回答。'] : []), '', '| | 提议 |', '|---|---|', `| 对决策的回答 | ${answer} |`, '', '## 怎么查的'];

  it('the line follows the table; a Summary without it gets none', () => {
    expect(withLenovoLine(body('提议：联想改押安全栈[^2]<br>依据：…'))).toContain('- 所以联想：改押安全栈[^2]');
    expect(withLenovoLine(body('提议：改押安全栈', false))).toEqual(body('提议：改押安全栈', false));
  });
});

describe('<br> in a table cell on the page', () => {
  it('markdown-lite: a line break in the cell, nowhere else', () => {
    expect(cellText('结论<br>依据：…<BR/>再一行')).toBe('结论\n依据：…\n再一行');
    const [table, para] = parseMarkdown('| | 提议 |\n|---|---|\n| 做什么 | 结论<br>依据：A[^1] |\n\n正文<br>不换');
    expect(table).toMatchObject({ kind: 'table', rows: [[[{ kind: 'text', text: '做什么' }], [{ kind: 'text', text: '结论\n依据：A' }, { kind: 'footnote', id: '1' }]]] });
    expect(para).toMatchObject({ kind: 'paragraph', inline: [{ kind: 'text', text: '正文<br>不换' }] });
  });

});

describe('selfcheck', () => {
  it('"- 所以联想：" is not a line it asks for, nor one it checks for sources (its cell is)', () => {
    const fails = checkReportText('## Summary\n- 所以联想：明年先在 2 家客户试点。\n');
    expect(fails.filter((f) => f.code === 'uncited_number')).toEqual([]);
    expect(fails.some((f) => f.message.includes('所以联想'))).toBe(false);
  });
});
