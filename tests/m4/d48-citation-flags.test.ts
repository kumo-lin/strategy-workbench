/**
 * D-48 round 3: a report's citation_flags (a footnote the "引用对得上吗" check still judged as hung on the wrong
 * sentence) shown on the page: "⚠ 引文可能对不上" beside that footnote in that sentence, the reason and the quote on hover.
 */
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ReportViewer } from '@/components/research/report-viewer';
import { readCitationFlags } from '@/lib/report/citation-flags';
import { footnoteFlags, sentenceEnds } from '@/lib/report/sentence-place';

const html = (el: ReturnType<typeof createElement>) => renderToString(el);

const MD = [
  '# R 调查报告 v7',
  '',
  '## Summary',
  '- 回答（一句话）：付钱的是 IT 预算[^9]。',
  '- 所以联想：押管理栈[^9][^10]。',
  '',
  '| | 提议 |',
  '|---|---|',
  '| 做什么 | 做整合层<br>依据：买方把管理写进招标[^10] |',
  '',
  '## 引文出处',
  '',
  '[^9]: “IT 部门负责采购评审”（B，某报告）',
  '[^10]: “招标文件要求终端可管”（A，某招标）',
].join('\n');

const FLAGS = [
  { footnote: '[^9]', sentence: '押管理栈[^9][^10]。', quote: 'IT 部门负责采购评审', reason: '原文说的是谁评审，不是押什么' },
  { footnote: '[^10]', sentence: '做整合层<br>依据：买方把管理写进招标[^10]', quote: '招标文件要求终端可管', reason: '原文没说写进招标' },
];

describe('readCitationFlags', () => {
  it('the footnote id from "[^9]"; items of another shape left out; none without the field', () => {
    expect(readCitationFlags({ citation_flags: [...FLAGS, { footnote: 'x' }, 'bad', { sentence: 's' }] }).map((f) => f.id)).toEqual(['9', '10']);
    expect(readCitationFlags({})).toEqual([]);
  });
});

describe('placing a flag: by its sentence and footnote, never by the footnote alone', () => {
  const flags = readCitationFlags({ citation_flags: FLAGS });
  it('the same footnote in two sentences of one cell: only the recorded one', () => {
    // W5 v5: [^5] is right in "份额 24.2%[^5]" and flagged in another sentence
    const parts = [{ text: '依据：联想 PC 份额 24.2%' }, { footnote: '9' }, { text: '；所以联想：押管理栈' }, { footnote: '9' }, { footnote: '10' }, { text: '。' }];
    const m = footnoteFlags(parts, flags);
    expect([...m.keys()]).toEqual([3]);
    expect(m.get(3)?.[0]?.reason).toBe('原文说的是谁评审，不是押什么');
  });

  it('the sentence ending "；" in the report where the flag says "。"; a sentence not in the report: no mark at all', () => {
    const f = [{ id: '10', sentence: '依据：Q2 ③ 现在只有 C 级评测[^10]，还不足以判定，这个判断还缺证据。' }];
    const cell = [{ text: '若 HP 领先，推荐改成收购\n依据：Q2 ③ 现在只有 C 级评测' }, { footnote: '10' }, { text: '，还不足以判定，这个判断还缺证据；若买方付钱' }, { footnote: '10' }];
    expect([...footnoteFlags(cell, f).keys()]).toEqual([1]);
    expect(footnoteFlags([{ text: '份额 24.2%' }, { footnote: '10' }], f).size).toBe(0);
  });

  it('bound to the block link, not the footnote number: a flag of [^4] in another version still finds its evidence, now [^9]; another source at [^4] is not it', () => {
    const f = [{ id: '4', ref: '[[研究/资料甲#^c1|资料甲]]', sentence: '所以联想：押管理栈。' }];
    const parts = [{ text: '所以联想：押管理栈' }, { footnote: '9' }, { text: '；也看' }, { footnote: '4' }, { text: '。' }];
    const refOf = (id: string) => ({ '9': '[[资料甲#^c1]]', '4': '[[资料乙#^c2]]' })[id] ?? '';
    expect([...footnoteFlags(parts, f, refOf).keys()]).toEqual([1]);
  });

  it('length: each over-long sentence of a cell ends where it ends, not all at the cell\'s end', () => {
    const flags4 = ['若甲成立：推荐改成一', '若乙成立：推荐改成二', '若丙成立：推荐改成三'].map((sentence, i) => ({ sentence: `${sentence}。`, flag: i }));
    const parts = [{ text: '若甲成立：推荐改成一；若乙成立：推荐改成二' }, { footnote: '3' }, { text: '；若丙成立：推荐改成三' }];
    expect(sentenceEnds(parts, flags4)).toEqual([
      { part: 0, offset: 10, flag: 0 },
      { part: 0, offset: 21, flag: 1 },
      { part: 2, offset: 11, flag: 2 },
    ]);
  });
});

describe('the report page', () => {
  it('entity_flags: "⚠ 引文可能对不上" beside the footnote of that block in that sentence, what the original lacks on hover', () => {
    const md = ['## Summary', '- 所以联想：微软席位[^9]，惠普也有[^10]。', '', '## 引文出处', '', '[^9]: “x”（B，y）[[WPS 招标#^c1]]', '[^10]: “z”（B，w）[[惠普年报#^c2]]'].join('\n');
    const out = html(createElement(ReportViewer, { markdown: md, citations: {}, delivery: '已交付', entityFlags: [{ key: '[[WPS 招标#^c1]]', footnote: '[^3]', sentence: '微软席位', missing: ['微软'] }] }));
    expect(out.match(/data-testid="citation-warning-tag"/g)).toHaveLength(1);
    expect(out).toContain('title="原文里没有出现：微软"');
    expect(out.indexOf('citation-warning-tag')).toBeLessThan(out.indexOf('惠普也有'));
  });

  it('"⚠ 引文可能对不上" twice: [^9] in 所以联想 and [^10] in the 做什么 cell; the reason and the quote on hover', () => {
    const out = html(createElement(ReportViewer, { markdown: MD, citations: {}, delivery: '已交付', citationFlags: readCitationFlags({ citation_flags: FLAGS }) }));
    expect(out.match(/data-testid="citation-warning-tag"/g)).toHaveLength(2);
    expect(out).toContain('title="理由：原文说的是谁评审，不是押什么\n原文：“IT 部门负责采购评审”"');
    expect(out).toContain('title="理由：原文没说写进招标\n原文：“招标文件要求终端可管”"');
    // the first [^9] (回答（一句话）) has none: the tag comes after 所以联想
    expect(out.indexOf('citation-warning-tag')).toBeGreaterThan(out.indexOf('押管理栈'));
    expect(html(createElement(ReportViewer, { markdown: MD, citations: {}, delivery: '已交付' }))).not.toContain('citation-warning-tag');
  });

  it('length_flags: four over-long items of one cell, four marks, each right after its own item', () => {
    const items = ['若招标文件把管理写成资格条款：推荐改成全行业标配', '若新增支出是挤出来的：推荐改成只做功能升级', '若出现稳定价差：推荐改成把 NPU 单独提价', '若预算集中在 IT：推荐改成只对 IT 出材料'];
    const md = ['## Summary', '', '| | 提议 |', '|---|---|', `| 什么情况下要改 | ${items[0]}；${items[1]}[^3]；${items[2]}；${items[3]} |`, '', '[^3]: “x”（B，y）'].join('\n');
    const lengthFlags = items.map((text, i) => ({ where: `推荐 · 什么情况下要改 ${i + 1}`, text: `${text}。`, limit: 20, length: 24 }));
    const out = html(createElement(ReportViewer, { markdown: md, citations: {}, delivery: '已交付', lengthFlags }));
    expect(out.match(/data-testid="length-warning-tag"/g)).toHaveLength(4);
    // each mark between its item and the next ("；"), the second after its footnote
    const at = (t: string) => out.indexOf(t);
    const tags = [...out.matchAll(/data-testid="length-warning-tag"/g)].map((m) => m.index);
    expect(tags[0]).toBeGreaterThan(at(items[0]));
    expect(tags[0]).toBeLessThan(at(items[1]));
    expect(tags[1]).toBeGreaterThan(at('[<!-- -->3<!-- -->]') > 0 ? at('[<!-- -->3<!-- -->]') : at('[3]'));
    expect(tags[1]).toBeLessThan(at(items[2]));
    expect(tags[2]).toBeLessThan(at(items[3]));
    expect(tags[3]).toBeGreaterThan(at(items[3]));
  });
});
