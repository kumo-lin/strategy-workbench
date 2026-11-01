/** The workplan chat rule judges decide the same way every time; the five eval questions are fixed text. */
import { describe, expect, it } from 'vitest';
import { allChatChecks, atMostOneQuestion, doubtMarker, internalNames, looksUpBeforeAsking, noCapabilityList, noFalseDone, noFlatteryOpening, noMarkdown, referencesTitle, shortEnough, summarizeRun } from '../../evals/workplan-judges';
import { EVAL_QUESTIONS } from '../../evals/workplan-questions';

describe('① no internal names', () => {
  it('passes a chat answer that names the note by title only', () => {
    expect(internalNames('我看了《2026-10-16 高层周会》。').pass).toBe(true);
  });
  it('fails on a file name, a wiki link, a vault path and a tool name', () => {
    const md = internalNames('我读了项目.md');
    expect(md.pass).toBe(false);
    expect(md.detail).toContain('.md');
    expect(internalNames('用 vault_search 查了一下').pass).toBe(false);
    expect(internalNames('见 [[WS-A-H1 x]]').pass).toBe(false);
    expect(internalNames('在 20_项目/个人AI战略/会议/ 里').pass).toBe(false);
    expect(internalNames('我调了 ask_user').pass).toBe(false);
    expect(internalNames('引用块是 #^m1').pass).toBe(false);
    expect(internalNames('我调用了 frame_topic').pass).toBe(false);
    expect(internalNames('我调用了 compose_workplan').pass).toBe(false);
  });
});

describe('② no markdown', () => {
  it('passes plain chat text, including a dash inside a line', () => {
    expect(noMarkdown('先说结论。\n再问一个问题？').pass).toBe(true);
    expect(noMarkdown('只有一句话，里面有 - 号 的情况').pass).toBe(true);
  });
  it('fails on headings, lists, bold, code fences and table separators', () => {
    expect(noMarkdown('## 标题\n正文').pass).toBe(false);
    expect(noMarkdown('这是**重点**').pass).toBe(false);
    expect(noMarkdown('1. 第一\n2. 第二').pass).toBe(false);
    expect(noMarkdown('- 第一\n- 第二').pass).toBe(false);
    expect(noMarkdown('```\nx\n```').pass).toBe(false);
    expect(noMarkdown('| a | b |\n|---| --- |').pass).toBe(false);
  });
});

describe('③ short enough', () => {
  it('passes at exactly 80 characters and fails at 81', () => {
    expect(shortEnough('字'.repeat(80)).pass).toBe(true);
    expect(shortEnough('字'.repeat(80)).detail).toBe('80 字');
    expect(shortEnough('字'.repeat(81)).pass).toBe(false);
    expect(shortEnough('字'.repeat(81)).detail).toBe('81 字');
  });
});

describe('③ length is scored per run, not per piece', () => {
  it('returns six checks and none of them is a length check', () => {
    const checks = allChatChecks('x');
    expect(checks).toHaveLength(6);
    expect(checks.map((c) => c.name)).not.toContain('正文不超过 80 字');
  });
});

describe('④ at most one question', () => {
  it('counts half-width and full-width question marks', () => {
    expect(atMostOneQuestion('你要判断什么？').pass).toBe(true);
    expect(atMostOneQuestion('你要判断什么？').detail).toBe('1 个');
    expect(atMostOneQuestion('谁买？谁用？').pass).toBe(false);
    expect(atMostOneQuestion('谁买?谁用?').pass).toBe(false);
    expect(atMostOneQuestion('没有问句。').pass).toBe(true);
  });
});

describe('⑤ no flattery opening', () => {
  it('fails only when the trimmed text starts with a compliment', () => {
    expect(noFlatteryOpening('好问题。我们先看对象。').pass).toBe(false);
    expect(noFlatteryOpening('  你说得对。').pass).toBe(false);
    expect(noFlatteryOpening('这个判断要先看对象。好问题也许。').pass).toBe(true);
  });
});

describe('⑥ no capability list', () => {
  it('fails on an offer to do things', () => {
    expect(noCapabilityList('我可以帮你查资料、起草、提交。').pass).toBe(false);
    expect(noCapabilityList('我的能力包括这些。').pass).toBe(false);
    expect(noCapabilityList('接下来先查采购口径。').pass).toBe(true);
  });
});

describe('⑦ no false done', () => {
  it('fails when the chat announces a submit or an approval', () => {
    expect(noFalseDone('已提交给 Senior 了。').pass).toBe(false);
    expect(noFalseDone('已经批准。').pass).toBe(false);
    expect(noFalseDone('我写好了草稿，等你在页面上点提交。').pass).toBe(true);
  });
});

describe('⑧ looks up before asking', () => {
  it('needs a lookup before the first ask_user or write_draft', () => {
    expect(looksUpBeforeAsking([{ tool: 'vault_search' }, { tool: 'ask_user' }]).pass).toBe(true);
    expect(looksUpBeforeAsking([{ tool: 'ask_user' }]).pass).toBe(false);
    expect(looksUpBeforeAsking([{ tool: 'ask_user' }, { tool: 'vault_read' }]).pass).toBe(false);
    expect(looksUpBeforeAsking([]).pass).toBe(false);
  });
  it('passes a turn with no question when it did look something up', () => {
    expect(looksUpBeforeAsking([{ tool: 'vault_list' }]).pass).toBe(true);
    expect(looksUpBeforeAsking([{ tool: 'web_search' }]).pass).toBe(false);
    expect(looksUpBeforeAsking([{ tool: 'vault_search' }, { tool: 'ask_user' }]).detail).toBe('vault_search → ask_user');
  });
  it('counts frame_topic as the lookup and compose_workplan as the ask', () => {
    expect(looksUpBeforeAsking([{ tool: 'frame_topic' }, { tool: 'ask_user' }]).pass).toBe(true);
    expect(looksUpBeforeAsking([{ tool: 'ask_user' }, { tool: 'compose_workplan' }]).pass).toBe(false);
  });
});

describe('⑨ references a title', () => {
  it('needs the title fragment and the title brackets', () => {
    expect(referencesTitle('《2026-10-16 高层周会（模拟）》里说要看 IT', '高层周会').pass).toBe(true);
    expect(referencesTitle('2026-10-16 高层周会（模拟）里说要看 IT', '高层周会').pass).toBe(false);
    expect(referencesTitle('《2026-10-16 高层周会（模拟）》', '高层周会')).toMatchObject({ detail: '高层周会' });
  });
  it('accepts several fragments and reports the first one found', () => {
    expect(referencesTitle('《W1决定-员工个人AI》里说', ['高层周会', 'W1决定'])).toMatchObject({ pass: true, detail: 'W1决定' });
    expect(referencesTitle('W1决定里说', ['高层周会', 'W1决定']).pass).toBe(false);
    expect(referencesTitle('没提到任何资料', ['高层周会', 'W1决定']).detail).toBe('missing');
  });
});

describe('⑩ doubt marker', () => {
  it('passes on a stated doubt and fails on a plain answer', () => {
    expect(doubtMarker('这个前提没有证据。').pass).toBe(true);
    expect(doubtMarker('这个前提没有证据。').detail).toBe('没有证据');
    expect(doubtMarker('按你说的拆。').pass).toBe(false);
    expect(doubtMarker('按你说的拆。').detail).toBe('无');
  });
  it('recognises a settled decision and a collision', () => {
    expect(doubtMarker('这件事已经定了，你想换主线').pass).toBe(true);
    expect(doubtMarker('好的，我来拆').pass).toBe(false);
  });
});

describe('allChatChecks and summarizeRun', () => {
  it('runs the six per-piece checks in order and summarises only which failed', () => {
    const checks = allChatChecks('先说结论。接下来先查采购口径，再问一个问题？');
    expect(checks.map((c) => c.name)).toEqual(['对话里没有内部文件名、路径、工具名', '对话里没有 markdown', '正文里最多一个问句', '不以夸奖开头', '不列能力清单', '不替用户宣布提交或批准']);
    expect(checks.every((c) => c.kind === 'rule')).toBe(true);
    expect(summarizeRun(checks)).toEqual({ pass: true, failed: [] });
    expect(summarizeRun(allChatChecks('好问题。先说结论。'))).toEqual({ pass: false, failed: ['不以夸奖开头'] });
  });
});

describe('the five eval questions', () => {
  it('are ids 1..5, unique, non-empty text', () => {
    expect(EVAL_QUESTIONS.map((q) => q.id)).toEqual([1, 2, 3, 4, 5]);
    expect(new Set(EVAL_QUESTIONS.map((q) => q.id)).size).toBe(5);
    expect(EVAL_QUESTIONS.every((q) => q.text.trim().length > 0)).toBe(true);
    expect(EVAL_QUESTIONS.every((q) => q.title.trim().length > 0 && q.expectation.trim().length > 0)).toBe(true);
    expect(EVAL_QUESTIONS.every((q) => Number.isInteger(q.maxAsks) && q.maxAsks > 0)).toBe(true);
  });
  it("question 4's pickLabel picks a 'keep going' option, not the confirm option", () => {
    const pick = EVAL_QUESTIONS.find((q) => q.id === 4)?.answer.pickLabel;
    expect(pick?.test('先判断值不值得做')).toBe(true);
    expect(pick?.test('就按这个拆')).toBe(false);
  });
});
