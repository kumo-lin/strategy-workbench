/** D-64 T15: the files tab in five groups — outputs, background, company, public, assets (ui-3, ui-5). */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeFixtureVault } from '../helpers/fixture-vault';
import { loadFiles } from '@/lib/workplan/files-view';
import type { Vault } from '@/lib/vault';

const note = (lines: string, body = '') => `---\n${lines.trim()}\n---\n# x\n${body}`;
const common = (id: string, type: string, extra: string, author = 'Senior', status = '已确认', updated = '2026-10-28') => `
id: ${id}
type: ${type}
status: ${status}
created: "2026-10-27"
updated: "${updated}"
author: ${author}
derived_from: ["[[团队]]"]
relates_to: ["[[团队]]"]
${extra}`;

const ws = (id: string, item: string) => note(common(id, 'workspace', `item: ${item}\nowner: Junior A\nreviewer: Senior\nstage: 拆题中\nflags: []\ndepends_on: []`, 'AI', '进行中'));
const source = (id: string, origin: string, extra = '') =>
  note(common(id, 'source', `url: "https://example.com/${id}"\npublisher: 示例\npublished: "2026-05-01"\nretrieved: "2026-10-27"\norigin: ${origin}\ngrade: B\ngraded_by: AI\nauthority: 3\nlink_checked: true\n${extra}`, 'AI', '推断'));
const report = (id: string, extra = '') => note(common(id, 'report', `version: 2\nresearch_plan: null\nmode: team\nexploratory: false\n${extra}`, 'AI', '推断'));
const decision = (id: string, status: string, extra = '') =>
  note(common(id, 'decision', `decided_by: ${status === '已确认' ? 'Senior' : 'null'}\ntrigger: "[[团队]]"\nreason: 理由\naffects: []\n${extra}`, 'AI', status));
const review = (id: string, gate: string, derived: string, comment = '') =>
  `---\n${common(id, 'review', `requester: Junior A\nreviewer: Senior\nresult: 通过\ngate: ${gate}`, 'Junior A').trim().replace('derived_from: ["[[团队]]"]', `derived_from: ["${derived}"]`)}\n---\n# r\n\n## Comment\n\n${comment}\n## 审批结果\n`;

const P = '20_项目/个人AI战略';
const M1 = `${P}/M1 用户持续使用`;
const L2 = `${P}/L2 凭什么赢`;
const OTHER = '20_项目/商用PC换机';

let vault: Vault;
let cleanup: () => Promise<void>;
beforeEach(async () => {
  ({ vault, cleanup } = await makeFixtureVault({
    [`${M1}/workspace.md`]: ws('ws-m1', 'M1'),
    [`${L2}/workspace.md`]: ws('ws-l2', 'L2'),
    [`${M1}/调查/K3 跨设备/报告 v2.md`]: report('m1-r2'),
    [`${M1}/review/结论 2026-10-28.md`]: review('m1-rev', '结论', `[[${M1}/调查/K3 跨设备/报告 v2]]`),
    [`${M1}/review/G1 2026-10-27.md`]: review('m1-g1', 'G1', `[[${M1}/workplan v1]]`, '- 把跨设备用户价值列为优先验证 ^m1\n'),
    [`${P}/决策/M1 决定-先验证高频场景.md`]: decision('m1-dec', '已确认'),
    [`${P}/决策/M1 草稿.md`]: decision('m1-draft', '推断'),
    [`${P}/访谈/重度用户.md`]: note(common('iv-1', 'meeting', 'date: "2026-10-28"\nattendees: [分析师甲]\nsimulated: true\ndecisions: []\nkind: 访谈', 'Junior A')),
    [`${P}/决策契约.md`]: note(common('contract', 'contract', 'question: q\ndecision: d\ndecision_owner: o\nhorizon: h\ngeography: g\nproduct_scope: p\nout_of_scope: []\nsuccess: s\nknown: []\nbar: b\napproved_by: Senior\napproved_at: "2026-10-27"')),
    [`${P}/会议/2027 方向会（模拟）.md`]: note(common('mt-1', 'meeting', 'date: "2026-10-20"\nattendees: [Senior]\nsimulated: true\ndecisions: []')),
    '10_资料库/Pew 2026.md': source('pew', '预置'),
    '10_资料库/Gartner 2026-05.md': source('gartner', '网络', `fetched_in: "${M1}/调查/K3 跨设备"`),
    [`${OTHER}/项目.md`]: note(common('proj-o', 'project', 'owner: Senior\nsponsor: VP\ncore_question: 问题？')),
    [`${OTHER}/决策/换机决定.md`]: decision('o-dec', '已确认'),
    [`${OTHER}/决策/已发布决定.md`]: decision('o-pub', '已确认', 'published_by: Senior\npublished_at: "2026-10-26"'),
  }));
});
afterEach(async () => cleanup());

const paths = (xs: { path: string }[]) => xs.map((x) => x.path);

describe('T15 loadFiles in five groups', () => {
  it('outputs: the project\'s confirmed report, decision and interview, with who confirmed and when', async () => {
    const f = await loadFiles(vault, L2, '/x');
    expect(paths(f.outputs).sort()).toEqual([`${M1}/调查/K3 跨设备/报告 v2.md`, `${P}/决策/M1 决定-先验证高频场景.md`, `${P}/访谈/重度用户.md`].sort());
    const dec = f.outputs.find((o) => o.kind === '决定')!;
    expect(dec).toMatchObject({ confirmedBy: 'Senior', confirmedAt: '2026-10-28' });
    expect(dec.subtitle).toContain('Senior 确认 2026-10-28');
    expect(f.outputs.find((o) => o.kind === '报告')!.subtitle).toContain('来自 M1');
    expect(f.outputs.map((o) => o.kind).sort()).toEqual(['决定', '报告', '访谈'].sort());
  });

  it('background: the contract, the minutes, the reasons for changes', async () => {
    const f = await loadFiles(vault, L2, '/x');
    expect(f.background.map((b) => b.kind)).toEqual(['契约', '纪要', '理由']);
    expect(f.background[0].subtitle).toBe('Senior 确认 2026-10-27');
    expect(f.background[1].subtitle).toBe('当方向用，不当证据用');
    expect(f.background[2].name).toContain('把跨设备用户价值列为优先验证');
    // 复核 P1: the contract and the reasons for changes are the frame of the task, always read: no tick box that cannot work
    expect(f.background.map((b) => Boolean(b.fixed))).toEqual([true, false, true]);
  });

  it('company: preset sources; public: web sources, with the investigation that fetched them', async () => {
    const f = await loadFiles(vault, L2, '/x');
    expect(paths(f.company)).toEqual(['10_资料库/Pew 2026.md']);
    expect(paths(f.public).sort()).toEqual(['10_资料库/Gartner 2026-05.md', '10_资料库/资料甲.md'].sort());
    expect(f.public.find((x) => x.name === 'Gartner 2026-05')!.subtitle).toBe('M1 调查时获取');
  });

  it('assets: published reports and decisions of every project; another project\'s unpublished outputs never show', async () => {
    const f = await loadFiles(vault, L2, '/x');
    expect(paths(f.assets)).toEqual([`${OTHER}/决策/已发布决定.md`]);
    const all = [...f.outputs, ...f.background, ...f.company, ...f.public].map((x) => x.path);
    expect(all).not.toContain(`${OTHER}/决策/换机决定.md`);
    expect(all).not.toContain(`${OTHER}/决策/已发布决定.md`);
  });
});
