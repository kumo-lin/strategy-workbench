/**
 * D-56 ⑦: the three-check result (citation_verify) on the report page. A verified footnote gets a green "✓ 依据"
 * beside it, an unverified one a grey "相关资料（没核实能不能撑住这句话）"; a "⚠ 引文可能对不上" still wins. With the field
 * present, a footnote whose clause is only a label is not drawn. Reports without the field render as before.
 */
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ReportViewer } from '@/components/research/report-viewer';
import { footnoteMarks, readCitationFlags, readEntityFlags } from '@/lib/report/citation-flags';
import { readCitationVerify, verifyMarks, type VerifyItem } from '@/lib/report/citation-verify';

const html = (el: Parameters<typeof renderToString>[0]) => renderToString(el).replace(/<!-- -->/g, '');
const count = (s: string, re: RegExp) => (s.match(re) ?? []).length;

const EXAMPLE = {
  citation_verify: {
    checked: 25,
    verified: 7,
    items: [
      {
        footnote: '[^1]',
        ref: '[[CIO.com 2026-01 BlackFog影子AI调查#^c1]]',
        sentence: '相当比例：49% 的员工承认未经批准采用 AI 工具',
        verified: false,
        entity: { pass: true, missing: [] },
        deepseek: { fit: '部分', reason: '原文只支撑49%这半句。' },
        kimi: { fit: '撑得住', reason: '原文49%与句子对应。' },
      },
      {
        footnote: '[^8]',
        ref: '[[...#^c1]]',
        sentence: '',
        verified: false,
      },
    ],
  },
};

describe('readCitationVerify', () => {
  it('reads the two items of the example, by the digits of their footnote', () => {
    const items = readCitationVerify(EXAMPLE);
    expect(items.map((i) => i.id)).toEqual(['1', '8']);
    expect(items[0]).toMatchObject({
      ref: '[[CIO.com 2026-01 BlackFog影子AI调查#^c1]]',
      sentence: '相当比例：49% 的员工承认未经批准采用 AI 工具',
      verified: false,
      entityMissing: [],
    });
  });

  it('builds the two gates as "<fit>：<reason>", and 没判出来 when a gate has no fit', () => {
    const [first, second] = readCitationVerify(EXAMPLE);
    expect(first.deepseek).toBe('部分：原文只支撑49%这半句。');
    expect(first.kimi).toBe('撑得住：原文49%与句子对应。');
    expect(second.deepseek).toBe('没判出来');
    expect(second.kimi).toBe('没判出来');
  });

  it('verified only for a literal true; junk and items without a usable footnote are left out', () => {
    expect(readCitationVerify({ citation_verify: { items: [{ footnote: '[^2]', verified: 'true' }] } })[0].verified).toBe(false);
    expect(readCitationVerify({ citation_verify: { items: [{ footnote: '[^2]', verified: true }] } })[0].verified).toBe(true);
    expect(readCitationVerify({ citation_verify: 3 })).toEqual([]);
    expect(readCitationVerify({})).toEqual([]);
    expect(readCitationVerify({ citation_verify: { items: [{ sentence: 'no footnote', verified: true }, { footnote: 'x' }, 'bad'] } })).toEqual([]);
  });

  it('entityMissing is entity.missing', () => {
    const [item] = readCitationVerify({ citation_verify: { items: [{ footnote: '[^3]', entity: { pass: false, missing: ['49%', '三成'] } }] } });
    expect(item.entityMissing).toEqual(['49%', '三成']);
  });
});

describe('verifyMarks', () => {
  const item = (over: Partial<VerifyItem> = {}): VerifyItem => ({
    id: '1',
    ref: '[[资料甲#^c1]]',
    sentence: '未批准使用已在三成以上',
    verified: false,
    entityMissing: [],
    deepseek: '部分：原文只支撑半句。',
    kimi: '撑得住：原文对得上。',
    ...over,
  });

  it('skips an item whose sentence is blank', () => {
    expect(verifyMarks([item({ sentence: '  ' })])).toEqual([]);
  });

  it('a verified item is ok, with what the three checks said on hover', () => {
    const [mark] = verifyMarks([item({ verified: true, entityMissing: [] })]);
    expect(mark).toMatchObject({ id: '1', ref: '[[资料甲#^c1]]', sentence: '未批准使用已在三成以上', kind: 'ok' });
    expect(mark.title).toBe('三道核对都过了：名称和数字对得上；两个模型各自判过，都认为原文撑得住这句话。');
  });

  it('an unverified item is unverified, with the entity result and both models', () => {
    const [mark] = verifyMarks([item({ entityMissing: ['三成', '49%'] })]);
    expect(mark.kind).toBe('unverified');
    expect(mark.title).toBe(['名称和数字：原文里没有：三成、49%', '第一个模型：部分：原文只支撑半句。', '第二个模型：撑得住：原文对得上。'].join('\n'));
  });

  it('an unverified item whose names and numbers do match says 对得上', () => {
    const [mark] = verifyMarks([item({ entityMissing: [] })]);
    expect(mark.title.split('\n')[0]).toBe('名称和数字：对得上');
  });
});

describe('footnoteMarks with two arguments', () => {
  it('returns exactly the marks it did before: no kind on either', () => {
    const c = readCitationFlags({ citation_flags: [{ footnote: '[^9]', sentence: '押管理栈', quote: 'q', reason: 'r' }] });
    const e = readEntityFlags({ entity_flags: [{ key: '[[甲#^c1]]', footnote: '[^10]', sentence: 's', missing: ['x'] }] });
    const marks = footnoteMarks(c, e);
    expect(marks).toEqual([
      { id: '9', ref: '', sentence: '押管理栈', title: '理由：r\n原文：“q”' },
      { id: '10', ref: '[[甲#^c1]]', sentence: 's', title: '原文里没有出现：x' },
    ]);
    expect(marks.every((m) => !('kind' in m))).toBe(true);
  });
});

describe('the tags on the page', () => {
  const SENTENCE = '未批准使用已在三成以上';
  const MD = ['# R 调查报告 v1', '## Summary', `- ${SENTENCE}[^1]。`, '## 引文出处', '[^1]: “某句原文”（B 级，网络 · AI 定级）[[资料甲#^c1]]'].join('\n');
  const item = (verified: boolean): VerifyItem => ({
    id: '1',
    ref: '[[资料甲#^c1]]',
    sentence: SENTENCE,
    verified,
    entityMissing: [],
    deepseek: '部分：原文只支撑半句。',
    kimi: '撑得住：原文对得上。',
  });
  const render = (over: Record<string, unknown> = {}) => html(createElement(ReportViewer, { markdown: MD, citations: {}, delivery: '已交付', ...over }));

  it('a verified footnote gets the green ✓ 依据, what the checks said on hover', () => {
    const out = render({ citationVerify: [item(true)] });
    expect(out).toContain('data-testid="verify-ok-tag"');
    expect(out).toContain('✓ 依据');
    expect(out).toContain('三道核对都过了');
    expect(out).not.toContain('verify-unverified-tag');
  });

  it('an unverified footnote gets the grey 相关资料 tag, not the ✓', () => {
    const out = render({ citationVerify: [item(false)] });
    expect(out).toContain('data-testid="verify-unverified-tag"');
    expect(out).toContain('相关资料（没核实能不能撑住这句话）');
    expect(out).not.toContain('✓ 依据');
    expect(out).not.toContain('verify-ok-tag');
  });

  it('a citation_flags warning on the same footnote keeps only ⚠ 引文可能对不上', () => {
    const out = render({
      citationVerify: [item(false)],
      citationFlags: [{ footnote: '[^1]', ref: '[[资料甲#^c1]]', sentence: SENTENCE, quote: '某句原文', reason: '原文说的不是这句' }],
    });
    expect(out).toContain('⚠ 引文可能对不上');
    expect(out).not.toContain('verify-ok-tag');
    expect(out).not.toContain('verify-unverified-tag');
  });

  it('without citation_verify the page is as before: no new tags, and undefined is the same as []', () => {
    const before = render();
    expect(before).not.toContain('verify-ok-tag');
    expect(before).not.toContain('verify-unverified-tag');
    expect(render({ citationVerify: [] })).toBe(before);
  });
});

describe('an empty clause with citation_verify present', () => {
  const MD = ['# R 调查报告 v1', '## Summary', '- 依据：[^2]', '## 引文出处', '[^2]: “某句原文”（B 级，网络 · AI 定级）[[资料甲#^c1]]'].join('\n');
  const any: VerifyItem = { id: '1', ref: '', sentence: '别的一句话', verified: true, entityMissing: [], deepseek: '撑得住：x', kimi: '撑得住：x' };

  it('the footnote is not drawn; without citation_verify it still is', () => {
    const hidden = html(createElement(ReportViewer, { markdown: MD, citations: {}, delivery: '已交付', citationVerify: [any] }));
    expect(count(hidden, /data-testid="footnote-ref"/g)).toBe(0);
    const shown = html(createElement(ReportViewer, { markdown: MD, citations: {}, delivery: '已交付' }));
    expect(count(shown, /data-testid="footnote-ref"/g)).toBe(1);
  });
});
