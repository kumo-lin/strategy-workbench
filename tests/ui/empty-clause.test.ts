/** D-56 ⑦: a footnote whose clause is only a label (依据：/回答：/（见 Q1 ①）…) is not drawn when citation_verify is present. */
import { describe, expect, it } from 'vitest';
import { parseInline, parseMarkdown, type Inline } from '@/components/research/markdown-lite';
import { emptyClauseFootnotes } from '@/lib/report/empty-clause';

const hiddenIndexes = (inline: Inline[]) => [...emptyClauseFootnotes(inline)].sort((a, b) => a - b);

/** The ids of the footnotes left out (the function itself returns node indexes). */
const hidden = (inline: Inline[]) =>
  hiddenIndexes(inline).map((index) => {
    const node = inline[index];
    return node?.kind === 'footnote' ? node.id : `#${index}`;
  });

describe('emptyClauseFootnotes', () => {
  it('a clause that is only a label is empty', () => {
    const inline = parseInline('依据：[^1]');
    expect(hidden(inline)).toEqual(['1']);
    expect(hiddenIndexes(inline)).toEqual([1]);
  });

  it('consecutive footnotes all follow the first one', () => {
    expect(hidden(parseInline('回答：[^1][^2]'))).toEqual(['1', '2']);
  });

  it('a clause with content is not empty, and the next clause starts at ；', () => {
    expect(hidden(parseInline('相当比例：49% 的员工[^1][^2]；带入途径[^3]'))).toEqual([]);
  });

  it('a （见 Q1 ①） mark is not content', () => {
    expect(hidden(parseInline('（见 Q1 ①）[^4]'))).toEqual(['4']);
  });

  it('a label after the footnote does not make it empty', () => {
    expect(hidden(parseInline('支持[^5]：…'))).toEqual([]);
  });

  it('a <br> in a table cell starts the clause after it', () => {
    const table = parseMarkdown(['| 结论 |', '|---|', '| 结论<br>依据：[^6] |'].join('\n'))[0];
    expect(table?.kind).toBe('table');
    if (table?.kind !== 'table') return;
    expect(hidden(table.rows[0]![0]!)).toEqual(['6']);
  });

  it('a footnote after a sentence end with nothing between is empty', () => {
    expect(hidden(parseInline('这句话结束了。[^7]'))).toEqual(['7']);
  });

  it('never throws on a run with no footnotes', () => {
    expect(hidden(parseInline('普通的一句话'))).toEqual([]);
  });
});
