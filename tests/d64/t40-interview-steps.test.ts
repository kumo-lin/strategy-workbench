/** D-64 T40 (ui-4c, ui-4d): the interview advice as its own step, and the follow-up page with v2 and its change table. */
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { InterviewAdvicePanel, ReanalysisPanel } from '@/components/research/interview-steps';
import { changeTableOf, interviewAdviceOf, interviewOutline, INTERVIEW_RULE } from '@/lib/research/interview-advice';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh() {} }) }));
const html = (el: Parameters<typeof renderToString>[0]) => renderToString(el).replace(/<!-- -->/g, '');

const V1 = [
  '# M1 调查报告 v1',
  '## So what',
  '用的人多，天天用的人少',
  '## 缺乏信息、需要另外验证的问题',
  '| 问题 | 公开资料缺什么 | 怎么验证 |',
  '|---|---|---|',
  '| K3 跨设备是否解决重复出现的真实问题？ | 没有留存对比 | 产品数据 |',
  '## 附录：过程和证据',
  '## 访谈建议',
  '- 找谁 · 问什么（AI 提议，约不约、问不问由人定）：',
  '',
  '| 找谁 | 问什么 | 对应 |',
  '|---|---|---|',
  '| Qira 产品分析负责人 | 跨设备用户的 30 天留存是多少？[^3] | H1 |',
  '| 目标用户本人（按视角推荐） | 哪些事在电脑上开始、在手机上接着做？ | H2 |',
].join('\n');
const V2 = `${V1.replace('调查报告 v1', '调查报告 v2')}\n## 因为追加了访谈，结论变了什么\n\n| | v1 | v2 |\n|---|---|---|\n| So what | 用的人多 | 验证范围收窄 |\n| K3 | 证据不足 | 访谈支持 |\n`;

describe('T40 the interview advice', () => {
  it('reads the gaps and the asks from the report, each ask tied to its hypothesis', () => {
    const a = interviewAdviceOf(V1, { H1: '跨设备连续体验有持续增量', H2: '没有独立增量' });
    expect(a.gaps).toEqual([{ question: 'K3 跨设备是否解决重复出现的真实问题？', missing: '没有留存对比', how: '产品数据' }]);
    expect(a.rows).toEqual([
      { who: 'Qira 产品分析负责人', question: '跨设备用户的 30 天留存是多少？', verify: 'H1 跨设备连续体验有持续增量' },
      { who: '目标用户本人', question: '哪些事在电脑上开始、在手机上接着做？', verify: 'H2 没有独立增量' },
    ]);
    expect(a.rule).toBe(INTERVIEW_RULE);
    expect(interviewOutline(a, 'M1')).toContain('1. 找Qira 产品分析负责人：跨设备用户的 30 天留存是多少？（为了验证 H1 跨设备连续体验有持续增量）');
  });

  it('ui-4c: every text and testid', () => {
    const out = html(createElement(InterviewAdvicePanel, { advice: interviewAdviceOf(V1, { H1: 'x' }), title: 'M1', onNext: () => {} }));
    for (const t of ['访谈建议 · 公开资料证明不了的地方', '导出访谈提纲', '找谁', '问什么', '为了验证什么', '验证规则（执行前约定）', '访谈做完了，去追加分析 →']) expect(out, t).toContain(t);
    for (const id of ['interview-table', 'interview-row', 'interview-rule', 'export-outline']) expect(out).toContain(`data-testid="${id}"`);
    expect(out.match(/data-testid="interview-row"/g)).toHaveLength(2);
  });

  it('groups the asks by person, in the order the people first appear', () => {
    const a = interviewAdviceOf(V1, { H1: 'x', H2: 'y' });
    expect(a.groups).toEqual([
      { who: 'Qira 产品分析负责人', rows: [{ who: 'Qira 产品分析负责人', question: '跨设备用户的 30 天留存是多少？', verify: 'H1 x' }] },
      { who: '目标用户本人', rows: [{ who: '目标用户本人', question: '哪些事在电脑上开始、在手机上接着做？', verify: 'H2 y' }] },
    ]);
    expect(a.groups.flatMap((g) => g.rows)).toEqual(a.rows);
    expect(interviewAdviceOf(V1).groups).toHaveLength(2);
    expect(interviewAdviceOf('## 访谈建议\n\n| 找谁 | 问什么 | 对应 |\n|---|---|---|\n').groups).toEqual([]);
  });

  it('merges the same person even when their asks are not next to each other', () => {
    const MIX = ['## 访谈建议', '', '| 找谁 | 问什么 | 对应 |', '|---|---|---|', '| A | q1 | H1 |', '| B | q2 | H2 |', '| A | q3 | H3 |'].join('\n');
    const groups = interviewAdviceOf(MIX).groups;
    expect(groups.map((g) => g.who)).toEqual(['A', 'B']);
    expect(groups.map((g) => g.rows.map((r) => r.question))).toEqual([['q1', 'q3'], ['q2']]);
  });

  it('ui-4c: one 找谁 cell per person (rowspan), every ask still its own row', () => {
    const TWO = ['## 访谈建议', '', '| 找谁 | 问什么 | 对应 |', '|---|---|---|', '| A 产品分析负责人 | q1 | H1 |', '| A 产品分析负责人 | q2 | H2 |', '| B 多设备用户 | q3 | H3 |'].join('\n');
    const out = html(createElement(InterviewAdvicePanel, { advice: interviewAdviceOf(TWO), title: 'M1', onNext: () => {} }));
    expect(out.match(/data-testid="interview-row"/g)).toHaveLength(3);
    expect(out.match(/rowspan="2"/gi)).toHaveLength(1);
    expect(out.match(/A 产品分析负责人/g)).toHaveLength(1);
    expect(out.match(/B 多设备用户/g)).toHaveLength(1);
  });
});

describe('T40 the follow-up page', () => {
  it('the change table of v2', () => {
    expect(changeTableOf(V1)).toBeNull();
    expect(changeTableOf(V2)).toEqual([
      ['So what', '用的人多', '验证范围收窄'],
      ['K3', '证据不足', '访谈支持'],
    ]);
  });

  it('ui-4d: every text and testid, the submit slot under the change table', () => {
    const out = html(createElement(ReanalysisPanel, { workspacePath: '20_项目/P/WS-A', researchDir: '20_项目/P/WS-A/调查/R1', canUpload: true, reportName: '报告 v2', changes: changeTableOf(V2), submitSlot: createElement('button', { 'data-testid': 'submit-report' }, '报告没问题，提交给 Senior →') }));
    for (const t of ['和 AI 讨论 · 追加分析', '报告 v2', '因为追加了访谈，结论变了什么', '报告没问题，提交给 Senior →']) expect(out, t).toContain(t);
    for (const id of ['upload-interview', 'change-table', 'submit-report']) expect(out).toContain(`data-testid="${id}"`);
  });
});
