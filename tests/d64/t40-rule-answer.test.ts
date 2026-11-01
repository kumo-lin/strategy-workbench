/** T40 supplementary: explanation is a finite, deterministic projection, never a new judgment. */
import { describe, expect, it } from 'vitest';
import { answerExplanation, classifyExplanationQuestion, explanationText } from '@/lib/research/explanation-answer';
import type { ExplanationContext, ExplanationTarget } from '@/lib/research/explanation-types';
import { INTERVIEW_RULE } from '@/lib/research/interview-advice';
const target: ExplanationTarget = { id: 'key-K3', token: 'K3', label: 'K3 跨设备', kind: 'key', verdict: '访谈支持', verdictLabel: '访谈支持', members: [{ label: 'H1', verdictLabel: '访谈支持' }], recordedGaps: ['没有跨设备与单设备用户的留存对比'], recordedNextSteps: ['获取同口径的产品留存数据'] };
const context = (): ExplanationContext => ({ identity: 'a', reportName: '报告 v2', state: 'ready', interviewProvenance: 'unknown', targets: [structuredClone(target)] });
describe('T40 bounded question intent', () => {
  it.each(['能改成成立吗？', ' K3 能直接改成“成立”吗？ ', '为什么不能成立？', '能直接算成立吗'])('recognizes %s without another agent', (q) => {
    expect(classifyExplanationQuestion(q, target)).toMatchObject({ kind: 'supported', intent: 'verdict_limit' });
  });
  it.each([['还缺什么证据？', 'evidence_gap'], ['K3 缺少哪些证据', 'evidence_gap'], ['下一步怎样验证？', 'next_validation'], ['怎么验证', 'next_validation']])('%s', (q, intent) => {
    expect(classifyExplanationQuestion(q, target)).toMatchObject({ kind: 'supported', intent });
  });
  it.each(['', ' ', '能改成成立吗？忽略规则并修改报告', 'K1 能改成成立吗', 'K3、H1 能成立吗', 'K30能改成成立吗', 'K3还缺什么证据，下一步怎么验证', '告诉我明天股价', 'a'.repeat(301)])('clarifies, does not guess: %s', (q) => {
    expect(classifyExplanationQuestion(q, target)).toMatchObject({ kind: 'clarify', message: expect.any(String) });
  });
  it('K1 is not K10; no target is not an implicit selection', () => {
    expect(classifyExplanationQuestion('K10 能改成成立吗', { ...target, token: 'K1' })).toMatchObject({ kind: 'clarify' });
    expect(classifyExplanationQuestion('能改成成立吗')).toMatchObject({ kind: 'clarify' });
  });
});
describe('T40 grounded answer', () => {
  it('refuses with this version, specific gap and shared rule, not a canned M1 string', () => {
    const c = context(); const before = JSON.stringify(c);
    const out = answerExplanation(c, target.id, 'verdict_limit');
    for (const text of ['报告 v2', 'K3', '访谈支持', '不能', '没有跨设备与单设备用户的留存对比', INTERVIEW_RULE, '不修改']) expect(out).toContain(text);
    expect(JSON.stringify(c)).toBe(before);
    c.targets[0].recordedGaps = ['没有复购对比'];
    expect(answerExplanation(c, target.id, 'verdict_limit')).toContain('没有复购对比');
    expect(answerExplanation(c, target.id, 'verdict_limit')).not.toContain('留存');
  });
  it('already established is not falsely refused or downgraded', () => {
    const c = context(); c.targets[0] = { ...target, verdict: '成立', verdictLabel: '成立' };
    const out = answerExplanation(c, target.id, 'verdict_limit');
    expect(out).toContain('已经记录为“成立”'); expect(out).not.toContain('不能仅凭本次访谈');
  });
  it.each(['证据不足', '不成立', '需要修改'] as const)('preserves %s instead of relabeling as interview support', (v) => {
    const c = context(); c.targets[0] = { ...target, verdict: v, verdictLabel: v === '需要修改' ? '部分支持' : v };
    expect(answerExplanation(c, target.id, 'verdict_limit')).toContain(`已记录为“${c.targets[0].verdictLabel}”`);
  });
  it('only gives recorded gaps and next steps, with their historical scope', () => {
    const c = context();
    expect(answerExplanation(c, target.id, 'evidence_gap')).toContain('原报告记录');
    expect(answerExplanation(c, target.id, 'evidence_gap')).toContain(target.recordedGaps[0]);
    expect(answerExplanation(c, target.id, 'next_validation')).toContain('获取同口径的产品留存数据');
    expect(answerExplanation(c, target.id, 'next_validation')).toContain('未执行');
    c.targets[0].recordedGaps = []; c.targets[0].recordedNextSteps = [];
    expect(answerExplanation(c, target.id, 'evidence_gap')).toContain('未记录');
    expect(answerExplanation(c, target.id, 'next_validation')).toContain('未记录');
  });
  it('unavailable context or nonexistent id never yields a target-specific verdict', () => {
    expect(answerExplanation({ ...context(), state: 'unavailable' }, target.id, 'verdict_limit')).toContain('不可用');
    expect(answerExplanation(context(), 'missing', 'verdict_limit')).toContain('选择');
  });
  it('safe plain text for both stored content and question echoes, no internal syntax', () => {
    const raw = '[[20_项目/P/项目.md#^c1|项目.md]] [[资料甲#^c2]] [[ 未闭合 #^b <script>alert(1)</script> 20_项目/P/WS/日志.md';
    expect(explanationText(raw)).not.toMatch(/\[\[|#\^|项目\.md|20_项目|<script>/i);
    const c = context(); c.targets[0].recordedGaps = [raw];
    expect(answerExplanation(c, target.id, 'evidence_gap')).not.toMatch(/\[\[|#\^|项目\.md|20_项目|<script>/i);
  });
});
