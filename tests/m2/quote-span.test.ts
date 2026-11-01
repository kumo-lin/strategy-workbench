/**
 * Quote truncation (an external reviewer's scoring of 报告 v2), with the three real cases: the 82.9% cut off at "IT and s…",
 * "not permitted" cut off after "used AI tools …", and an ingested claim that stopped at "coming from".
 */
import { describe, expect, it } from 'vitest';
import { verifyQuotes } from '@/lib/research/claims';
import { citationOf } from '@/lib/research/report';
import { displayExcerpt, locateQuote, toFullSentence } from '@/lib/research/quote-span';
import type { Evidence } from '@/lib/research/evidence';
import { normalizeForQuote } from '@/lib/vault/blocks';

const EMA =
  'The report, produced by Enterprise Management Associates and based on a survey of IT and security leaders, found that 82.9% of organisations had seen AI projects delayed before reaching production because of security or compliance reviews.';
const EMA_PAGE = `${EMA} It also found that 81.6% had deployed AI in a reduced form because of security concerns, including limits on agent autonomy or data access.`;
const PAGERDUTY =
  'According to the findings, two-thirds of office professionals report having used AI tools or services at work even though they believed doing so was not permitted under company policy.';
const INVESTING_PAGE =
  'Morgan Stanley outlines several explanations for why AI excitement is not flowing into higher budgets, including a “do more with less” approach, a “K-shaped IT budget” that reallocates spending toward Software and away from Hardware and Communications, and AI funding increasingly coming from “outside of IT.”\n\nNext paragraph.';

/** The quote check a report goes through: the shown text must be inside the stored block. */
const passesCheck = (shown: string, block: string) => normalizeForQuote(block).includes(normalizeForQuote(shown));

describe('stored claims are whole sentences (ingest / extraction)', () => {
  it('a pick that stops mid-sentence is stored as the whole sentence: "outside of IT" is kept', () => {
    const picked = 'that reallocates spending toward Software and away from Hardware and Communications, and AI funding increasingly coming from';
    const full = toFullSentence(INVESTING_PAGE, picked);
    expect(full).toMatch(/^Morgan Stanley outlines/);
    expect(full).toMatch(/coming from “outside of IT\.”$/);
    expect(verifyQuotes(INVESTING_PAGE, [{ quote: full }]).kept).toHaveLength(1);
  });

  it('a pick cut inside a word grows to the sentence, which keeps the number and stops at the sentence end (not at 82.9)', () => {
    const full = toFullSentence(EMA_PAGE, 'based on a survey of IT and s');
    expect(full).toBe(EMA);
  });

  it('a pick that is already a whole sentence is unchanged; an unplaceable one is left as it was', () => {
    expect(toFullSentence(EMA_PAGE, EMA)).toBe(EMA);
    expect(toFullSentence(EMA_PAGE, 'not on the page at all')).toBe('not on the page at all');
  });

  it('Chinese sentences end at 。', () => {
    const page = '调研显示，IT 部门主导了采购。另有调查认为，员工并不在乎 NPU。';
    expect(toFullSentence(page, '员工并不在乎')).toBe('另有调查认为，员工并不在乎 NPU。');
    expect(locateQuote(page, '员工并不在乎')).not.toBeNull();
  });
});

describe('quotes shown in a report are cut by meaning', () => {
  const ev = (quote: string): Evidence =>
    ({ ref: '[[s#^c1]]', quote, grade: 'C', origin: '网络', gradedBy: 'AI', sourceKind: 'source' }) as unknown as Evidence;

  it('EMA: the number and what it says are kept', () => {
    const shown = displayExcerpt(EMA);
    expect(shown).toContain('82.9%');
    expect(shown).toContain('delayed before reaching production');
    expect(passesCheck(shown, EMA)).toBe(true);
  });

  it('PagerDuty: "not permitted" is kept', () => {
    const shown = displayExcerpt(PAGERDUTY);
    expect(shown).toContain('not permitted under company policy');
    expect(shown).toContain('two-thirds');
    expect(passesCheck(shown, PAGERDUTY)).toBe(true);
  });

  it('a short quote is shown whole; the citation line uses the excerpt and still passes the quote check', () => {
    expect(displayExcerpt('IT 部门主导了采购。')).toBe('IT 部门主导了采购。');
    const line = citationOf(ev(EMA));
    const shown = /“([^”]+)”/.exec(line)![1];
    expect(shown).toContain('82.9%');
    expect(passesCheck(shown, EMA)).toBe(true);
  });
});

describe('Investing.com: a long sentence whose point is in its last clause', () => {
  it('the shown excerpt reaches "outside of IT"', () => {
    const sentence = toFullSentence(INVESTING_PAGE, 'AI funding increasingly coming from');
    const shown = displayExcerpt(sentence);
    expect(shown).toContain('outside of IT');
    expect(passesCheck(shown, sentence)).toBe(true);
  });
});
