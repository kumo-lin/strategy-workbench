/**
 * The judge must not end in "证据不足 · 需要重新跑判断" because the answer was cut off (WS-A full run, C1: 47 refutes, all
 * of them challenges; the answer reached 16,000 tokens twice, most of them the model's thinking). A cut-off answer
 * (finish_reason = length) is not asked again as it was; many refutes are judged in two steps: the verdict on all the
 * evidence, then the responses in batches. Fixture: C1's real input size (57 lines: 10 supports, 47 refutes from 9 sources).
 */
import { MockLanguageModelV3 } from 'ai/test';
import { describe, expect, it } from 'vitest';
import { judgePrompt, responsesPrompt, type EvidenceLine } from '@/lib/harness/prompts/research-execute';
import type { Evidence } from '@/lib/research/evidence';
import { JUDGE_MAX_OUTPUT_TOKENS, JUDGE_SPLIT_AT, judgeCalls, RESPONSE_BATCH, responseBatches } from '@/lib/research/judge';
import { llmJson, LlmTruncatedError } from '@/lib/research/llm';
import { judgmentSchema, responseKeys } from '@/lib/research/schemas';
import { answerResearchStep } from '@/lib/testing/mock-research';

const usage = { inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 1, text: 1, reasoning: 0 } };

/** C1's shape: `supports` supports, then `refutes` refutes (partial: all of them challenges), `sources` sources round-robin. */
function c1(supports = 10, refutes = 47, sources = 9) {
  const lines: EvidenceLine[] = [];
  const keyed = new Map<string, Evidence>();
  for (let i = 1; i <= supports + refutes; i++) {
    const refute = i > supports;
    const key = `E${i}`;
    lines.push({ key, stance: refute ? 'refutes' : 'supports', grade: refute && i % 3 === 0 ? '专家意见' : 'C', origin: '网页', publisher: `发布方 ${i % sources}`, published: '2026-10', quote: `原文 ${i}`, reason: '评估理由', core: false, partial: refute });
    keyed.set(key, { ref: `[[资料 ${i % sources}#^c${i}]]` } as Evidence);
  }
  return { lines, keyed };
}

const input = (lines: EvidenceLine[]) => ({
  claim: { id: 'C1', statement: '选型权在 IT', conditions: ['IT 管准入'], question: '谁决定买？', qid: 'Q1', label: 'H1' },
  hypothesisLabel: null,
  evidence: lines,
  subQuestions: [{ id: 'C1-Q1', question: '谁批？', methods: ['资料'], stop: '已查完' }],
  context: '',
  exploratory: false,
});

const judgment = (rows: { key: string }[] = []) => ({
  verdict: '需要修改',
  rebutted: [],
  revised_statement: '只在受监管行业成立：IT 管准入',
  revised_assertions: [{ text: 'IT 管准入', keys: ['E1', 'E2'] }],
  support_lines: ['IT 管准入 [E1]'],
  counter_lines: [],
  reasoning: '多家来源说 IT 管准入 [E1]',
  model_knowledge: [],
  so_what: ['先打 IT'],
  gaps: [],
  expert_questions: [],
  challenge_responses: rows.map((r) => ({ ...r, challenge: '挑战', response: '它说的是预算 [E1]；推断：不影响准入', effect: '不影响判断' })),
});

const keysIn = (text: string, marker: RegExp) => [...(marker.exec(text)?.[1].matchAll(/E\d+/g) ?? [])].map((m) => m[0]);

interface Call {
  kind: 'one' | 'verdict' | 'responses';
  keys: string[];
  max: number | undefined;
}

/**
 * A model that answers the judge's three kinds of call. `cut(call)` = this answer is cut off at the limit: half a
 * JSON with finish_reason "length" (what the live run got).
 */
function judgeModel(cut: (c: Call) => boolean = () => false) {
  const calls: Call[] = [];
  const model = new MockLanguageModelV3({
    doGenerate: async (options) => {
      const text = (options.prompt as { content: unknown }[]).map((m) => (typeof m.content === 'string' ? m.content : (m.content as { text?: string }[]).map((p) => p.text ?? '').join(''))).join('\n');
      const call: Call = text.includes('请逐条回应这几条反驳')
        ? { kind: 'responses', keys: keysIn(text, /这一次只回应这几条"反驳"：([^（]*)（/), max: options.maxOutputTokens }
        : { kind: text.includes('下一步再逐条回应') ? 'verdict' : 'one', keys: keysIn(text, /上面每一条"反驳"（([^）]*)）/), max: options.maxOutputTokens };
      calls.push(call);
      const answer = call.kind === 'responses' ? { challenge_responses: judgment(call.keys.map((key) => ({ key }))).challenge_responses } : judgment(call.keys.map((key) => ({ key })));
      const full = JSON.stringify(answer);
      const truncated = cut(call);
      return { content: [{ type: 'text', text: truncated ? full.slice(0, Math.floor(full.length / 2)) : full }], finishReason: truncated ? { unified: 'length', raw: 'length' } : { unified: 'stop', raw: 'stop' }, usage, warnings: [] };
    },
  });
  const logs: string[] = [];
  const run = {
    signal: undefined,
    log: async (kind: string, message: string) => {
      logs.push(`${kind} ${message}`);
    },
    llm: <T>(task: string, p: { system: string; prompt: string }, schema: import('zod').ZodType<T>, o: { maxOutputTokens?: number } = {}) =>
      llmJson({ model, task, system: p.system, prompt: p.prompt, schema, maxOutputTokens: o.maxOutputTokens }),
  };
  return { calls, logs, run: run as never, llm: run.llm };
}

const answeredKeys = (j: { challenge_responses: { key: string; response: string }[] }) => new Set(j.challenge_responses.filter((c) => c.response.trim()).flatMap(responseKeys));

describe('a cut-off answer is detected (finish_reason = length)', () => {
  it('thrown as LlmTruncatedError after one call, not asked again as it was', async () => {
    const { calls, llm } = judgeModel(() => true);
    await expect(llm('judge:C1', judgePrompt(input(c1(10, 3).lines)), judgmentSchema)).rejects.toBeInstanceOf(LlmTruncatedError);
    expect(calls).toHaveLength(1);
  });

  it('the output limit is passed to the model', async () => {
    const { calls, run } = judgeModel();
    await judgeCalls(run, 'C1', input(c1(10, 3).lines), c1(10, 3).keyed);
    expect(calls).toEqual([{ kind: 'one', keys: ['E11', 'E12', 'E13'], max: JUDGE_MAX_OUTPUT_TOKENS }]);
  });
});

describe('judgeCalls', () => {
  it('C1\'s size (47 refutes): the verdict first, then batches of at most RESPONSE_BATCH; every challenge answered once', async () => {
    const { lines, keyed } = c1();
    const { calls, logs, run } = judgeModel();
    const j = await judgeCalls(run, 'C1', input(lines), keyed);
    expect(calls[0]).toMatchObject({ kind: 'verdict', max: JUDGE_MAX_OUTPUT_TOKENS });
    expect(calls.filter((c) => c.kind === 'one')).toEqual([]);
    const batches = calls.filter((c) => c.kind === 'responses');
    expect(batches.every((b) => b.keys.length >= 1 && b.keys.length <= RESPONSE_BATCH)).toBe(true);
    expect(batches.flatMap((b) => b.keys).sort()).toEqual(lines.filter((l) => l.stance === 'refutes').map((l) => l.key).sort());
    const answered = answeredKeys(j);
    expect(lines.filter((l) => l.stance === 'refutes').every((l) => answered.has(l.key))).toBe(true);
    expect(j.challenge_responses).toHaveLength(47);
    expect(j.verdict).toBe('需要修改');
    expect(logs.some((l) => l.startsWith('research:judge-split C1：先判断，再分') && l.includes('47 条反驳'))).toBe(true);
  });

  it('a one-call answer cut off at the limit goes straight to the split (no second identical call)', async () => {
    const { lines, keyed } = c1(10, 8);
    const { calls, logs, run } = judgeModel((c) => c.kind === 'one');
    const j = await judgeCalls(run, 'C1', input(lines), keyed);
    expect(calls.map((c) => c.kind)).toEqual(['one', 'verdict', ...calls.slice(2).map(() => 'responses')]);
    expect(calls.filter((c) => c.kind === 'one')).toHaveLength(1);
    expect(answeredKeys(j).size).toBe(8);
    expect(logs.find((l) => l.startsWith('research:judge-split'))).toBeDefined();
  });

  it('few refutes: one call, as before', async () => {
    const { lines, keyed } = c1(10, JUDGE_SPLIT_AT);
    const { calls, run } = judgeModel();
    await judgeCalls(run, 'C1', input(lines), keyed);
    expect(calls.map((c) => c.kind)).toEqual(['one']);
  });

  it('a batch cut off is halved; a single refute that still fails stays unanswered (the self-check lists it), the rest are kept', async () => {
    const { lines, keyed } = c1(10, 47);
    const { calls, logs, run } = judgeModel((c) => c.kind === 'responses' && c.keys.includes('E20'));
    const j = await judgeCalls(run, 'C1', input(lines), keyed);
    const answered = answeredKeys(j);
    expect(answered.has('E20')).toBe(false);
    expect(answered.size).toBe(46);
    expect(calls.some((c) => c.kind === 'responses' && c.keys.length === 1 && c.keys[0] === 'E20')).toBe(true);
    expect(logs.some((l) => l.startsWith('research:judge-responses-failed C1 回应 [E20]'))).toBe(true);
  });

  it('the verdict call itself cut off: thrown (judgeClaim then writes 证据不足 with the reason, as before)', async () => {
    const { lines, keyed } = c1();
    const { run } = judgeModel((c) => c.kind === 'verdict');
    await expect(judgeCalls(run, 'C1', input(lines), keyed)).rejects.toBeInstanceOf(LlmTruncatedError);
  });
});

describe('the prompts and batches', () => {
  it('a source\'s refutes stay in one batch when they fit, so the ones that say the same thing can share a row', () => {
    const keyed = new Map<string, Evidence>(['E1', 'E2', 'E3', 'E4', 'E5'].map((k, i) => [k, { ref: `[[${i % 2 ? 'B' : 'A'}#^c${i}]]` } as Evidence]));
    expect(responseBatches(['E1', 'E2', 'E3', 'E4', 'E5'], keyed, 3)).toEqual([['E1', 'E3', 'E5'], ['E2', 'E4']]);
    expect(responseBatches([], keyed)).toEqual([]);
  });

  it('the verdict prompt asks for no responses; the batch prompt answers only its keys and still names the must-answer ones', () => {
    const { lines } = c1(2, 4);
    const verdict = judgePrompt({ ...input(lines), responses: 'separate' }).prompt;
    expect(verdict).toContain('请提出判断');
    expect(verdict).toContain('challenge_responses：空数组。上面的反驳（[E3]、[E4]、[E5]、[E6]）下一步再逐条回应');
    expect(verdict).toContain('"challenge_responses":[]');
    const batch = responsesPrompt({ claim: input(lines).claim, evidence: lines, keys: ['E3', 'E4'], verdict: '需要修改', revisedStatement: '只在受监管行业成立', reasoning: '理由' }).prompt;
    expect(batch).not.toContain('请提出判断');
    expect(batch).toContain('这一次只回应这几条"反驳"：[E3]、[E4]（');
    expect(batch).toContain('**这几条必须回应：[E3]、[E4]**');
    expect(batch).toContain('已经提出（这一步不改它）：需要修改，改成：只在受监管行业成立');
    // the one-call prompt is unchanged in what it asks
    expect(judgePrompt(input(lines)).prompt).toContain('上面每一条"反驳"（[E3]、[E4]、[E5]、[E6]）都要回应');
  });

  it('the e2e mock model answers the batch prompt', () => {
    const { lines } = c1(2, 4);
    const a = answerResearchStep(responsesPrompt({ claim: input(lines).claim, evidence: lines, keys: ['E3', 'E4'], verdict: '成立', revisedStatement: null, reasoning: 'x' }).prompt) as { challenge_responses: { key: string }[] };
    expect(a.challenge_responses.map((c) => c.key)).toEqual(['E3', 'E4']);
  });
});
