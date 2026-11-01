/** 复核 #1: 追加分析页要能回答「这些访谈能改哪些判断」，答案来自已保存的重判记录，不猜、不升「成立」。 */
import { describe, expect, it } from 'vitest';
import { answerExplanation, classifyExplanationQuestion } from '@/lib/research/explanation-answer';
import type { ExplanationContext, ExplanationTarget } from '@/lib/research/explanation-types';
import { INTERVIEW_RULE, explanationChangesOf } from '@/lib/research/interview-advice';

const target: ExplanationTarget = {
  id: 'key-K3', token: 'K3', label: 'K3 跨设备', kind: 'key', verdict: '访谈支持', verdictLabel: '访谈支持',
  members: [{ label: 'H1', verdictLabel: '访谈支持' }], recordedGaps: ['没有跨设备与单设备用户的留存对比'], recordedNextSteps: ['获取同口径的留存数据'],
};

const body = [
  '## 因为追加了访谈，结论变了什么',
  '',
  '| | v1 | v2 |',
  '|---|---|---|',
  '| So what | 旧的一句 | 新的一句 |',
  '| K1 | 证据不足 | 不变（访谈没有涉及） |',
  '| K2 | 证据不足 | 不变（访谈没有涉及） |',
  '| K3 | 证据不足 | 访谈支持 |',
  '| K4 | 需要修改 | 部分支持 |',
  '',
  '- 追加的访谈：[[20_项目/P/访谈-A|访谈 A]]（模拟访谈）',
  '',
].join('\n');

const context = (changes = explanationChangesOf(body)): ExplanationContext => ({
  identity: 'a', reportName: '报告 v2', state: 'ready', interviewProvenance: 'reported_simulated', targets: [structuredClone(target)], changes,
});

describe('#1 追加访谈后能改哪些判断', () => {
  it('reads the change rows from the saved report body, key questions only', () => {
    expect(explanationChangesOf(body)).toEqual([
      { label: 'K1', before: '证据不足', after: '不变（访谈没有涉及）' },
      { label: 'K2', before: '证据不足', after: '不变（访谈没有涉及）' },
      { label: 'K3', before: '证据不足', after: '访谈支持' },
      { label: 'K4', before: '需要修改', after: '部分支持' },
    ]);
    expect(explanationChangesOf('# 报告 v1\n\n没有访谈')).toEqual([]);
  });

  it.each(['这些访谈能改哪些判断？', '这些访谈能改哪些结论', '访谈改变了什么', '哪些判断变了？'])('recognizes the question without a model: %s', (q) => {
    expect(classifyExplanationQuestion(q, target)).toMatchObject({ kind: 'supported', intent: 'what_changed' });
  });

  it('answers with what changed, what stayed, and the rule — never upgrades to 成立', () => {
    const out = answerExplanation(context(), target.id, 'what_changed');
    for (const text of ['K3', '证据不足', '访谈支持', 'K4', '部分支持', 'K1', '访谈没有涉及', INTERVIEW_RULE]) expect(out).toContain(text);
    expect(out).not.toMatch(/改为“成立”|升为“成立”|可以改成“成立”/);
    expect(out).toContain('不修改');
    // K2 is unchanged too, and the change list is read from the record, not invented.
    expect(out).toContain('K2');
  });

  it('a judgment the interviews touched without moving it reads 仍为, not 从 X 变为 X', () => {
    const out = answerExplanation(context(explanationChangesOf(body.replace('| K4 | 需要修改 | 部分支持 |', '| K4 | 部分支持 | 部分支持 |'))), target.id, 'what_changed');
    expect(out).not.toMatch(/从“部分支持”变为“部分支持”/);
    expect(out).toContain('K4 仍为“部分支持”（访谈涉及，判断不变）');
  });

  it('says so plainly when the version recorded no change, instead of manufacturing one', () => {
    const out = answerExplanation(context([]), target.id, 'what_changed');
    expect(out).toContain('没有记录');
    expect(out).not.toContain('访谈支持');
  });

  it('an unavailable version does not answer from memory', () => {
    const out = answerExplanation({ ...context(), state: 'unavailable', targets: [] }, '', 'what_changed');
    expect(out).toContain('不可用');
  });
});
