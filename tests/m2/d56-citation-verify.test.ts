/**
 * D-56 ⑦: "三关核对" of a first-layer footnote — the clause's names and numbers are in the source (entity, no model),
 * and two different models judge the (clause, original) pair independently, at the same time; only all three passing
 * is verified. The module and its result only: no page, no execute.ts, no frontmatter. Judges are fakes; no model,
 * no network.
 */
import { describe, expect, it, vi } from 'vitest';
import { citationVerifyPrompt, WRITING_SYSTEM } from '@/lib/harness/prompts/research-execute';
import type { CitationSite, Fit } from '@/lib/research/citation-fit';
import { entityGate, fitJudge, verifyCitations, verifyPairs, type FitJudge, type VerifyPair } from '@/lib/research/citation-verify';
import { firstLayerClauses, type FootnoteSource } from '@/lib/research/entity-check';
import { LlmTruncatedError } from '@/lib/research/llm';
import { taskLine } from '@/lib/testing/mock-contract';

const src = (ref: string, text: string, quote?: string): FootnoteSource => ({ ref, text, ...(quote ? { quote } : {}) });

const body = [
  '# R',
  '',
  '## Summary',
  '- 回答（一句话）：付钱的是微软席位[^1]；惠普也有[^2]。',
  '- 所以联想：付钱的是微软席位[^1]。',
  '',
  '| | 提议 |',
  '|---|---|',
  '| 看什么指标 | 看单价<br>依据：微软[^3] 每用户每月 90.45 美元起[^1] |',
  '',
  '## Q1 谁付钱',
  '',
  '### 假设 H1：IT 付钱',
  '- 回答：IT 付钱，惠普 18%[^2]',
  '- 理由：',
  '  - 戴尔 Dell 也是[^4]',
  '- 支持的证据：',
  '  - 联想 99%[^4]',
  '',
  '## 引文出处',
  '[^1]: x',
].join('\n');

const sources = new Map([
  ['1', src('[[微软定价#^c1]]', 'Microsoft 365 E5 $90.45 per user/month\n微软定价\nMicrosoft', 'Microsoft 365 E5 $90.45 per user/month')],
  ['2', src('[[惠普年报#^c2]]', 'HP shipped 18% more\n惠普年报\nHP Inc')],
  ['4', src('[[IDC 报告#^c9]]', '市场份额排名\nIDC 报告\nIDC')],
]);

describe('the clauses and the pairs', () => {
  it('Summary lines and table cells, a card\'s 回答 and 理由 (its sub-items), not 支持的证据', () => {
    expect(firstLayerClauses(body)).toEqual([
      { sentence: '付钱的是微软席位', footnotes: ['1'] },
      { sentence: '惠普也有', footnotes: ['2'] },
      { sentence: '付钱的是微软席位', footnotes: ['1'] },
      { sentence: '微软', footnotes: ['3'] },
      { sentence: '每用户每月 90.45 美元起', footnotes: ['1'] },
      { sentence: 'IT 付钱，惠普 18%', footnotes: ['2'] },
      { sentence: '戴尔 Dell 也是', footnotes: ['4'] },
    ]);
  });

  it('one pair per footnote with a source, ids p1…; [^3] has none; the same (ref, sentence) once; quote falls back to text', () => {
    const pairs = verifyPairs(body, sources);
    expect(pairs.map((p) => [p.id, p.footnote, p.sentence])).toEqual([
      ['p1', '[^1]', '付钱的是微软席位'],
      ['p2', '[^2]', '惠普也有'],
      ['p3', '[^1]', '每用户每月 90.45 美元起'],
      ['p4', '[^2]', 'IT 付钱，惠普 18%'],
      ['p5', '[^4]', '戴尔 Dell 也是'],
    ]);
    expect(pairs[0]).toEqual({
      id: 'p1',
      footnote: '[^1]',
      ref: '[[微软定价#^c1]]',
      sentence: '付钱的是微软席位',
      quote: 'Microsoft 365 E5 $90.45 per user/month',
      source: 'Microsoft 365 E5 $90.45 per user/month\n微软定价\nMicrosoft',
    });
    expect(pairs[1].quote).toBe(pairs[1].source);
  });
});

describe('entityGate', () => {
  it('a number the source does not have fails with what is missing; the source has it: pass; nothing to look for: pass', () => {
    expect(entityGate('占 49%', '约两成企业')).toEqual({ pass: false, missing: ['49%'] });
    expect(entityGate('占 49%', '49% 的企业')).toEqual({ pass: true, missing: [] });
    expect(entityGate('服务收入占比高证据不足', '份额 24.2%')).toEqual({ pass: true, missing: [] });
  });
});

// D-64 T24: the second check also says what the original can / cannot support (without them it does not pass)
const SCOPE = { can: '微软的份额', cannot: '惠普的份额' };
const judgeWith = (fits: Record<string, Fit>, reason = ''): FitJudge => async (items) => new Map(items.map((i) => [i.id, { fit: fits[i.id] ?? '撑得住', reason, ...SCOPE }]));

const four: VerifyPair[] = [
  { id: 'p1', footnote: '[^1]', ref: '[[a#^c1]]', sentence: '微软 49%', quote: '微软 49%', source: '微软 49% 的份额' },
  { id: 'p2', footnote: '[^2]', ref: '[[b#^c2]]', sentence: '微软 49%', quote: '微软 49%', source: '微软 49% 的份额' },
  { id: 'p3', footnote: '[^3]', ref: '[[c#^c3]]', sentence: '微软 49%', quote: '微软 49%', source: '微软 49% 的份额' },
  { id: 'p4', footnote: '[^4]', ref: '[[d#^c4]]', sentence: '微软 49%', quote: '惠普 18%', source: '惠普 18%' },
];

describe('verifyCitations: three gates, all must pass', () => {
  it('全过才 verified；部分、挂错、entity 不过都不算；counts 按每一关数', async () => {
    const r = await verifyCitations(four, { deepseek: judgeWith({ p2: '部分' }, '只讲一部分'), kimi: judgeWith({ p3: '挂错' }, '原文讲的是别的') });
    expect(r.items.map((x) => [x.footnote, x.verified])).toEqual([
      ['[^1]', true],
      ['[^2]', false],
      ['[^3]', false],
      ['[^4]', false],
    ]);
    expect(r.items[3].entity).toEqual({ pass: false, missing: ['微软', '49%'] });
    expect(r.items[1].deepseek).toEqual({ fit: '部分', reason: '只讲一部分', ...SCOPE });
    expect(r.items[2].kimi).toEqual({ fit: '挂错', reason: '原文讲的是别的', ...SCOPE });
    expect(r.counts).toEqual({ checked: 4, verified: 1, failed: { entity: 1, deepseek: 1, kimi: 1 } });
    expect(r.seconds).toBeGreaterThanOrEqual(0);
  });

  it('一个裁判报错：那一关全 null，不抛；另一个裁判的结果还在；verified 0', async () => {
    const down: FitJudge = async () => {
      throw new Error('kimi down');
    };
    const r = await verifyCitations(four, { deepseek: judgeWith({}), kimi: down });
    expect(r.items.every((x) => x.kimi.fit === null && x.kimi.reason === '')).toBe(true);
    expect(r.items[0].deepseek.fit).toBe('撑得住');
    expect(r.counts).toMatchObject({ verified: 0, failed: { kimi: 4 } });
  });

  it('a pair missing from a judge\'s map: that gate null, not verified', async () => {
    const partial: FitJudge = async (items) => new Map(items.filter((i) => i.id !== 'p2').map((i) => [i.id, { fit: '撑得住' as const, reason: '', ...SCOPE }]));
    const r = await verifyCitations(four, { deepseek: partial, kimi: judgeWith({}) });
    expect(r.items[1].deepseek).toEqual({ fit: null, reason: '' });
    expect(r.items[1].verified).toBe(false);
    expect(r.items[0].verified).toBe(true);
  });

  it('no pairs: no judge called, empty result', async () => {
    const spy = vi.fn(async (_items: CitationSite[]) => new Map<string, { fit: Fit; reason: string }>());
    const r = await verifyCitations([], { deepseek: spy, kimi: spy });
    expect(spy).not.toHaveBeenCalled();
    expect(r).toMatchObject({ items: [], counts: { checked: 0, verified: 0, failed: { entity: 0, deepseek: 0, kimi: 0 } } });
  });

  it('the two models are asked at the same time', async () => {
    let calls = 0;
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const judge: FitJudge = async (items) => {
      calls += 1;
      if (calls === 2) release();
      await gate;
      return new Map(items.map((i) => [i.id, { fit: '撑得住' as const, reason: '' }]));
    };
    const r = await verifyCitations(four, { deepseek: judge, kimi: judge });
    expect(r.counts.checked).toBe(4);
  });
});

const sites = (n: number): CitationSite[] => Array.from({ length: n }, (_, i) => ({ id: `p${i + 1}`, part: 'verify', sentence: '句子', key: '[^1]', quote: '原文' }));
const idsIn = (prompt: string) => [...prompt.matchAll(/^- id：(\S+)$/gm)].map((m) => m[1]);

describe('fitJudge', () => {
  it('25 items in 5 concurrent calls through citationVerifyPrompt', async () => {
    let started = 0;
    let release!: () => void;
    const both = new Promise<void>((r) => {
      release = r;
    });
    const llm = vi.fn(async (_task: string, p: { system: string; prompt: string }) => {
      started += 1;
      if (started === 5) release();
      await both;
      return { items: idsIn(p.prompt).map((id) => ({ id, fit: '撑得住', reason: '' })) };
    });
    const judge = fitJudge({ llm, log: vi.fn(async () => {}), signal: undefined } as never, 'citation-verify');
    const out = await judge(sites(25));
    expect(out.size).toBe(25);
    expect(llm).toHaveBeenCalledTimes(5);
    expect(llm.mock.calls[0][1].prompt).toContain('拿不准时判部分');
  });

  it('a truncated 2-item batch is split into two single calls', async () => {
    const calls: string[][] = [];
    const llm = vi.fn(async (_task: string, p: { system: string; prompt: string }) => {
      const got = idsIn(p.prompt);
      calls.push(got);
      if (got.length === 2) throw new LlmTruncatedError('cut off');
      return { items: got.map((id) => ({ id, fit: '撑得住', reason: '' })) };
    });
    const judge = fitJudge({ llm, log: vi.fn(async () => {}), signal: undefined } as never, 'citation-verify');
    const out = await judge(sites(2));
    expect(out.size).toBe(2);
    expect(calls).toEqual([['p1', 'p2'], ['p1'], ['p2']]);
  });
});

describe('citationVerifyPrompt', () => {
  it('every id appears; the stricter wording; the output format line', () => {
    const p = citationVerifyPrompt([
      { id: 'p1', sentence: '句子一', key: '[^1]', quote: '原文一' },
      { id: 'p2', sentence: '句子二', key: '[^2]', quote: '原文二' },
    ]);
    expect(p.system).toBe(`${WRITING_SYSTEM}\n${taskLine('citation_judge')}`); // D-64 T19: the mock picks it by its task line
    expect(p.prompt).toContain('id：p1');
    expect(p.prompt).toContain('id：p2');
    expect(p.prompt).toContain('拿不准时判部分');
    expect(p.prompt).toContain('输出 JSON：{"items":[{"id":"…","fit":"撑得住|部分|挂错","reason":"…","can":"…","cannot":"…"}]}');
  });
});
