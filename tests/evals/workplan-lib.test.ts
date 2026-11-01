/** The workplan eval's pure helpers: answer picking, transcript, run checks and the results markdown. */
import { describe, expect, it } from 'vitest';
import type { Check } from '../../evals/judges';
import type { AskCard, RoundRecord, RunRecord } from '../../evals/workplan-lib';
import { pickAnswer, renderResultsMarkdown, renderRunMarkdown, runChecks, visibleChat, visibleChatPieces } from '../../evals/workplan-lib';
import { EVAL_QUESTIONS } from '../../evals/workplan-questions';

const card = (over: Partial<AskCard> = {}): AskCard => ({
  question: '你想先看哪一块？',
  options: [
    { id: 'a', label: '管理栈' },
    { id: 'b', label: '端侧算力' },
  ],
  ...over,
});

const round = (over: Partial<RoundRecord> = {}): RoundRecord => ({ round: 1, texts: [], tools: [], ask: null, answer: null, ...over });

const record = (over: Partial<RunRecord> = {}): RunRecord => ({
  questionId: 1,
  run: 1,
  ms: 12345,
  rounds: [],
  workplan: { version: 1, body: '# 计划', problems: [], askCount: 0 },
  ...over,
});

const q = (id: 1 | 2 | 3 | 4 | 5) => EVAL_QUESTIONS.find((x) => x.id === id)!;

const failed = (checks: Check[], name: string) => checks.find((c) => c.name === name)!;

describe('pickAnswer', () => {
  it('picks the option whose label matches pickLabel, else the typed text', () => {
    expect(pickAnswer(card(), { pickLabel: /端侧/ })).toEqual({ selected: ['b'] });
    expect(pickAnswer(card(), { pickLabel: /都不对/, text: '我自己说' })).toEqual({ selected: [], text: '我自己说' });
    expect(pickAnswer(card(), { text: '直接说' })).toEqual({ selected: [], text: '直接说' });
  });
  it('takes the first option, or types a default when the card has no options', () => {
    expect(pickAnswer(card(), {})).toEqual({ selected: ['a'] });
    expect(pickAnswer({ question: '有别的吗？', options: [] }, {})).toEqual({ selected: [], text: '按你的推荐来。' });
  });
  it('uses the scripted text for the first card only', () => {
    expect(pickAnswer(card(), { text: '直接说' }, 0)).toEqual({ selected: [], text: '直接说' });
    expect(pickAnswer(card(), { text: '直接说' }, 1)).toEqual({ selected: ['a'] });
    expect(pickAnswer({ question: '有别的吗？', options: [] }, { text: '直接说' }, 1)).toEqual({ selected: [], text: '按你的推荐来。' });
  });
  it('picks a matching label on any card', () => {
    expect(pickAnswer(card(), { pickLabel: /端侧/ }, 0)).toEqual({ selected: ['b'] });
    expect(pickAnswer(card(), { pickLabel: /端侧/ }, 2)).toEqual({ selected: ['b'] });
  });
  it('prefers the confirm option 就按这个拆 over the scripted text', () => {
    const confirm = card({ options: [{ id: 'a', label: '再改改' }, { id: 'b', label: '就按这个拆' }] });
    expect(pickAnswer(confirm, { text: '直接说' }, 0)).toEqual({ selected: ['b'] });
    expect(pickAnswer(confirm, { text: '直接说' }, 2)).toEqual({ selected: ['b'] });
  });
  it('still lets pickLabel win over the confirm option', () => {
    const confirm = card({ options: [{ id: 'a', label: '再改改' }, { id: 'b', label: '就按这个拆' }] });
    expect(pickAnswer(confirm, { pickLabel: /再改/, text: '直接说' }, 0)).toEqual({ selected: ['a'] });
  });
});

describe('visibleChatPieces', () => {
  it('tags texts as text, the card question as question and option labels as option, in order', () => {
    const r = record({
      rounds: [round({ texts: ['先说结论。'], ask: card() })],
    });
    expect(visibleChatPieces(r)).toEqual([
      { kind: 'text', text: '先说结论。' },
      { kind: 'question', text: '你想先看哪一块？' },
      { kind: 'option', text: '管理栈' },
      { kind: 'option', text: '端侧算力' },
    ]);
  });
});

describe('visibleChat', () => {
  it('puts the round texts first, then the card question and its option labels', () => {
    const r = record({
      rounds: [round({ texts: ['先说结论。', '再问一句。'], ask: card({ options: [{ id: 'a', label: '管理栈' }] }) })],
    });
    expect(visibleChat(r)).toEqual(['先说结论。', '再问一句。', '你想先看哪一块？', '管理栈']);
  });
  it('keeps the round order', () => {
    const r = record({
      rounds: [
        round({ round: 1, texts: ['第一轮。'], ask: card() }),
        round({ round: 2, texts: ['第二轮。'], ask: card({ question: '还要问吗？', options: [] }) }),
      ],
    });
    expect(visibleChat(r)).toEqual(['第一轮。', '你想先看哪一块？', '管理栈', '端侧算力', '第二轮。', '还要问吗？']);
  });
});

describe('runChecks', () => {
  it('passes every check for a clean question 1 run whose workplan has no problems', () => {
    const r = record({
      rounds: [
        round({ texts: ['我先查了资料，再问你一个问题。'], tools: [{ tool: 'vault_search' }, { tool: 'ask_user' }], ask: card(), answer: { selected: ['a'] } }),
        round({ round: 2, texts: ['计划起草好了，你看看。'], tools: [{ tool: 'write_draft' }] }),
      ],
    });
    const checks = runChecks(r, q(1));
    expect(checks.every((c) => c.pass)).toBe(true);
    expect(checks.map((c) => c.name)).toEqual([
      '对话里没有内部文件名、路径、工具名',
      '对话里没有 markdown',
      '正文里最多一个问句',
      '对话字数：超限的不超过 10%',
      '不以夸奖开头',
      '不列能力清单',
      '不替用户宣布提交或批准',
      '书名号成对',
      '不出现 A1 这类代号',
      '句子完整（不停在半句上）',
      '提问之前先查了资料',
      '问题数不超过 2',
      'workplan 过结构检查',
    ]);
    expect(checks[0].detail).toBe('全部通过');
  });

  it('fails a text that stops in the middle of a sentence, leaves a title open or shows a code', () => {
    const name = (text: string) => runChecks(record({ rounds: [round({ texts: [text] })] }), q(1)).filter((c) => !c.pass && c.name !== '提问之前先查了资料').map((c) => c.name);
    expect(name('最大风险：《2026-10-16 高层')).toEqual(expect.arrayContaining(['书名号成对', '句子完整（不停在半句上）']));
    expect(name('见 A1 和 B1。')).toContain('不出现 A1 这类代号');
    expect(name('见 Q2 和 H1 以及 W1。')).not.toContain('不出现 A1 这类代号');
    expect(name('一句完整的话。')).toEqual([]);
  });

  it('fails the internal-name check on the first offending sentence and names its index', () => {
    const r = record({ rounds: [round({ texts: ['我读了项目.md，先说说。'] })] });
    const check = failed(runChecks(r, q(1)), '对话里没有内部文件名、路径、工具名');
    expect(check.pass).toBe(false);
    expect(check.detail.endsWith('（第 1 句，正文）')).toBe(true);
  });

  it('uses the piece limits: text 80, card question 120, option 60', () => {
    const length = (checks: Check[]) => failed(checks, '对话字数：超限的不超过 10%');

    const longQuestion = record({ rounds: [round({ ask: card({ question: '问'.repeat(100) }) })] });
    expect(length(runChecks(longQuestion, q(1))).detail).toBe('0/3 句超限');

    const tooLongQuestion = record({ rounds: [round({ ask: card({ question: '问'.repeat(121) }) })] });
    const qCheck = length(runChecks(tooLongQuestion, q(1)));
    expect(qCheck.detail).toBe('1/3 句超限；最长 121 字（第 1 句，卡片问题）');

    const longOption = record({ rounds: [round({ ask: card({ options: [{ id: 'a', label: '选'.repeat(61) }] }) })] });
    const oCheck = length(runChecks(longOption, q(1)));
    expect(oCheck.detail).toBe('1/2 句超限；最长 61 字（第 2 句，选项）');
  });

  it('lets up to 10% of the pieces be over the limit, and none more than 1.5 times it', () => {
    const texts = (n: number, len: number) => Array.from({ length: n }, () => '字'.repeat(len));

    const oneOf21 = record({ rounds: [round({ texts: [...texts(20, 40), '字'.repeat(85)] })] });
    const one = failed(runChecks(oneOf21, q(1)), '对话字数：超限的不超过 10%');
    expect(one.pass).toBe(true);
    expect(one.detail).toBe('1/21 句超限；最长 85 字（第 21 句，正文）');

    const threeOf21 = record({ rounds: [round({ texts: [...texts(18, 40), '字'.repeat(85), '字'.repeat(85), '字'.repeat(85)] })] });
    const three = failed(runChecks(threeOf21, q(1)), '对话字数：超限的不超过 10%');
    expect(three.pass).toBe(false);
    expect(three.detail.startsWith('3/21 句超限')).toBe(true);

    const wayTooLong = record({ rounds: [round({ texts: ['字'.repeat(130)] })] });
    const way = failed(runChecks(wayTooLong, q(1)), '对话字数：超限的不超过 10%');
    expect(way.pass).toBe(false);
    expect(way.detail).toContain('1.5');

    const oneOf11 = record({ rounds: [round({ texts: [...texts(10, 40), '字'.repeat(81)] })] });
    expect(failed(runChecks(oneOf11, q(1)), '对话字数：超限的不超过 10%').pass).toBe(true);

    const empty = failed(runChecks(record(), q(1)), '对话字数：超限的不超过 10%');
    expect(empty.pass).toBe(true);
    expect(empty.detail).toBe('0/0 句超限');
  });

  it('caps the number of asks at the question maxAsks', () => {
    const rounds = [1, 2, 3, 4].map((n) => round({ round: n, texts: [`第 ${n} 轮。`], ask: card() }));
    const check = failed(runChecks(record({ rounds }), q(1)), '问题数不超过 2');
    expect(check.pass).toBe(false);
    expect(check.detail).toBe('4 个');
    const two = rounds.slice(0, 2);
    expect(failed(runChecks(record({ rounds: two }), q(1)), '问题数不超过 2').pass).toBe(true);
    expect(q(1).maxAsks).toBe(2);
  });

  it('wants a question before drafting, and accepts a lookup-then-ask first round', () => {
    const drafted = record({
      questionId: 2,
      rounds: [round({ texts: ['我先写草稿。'], tools: [{ tool: 'write_draft' }] })],
    });
    const check = failed(runChecks(drafted, q(2)), '追问在起草之前');
    expect(check.pass).toBe(false);
    const asked = record({
      questionId: 2,
      rounds: [round({ texts: ['我先查一下再问。'], tools: [{ tool: 'vault_search' }], ask: card(), answer: { selected: ['a'] } })],
    });
    expect(failed(runChecks(asked, q(2)), '追问在起草之前').pass).toBe(true);
    const composed = record({
      questionId: 2,
      rounds: [round({ texts: ['我直接拆好了。'], tools: [{ tool: 'compose_workplan' }], ask: card(), answer: { selected: ['a'] } })],
    });
    expect(failed(runChecks(composed, q(2)), '追问在起草之前').pass).toBe(false);
  });

  it('checks question 4 names the directive by title', () => {
    const name = '提到了《…》这份资料的标题';
    const plain = record({
      questionId: 4,
      rounds: [round({ texts: ['我先按员工需求拆。'], tools: [{ tool: 'vault_search' }] })],
    });
    expect(failed(runChecks(plain, q(4)), name).pass).toBe(false);
    const quoted = record({
      questionId: 4,
      rounds: [round({ texts: ['《2026-10-16 高层周会（模拟）》里说要先看 IT 能不能管，这和你的想法不一样。'], tools: [{ tool: 'vault_search' }] })],
    });
    expect(failed(runChecks(quoted, q(4)), name).pass).toBe(true);
  });

  it('returns one failing check when the run crashed', () => {
    const checks = runChecks(record({ error: 'boom' }), q(1));
    expect(checks).toHaveLength(1);
    expect(checks[0]).toMatchObject({ name: '运行没有出错', kind: 'rule', pass: false, detail: 'boom' });
  });

  it('fails the workplan structure check when no workplan was written', () => {
    const check = failed(runChecks(record({ questionId: 3, workplan: null }), q(3)), 'workplan 过结构检查');
    expect(check.pass).toBe(false);
    expect(check.detail).toBe('没有写出 workplan');
  });
});

describe('renderRunMarkdown', () => {
  const checks: Check[] = [{ name: '不以夸奖开头', kind: 'rule', pass: false, detail: '好问题' }];
  const r = record({
    questionId: 2,
    run: 1,
    ms: 8340,
    rounds: [
      round({
        texts: ['我先查了资料，再问你一个情况。'],
        tools: [{ tool: 'vault_search' }, { tool: 'ask_user' }],
        ask: card({ question: '你想判断的是什么？', options: [{ id: 'a', label: '明年要不要押' }] }),
        answer: { selected: ['a'] },
      }),
    ],
    workplan: { version: 1, body: Array.from({ length: 30 }, (_, i) => `第 ${i + 1} 行`).join('\n'), problems: [], askCount: 1 },
  });
  const md = renderRunMarkdown(r, q(2), checks);

  it('has the heading, expectation, verdict and timing', () => {
    expect(md).toContain('### 题 2 · 题目含糊 · 第 1 次');
    expect(md).toContain(`期望：${q(2).expectation}`);
    expect(md).toContain('结果：没通过（不以夸奖开头）');
    expect(md).toContain('用时 8.3 秒 · 1 轮 · 1 个问题');
  });

  it('renders the chat without tool names', () => {
    expect(md).toContain(`用户：${q(2).text}`);
    expect(md).toContain('AI 先查了资料');
    expect(md).toContain('AI 提问：你想判断的是什么？');
    expect(md).toContain('  - 明年要不要押');
    expect(md).toContain('用户答：明年要不要押');
    expect(md).not.toContain('vault_search');
    expect(md).not.toContain('ask_user');
  });

  it('truncates the workplan to 25 lines and keeps the review lines', () => {
    expect(md).toContain('第 25 行');
    expect(md).not.toContain('第 26 行');
    expect(md).toContain('- ✗ 不以夸奖开头：好问题');
    expect(md).toContain('外部评审：');
    expect(md).toContain('C 判：');
  });
});

describe('renderResultsMarkdown', () => {
  const meta = { stamp: '2026-10-27-01', model: 'deepseek-flash', vault: 'snapshot-v10', workspace: '.scratch/evals/2026-10-27-01' };
  const runs = EVAL_QUESTIONS.flatMap((question) =>
    [1, 2, 3].map((n) => ({
      q: question,
      record: record({ questionId: question.id, run: n, ms: 1000 }),
      checks: (question.id === 2 && n === 3 ? [{ name: '不以夸奖开头', kind: 'rule', pass: false, detail: '好问题' }] : []) as Check[],
    })),
  );
  const md = renderResultsMarkdown(meta, runs);

  it('has the header and one summary row per question', () => {
    expect(md).toContain('## 工作计划对话评测 · 2026-10-27-01');
    expect(md).toContain('模型：deepseek-flash · 数据：snapshot-v10 · Workspace：.scratch/evals/2026-10-27-01');
    expect(md.split('\n').filter((l) => /^\| \d /.test(l))).toHaveLength(5);
  });

  it('counts passes and failed checks', () => {
    expect(md).toContain('| 2 题目含糊 | 2/3 | 不以夸奖开头 ×1 |');
    expect(md).toContain('| 1 题目清楚 | 3/3 | — |');
  });

  it('embeds every run block in id-then-run order', () => {
    expect(md).toContain('### 题 1 · 题目清楚 · 第 1 次');
    expect(md.indexOf('### 题 1 · 题目清楚 · 第 3 次')).toBeLessThan(md.indexOf('### 题 2 · 题目含糊 · 第 1 次'));
    expect(md.indexOf('### 题 5 · 很小的题 · 第 3 次')).toBeGreaterThan(md.indexOf('### 题 4 · 和方针冲突、前提可疑 · 第 3 次'));
  });
});
