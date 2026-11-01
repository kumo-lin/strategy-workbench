/** T40 supplementary UI: real question controls, explicit read-only scope, original upload and submit remain. */
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ReanalysisPanel } from '@/components/research/interview-steps';
import type { ExplanationContext } from '@/lib/research/explanation-types';
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh() {} }) }));
const c: ExplanationContext = { state: 'ready', identity: 'v2', reportName: '报告 v2', interviewProvenance: 'reported_simulated', targets: [{ id: 'key-K3', token: 'K3', label: 'K3 跨设备', kind: 'key', verdict: '访谈支持', verdictLabel: '访谈支持', members: [{ label: 'H1', verdictLabel: '访谈支持' }], recordedGaps: ['没有留存对比'], recordedNextSteps: ['产品数据'] }] };
const base = { workspacePath: '20_项目/P/WS-A', researchDir: '20_项目/P/WS-A/调查/R1', reportName: '报告 v2', changes: [['K3', '证据不足', '访谈支持']], submitSlot: createElement('button', { 'data-testid': 'submit-report' }, '报告没问题，提交给 Senior →') };
const html = (context: ExplanationContext | null, canUpload = true) => renderToString(createElement(ReanalysisPanel, { ...base, canUpload, explanationContext: context })).replace(/<!-- -->/g, '');
describe('T40 rules discussion UI', () => {
  it('ready: question input, target, explicit send and fill-only prompts; no prewritten answer', () => {
    const out = html(c);
    for (const id of ['rule-explanation', 'explanation-target', 'explanation-question', 'explanation-send', 'explanation-version', 'upload-interview', 'change-table', 'submit-report']) expect(out).toContain(`data-testid="${id}"`);
    for (const text of ['和 AI 讨论 · 追加分析', '按已保存的记录解释 · 只读', '解释不修改报告或判断，刷新后不保留', '本版追加访谈均标记为模拟', '还缺什么证据？', '下一步怎样验证？', '访谈改变了什么？']) expect(out).toContain(text);
    expect(out).not.toContain('data-testid="explanation-answer"');
    expect(out).not.toMatch(/\[\[|#\^|项目\.md/);
  });
  it('a reader without upload permission still gets the same explanation controls', () => {
    const out = html(c, false);
    expect(out).toContain('data-testid="explanation-question"');
    expect(out).not.toContain('data-testid="upload-interview"');
  });
  it.each(['missing', 'invalid', 'legacy', 'updating'] as const)('%s: disclose unavailable data, never fake a specific answer', (reason) => {
    const out = html({ ...c, state: 'unavailable', unavailableReason: reason, targets: [] });
    expect(out).toContain(reason === 'updating' ? '报告更新中' : '解释数据不可用');
    expect(out).not.toContain('data-testid="explanation-send"');
    expect(out).toContain('访谈最多把判断提到');
    expect(out).toContain('data-testid="change-table"');
  });
  it('legacy callers without a snapshot do not crash or claim to explain a target', () => {
    expect(html(null)).toContain('解释数据不可用');
    expect(html(null)).not.toContain('data-testid="explanation-target"');
  });
});
