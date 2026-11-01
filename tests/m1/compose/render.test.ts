/** The tree → workplan note renderer (D-61): the note must pass the existing structure checks. */
import { describe, expect, it } from 'vitest';
import { packLink, renderWorkplan } from '@/lib/workplan/compose/render';
import { newState, type ComposeState, type PackItem } from '@/lib/workplan/compose/types';
import { hasQuestionTree, parseWorkplanTree, workplanTreeProblems, workplanTreeWarnings } from '@/lib/workplan/workplan-tree';
import { sampleTree } from './fixtures';

const pack: PackItem[] = [
  { id: 'K1', kind: 'directive', title: '高层周会', path: 'p/会议/高层周会.md', block: '^m1', gist: '重点看 IT 能不能管' },
  { id: 'K2', kind: 'policy', title: '业务方针', path: '00/高层方针/业务方针.md', block: '^p1', gist: '不为 AI 单独加价' },
  { id: 'K3', kind: 'reference', title: '采购调研', path: '10/资料/采购调研.md', block: '^c1', gist: '企业不买溢价 AI PC' },
];
const state: ComposeState = {
  ...newState(),
  frame: { question: '问', decision: '押哪一层', scope: '2026–2027', success: '知道付费条件', known: '资料里还没有现成结论', bar: '一个独立来源就够' },
  pack,
  marks: [
    { ref: 'K1', verdict: '一致', note: '方向一致' },
    { ref: 'K2', verdict: '冲突', note: '方针说不卖给员工', resolution: '按指示' },
  ],
};

function tree() {
  const t = sampleTree();
  const first = t.subquestions[0] as { hypothesis: { known_by: string[]; to_verify: unknown[] } };
  first.hypothesis.known_by = ['K3'];
  first.hypothesis.to_verify = [{ what: '谁拍板', where: 'K3', support: '采购记录里有签字方', counter: '业务线自采的案例' }, { what: '预算科目', where: '上网', support: '公开招标', counter: '创新基金' }];
  t.split_basis = '按决策选项拆，四问合起来够；凭什么是我们交给 W5。';
  return t;
}

describe('renderWorkplan', () => {
  const r = renderWorkplan({ tree: tree(), state, wsCode: 'WS-A', firstHypothesisNumber: 3 });

  it('passes the existing structure checks (sections, tree shape, one linked hypothesis per leaf, MECE section)', () => {
    expect(hasQuestionTree(r.body)).toBe(true);
    expect(workplanTreeProblems(r.body)).toEqual([]);
    expect(workplanTreeWarnings(r.body)).toEqual([]);
  });

  it('numbers the sub-questions in reading order and links each hypothesis note', () => {
    const t = parseWorkplanTree(r.body);
    expect(t.leaves.map((l) => l.qid)).toEqual(['Q1', 'Q2-1', 'Q2-2', 'Q3']);
    expect(t.leaves.every((l) => l.hypothesis?.startsWith('[[WS-A-H'))).toBe(true);
    expect(r.hypotheses.map((h) => h.name)).toEqual(['WS-A-H3 谁拍板的假设', 'WS-A-H4 软件的假设', 'WS-A-H5 硬件的假设', 'WS-A-H6 什么条件批的假设']);
    expect(r.hypotheses.map((h) => h.label)).toEqual(['H1', 'H2-1', 'H2-2', 'H3']);
  });

  it('splits "known" from "to verify" per hypothesis, and says 上网 or reads a pack item', () => {
    expect(r.body).toContain('已经知道的（有资料撑着，不用再查）：');
    expect(r.body).toContain(`- ${packLink(pack[2])}：企业不买溢价 AI PC`);
    expect(r.body).toContain(`去哪里查：读 ${packLink(pack[2])}`);
    expect(r.body).toContain('去哪里查：上网查');
    expect(r.body).toContain('- 参考库里还没有直接撑它的资料'); // the other hypotheses have no known_by
  });

  it('puts directives and policies in the premises with their verdicts, and unrelated ones nowhere', () => {
    expect(r.body).toContain('- 高层指示（一致）：[[高层周会#^m1]]：重点看 IT 能不能管');
    expect(r.body).toContain('**和用户的方向不一致**，处理：按指示');
    const none = renderWorkplan({ tree: tree(), state: { ...state, marks: [{ ref: 'K1', verdict: '无关', note: 'x' }] }, wsCode: 'WS-A', firstHypothesisNumber: 1 });
    expect(none.body).toContain('（资料里没有对这件事的指示或已确认的决定）');
  });

  it('explains how the sub-questions were chosen in the MECE section and lists open evaluation findings under the risks', () => {
    expect(r.body).toContain('怎么选的：先整体判断核心问题、竞争假设和关键的不确定性');
    expect(r.body).toContain('已知的事实和判断：资料里还没有现成结论');
    expect(r.body).toContain('证据要多强才能拍板：一个独立来源就够');
    expect(r.body).toContain('研究资源：内部资料、参考库和上网检索');
    const withIssues = renderWorkplan({ tree: tree(), state, wsCode: 'WS-A', firstHypothesisNumber: 1, openIssues: ['评估提醒：预算由谁批——研究白做'] });
    expect(withIssues.body).toContain('- 评估提醒：预算由谁批——研究白做');
  });

  it('a decision that is only 推断 is flagged as not confirmed', () => {
    const s = { ...state, pack: [{ id: 'K1', kind: 'decision' as const, title: '某决定', path: 'p/决策/某决定.md', gist: 'g', status: '推断' }], marks: [{ ref: 'K1', verdict: '一致' as const, note: 'n' }] };
    expect(renderWorkplan({ tree: tree(), state: s, wsCode: 'WS-A', firstHypothesisNumber: 1 }).body).toContain('状态“推断”，还没确认');
  });
});

describe('risks with an ellipsis', () => {
  it('are dropped whole, and a fixed line stands in when none is left', () => {
    const t = tree();
    const cut = renderWorkplan({ tree: { ...t, risks: ['最可能被推翻：员工自付意愿被低价 Copilot 个人版或免…', '…', '价格可能比管理能力更重要'] }, state, wsCode: 'WS-A', firstHypothesisNumber: 1 });
    const section = (b: string) => b.slice(b.indexOf('## 风险和待确认'), b.indexOf('## next action'));
    expect(section(cut.body)).toContain('- 价格可能比管理能力更重要');
    expect(section(cut.body)).not.toContain('…');
    const none = renderWorkplan({ tree: { ...t, risks: ['…', '……'] }, state, wsCode: 'WS-A', firstHypothesisNumber: 1 });
    expect(section(none.body)).toContain('- 主要风险待你补充');
    expect(section(none.body)).not.toContain('…');
  });
});
