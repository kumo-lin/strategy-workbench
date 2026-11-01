/** D-64 T16: confirmed conclusions (as premises) and the owner's opinions (as direction) reach the research and workplan context. */
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeFixtureVault, ROLES } from '../helpers/fixture-vault';
import { buildToolContext } from '@/lib/harness';
import { renderWorkplanPrompt } from '@/lib/harness/prompts/workplan';
import { loadResearchContext, renderContext } from '@/lib/research/context';
import { gatherWorkplanContext } from '@/lib/workplan/context';
import type { Vault } from '@/lib/vault';

const note = (lines: string, body: string) => `---\n${lines.trim()}\n---\n${body}`;
const common = (id: string, type: string, extra: string, author = 'Senior', status = '已确认') => `
id: ${id}
type: ${type}
status: ${status}
created: "2026-10-27"
updated: "2026-10-28"
author: ${author}
derived_from: ["[[团队]]"]
relates_to: ["[[团队]]"]
${extra}`;
const report = (id: string, extra = '') => common(id, 'report', `version: 2\nresearch_plan: null\nmode: team\nexploratory: false\n${extra}`, 'AI', '推断');
const review = (id: string, derived: string, comment: string) =>
  note(
    common(id, 'review', 'requester: Junior A\nreviewer: Senior\nresult: 通过\ngate: 结论', 'Junior A').replace('derived_from: ["[[团队]]"]', `derived_from: ["${derived}"]`),
    `# r\n\n## Comment\n\n${comment}\n## 审批结果\n`,
  );

const WS_A = '20_项目/P/WS-A';
const B_REPORT = '20_项目/P/WS-B/调查/跨设备/报告 v2.md';
const A_REPORT = '20_项目/P/WS-A/调查/采购/报告 v1.md';
const X_REPORT = '20_项目/Q/WS-X/调查/渠道/报告 v1.md';
const Y_REPORT = '20_项目/Q/WS-X/调查/东南亚/报告 v1.md';

let vault: Vault;
let root: string;
let cleanup: () => Promise<void>;
beforeEach(async () => {
  ({ vault, root, cleanup } = await makeFixtureVault({
    [B_REPORT]: note(report('b-r2'), '# 报告\n\n## Summary\n\n旧段落不该被用到。\n'),
    '20_项目/P/WS-B/review/结论 2026-10-28.md': review('b-rev', `[[${B_REPORT.replace(/\.md$/, '')}]]`, ''),
    '20_项目/P/决策/跨设备决定.md': note(
      common('dec-b', 'decision', `decided_by: Senior\ntrigger: "[[${B_REPORT.replace(/\.md$/, '')}]]"\nreason: 理由\naffects: []`, 'AI'),
      '# 跨设备决定\n\n## 决定\n\n跨设备功能先按用户和场景区分，先验证高频场景。\n',
    ),
    [A_REPORT]: note(report('a-r1', 'human_edits:\n  - { kind: 内容, where: Summary, before: 旧, after: 新, basis: 不要把企业采购算进来 }'), '# 报告\n\n## Summary\n\n采购段落。\n'),
    '20_项目/P/WS-A/review/G1 2026-10-27.md': review('a-g1', `[[${WS_A}/workplan v1]]`, '- （Senior）把跨设备用户价值列为优先验证 ^m1\n'),
    '20_项目/Q/项目.md': note(common('proj-q', 'project', 'owner: Senior\nsponsor: VP\ncore_question: 问题？'), '# Q\n'),
    '20_项目/Q/WS-X/workspace.md': note(common('ws-x', 'workspace', 'owner: Junior B\nreviewer: Senior\nstage: 完成\nflags: []\ndepends_on: []'), '# X\n'),
    [X_REPORT]: note(report('x-r1'), '# 报告\n\n## Summary\n\n渠道的未发布结论。\n'),
    '20_项目/Q/WS-X/review/结论 2026-10-20.md': review('x-rev', `[[${X_REPORT.replace(/\.md$/, '')}]]`, ''),
    [Y_REPORT]: note(report('y-r1', 'published_by: Senior\npublished_at: "2026-10-21"'), '# 报告\n\n## Summary\n\n东南亚中小企业更看重售后。\n\n第二段。\n'),
    '20_项目/Q/WS-X/review/结论 2026-10-21.md': review('y-rev', `[[${Y_REPORT.replace(/\.md$/, '')}]]`, ''),
  }));
  await writeFile(path.join(root, B_REPORT.replace(/\.md$/, '.judgment.json')), JSON.stringify({ report: '报告 v2', keyed: {}, claims: [], summary: { so_what: '高频跨设备用户才会持续使用', results: [], workplan_impact: [] } }));
});
afterEach(async () => cleanup());

const ctxA = () => buildToolContext({ vault, role: ROLES.juniorA, workspacePath: WS_A, track: 'workspace' });

describe('T16 context', () => {
  it('1. research context: 已确认的研究结论 with the So what of the project\'s confirmed reports and their decisions', async () => {
    const text = renderContext(await loadResearchContext(await ctxA()));
    const sec = text.split('## 已确认的研究结论（当作前提）')[1]?.split('\n## ')[0] ?? '';
    expect(sec).toContain('高频跨设备用户才会持续使用');
    expect(sec).toContain('跨设备功能先按用户和场景区分，先验证高频场景。');
    expect(sec).not.toContain('旧段落');
  });

  it('2. research context: 负责人的意见 lists this Workspace\'s review comments and human_edits reasons', async () => {
    const text = renderContext(await loadResearchContext(await ctxA()));
    const sec = text.split('## 负责人的意见（当方向用，不当证据用）')[1]?.split('\n## ')[0] ?? '';
    expect(sec).toContain('把跨设备用户价值列为优先验证');
    expect(sec).toContain('不要把企业采购算进来');
  });

  it("3. another project's unpublished report is left out; a published one is in (its Summary's first paragraph)", async () => {
    const text = renderContext(await loadResearchContext(await ctxA()));
    expect(text).not.toContain('渠道的未发布结论');
    expect(text).toContain('东南亚中小企业更看重售后。');
    expect(text).not.toContain('第二段');
  });

  it('4. the workplan context has both sections too', async () => {
    const prompt = renderWorkplanPrompt(await gatherWorkplanContext(await ctxA()));
    expect(prompt).toContain('## 已确认的研究结论（当作前提）');
    expect(prompt).toContain('高频跨设备用户才会持续使用');
    expect(prompt).toContain('## 负责人的意见（当方向用，不当证据用）');
    expect(prompt).toContain('把跨设备用户价值列为优先验证');
  });
});
