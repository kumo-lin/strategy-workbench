/** D-56 ⑤b: a project's confirmed reports are listed for every Workspace of that project, and for no other project. */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { confirmedReports } from '@/lib/research/confirmed-reports';
import type { Vault } from '@/lib/vault';
import { makeFixtureVault } from '../helpers/fixture-vault';

const P1 = '20_项目/P1';
const P2 = '20_项目/P2';
const WS_A = `${P1}/WS-A`;
const WS_B = `${P1}/WS-B`;
const WS_X = `${P2}/WS-X`;

const INVESTIGATION = '买方采购逻辑（问题树）';
const REPORT_A = `${WS_A}/调查/${INVESTIGATION}/报告 v1.md`;
const REVIEW_A = `${WS_A}/review/结论 2026-10-25.md`;
const REPORT_X = `${WS_X}/调查/买方需求/报告 v1.md`;
const REVIEW_X = `${WS_X}/review/结论 2026-10-26.md`;

const fm = (lines: string) => `---\n${lines.trim()}\n---\n`;

const link = (p: string) => `[[${p.replace(/\.md$/, '')}|${p.split('/').pop()!.replace(/\.md$/, '')}]]`;

const common = (id: string, type: string, extra: string, author = 'Senior', status = '已确认') => `
id: ${id}
type: ${type}
status: ${status}
created: "2026-10-24"
updated: "2026-10-24"
author: ${author}
derived_from: ["[[团队]]"]
relates_to: ["[[团队]]"]
${extra}`;

const projectNote = (id: string) =>
  `${fm(
    common(
      id,
      'project',
      `owner: Senior
sponsor: VP
core_question: 问题？
roadmap: [{ week: W2, topic: 买单 }]
dependencies: []`,
    ),
  )}\n# ${id}\n`;

const workspaceNote = (id: string) =>
  `${fm(
    common(
      id,
      'workspace',
      `week: W2
owner: Junior A
reviewer: Senior
stage: 拆题中
flags: []
depends_on: []`,
      'AI',
      '进行中',
    ),
  )}\n# ${id}\n`;

const reportNote = (id: string) =>
  `${fm(
    common(
      id,
      'report',
      `version: 1
research_plan: null
mode: team
exploratory: false`,
      'AI',
      '进行中',
    ),
  )}\n# 报告\n`;

const workplanNote = (id: string) =>
  `${fm(
    common(
      id,
      'workplan',
      `version: 1
approved_by: null
approved_at: null
changes: []`,
      'Junior A',
      '进行中',
    ),
  )}\n# workplan v1\n`;

function reviewNote(opts: {
  id: string;
  workspacePath: string;
  gate: 'G1' | '结论';
  result: '通过' | '打回' | null;
  subject: string;
  updated?: string;
  reviewer?: string;
  status?: string;
}) {
  return `${fm(`
id: ${opts.id}
type: review
status: ${opts.status ?? '已确认'}
created: "2026-10-24"
updated: "${opts.updated ?? '2026-10-24'}"
author: Senior
derived_from: ["${link(opts.subject)}"]
relates_to: ["${link(`${opts.workspacePath}/workspace.md`)}"]
requester: Junior A
reviewer: ${opts.reviewer ?? 'Senior'}
result: ${opts.result === null ? 'null' : opts.result}
gate: ${opts.gate}
`)}\n# review\n`;
}

function baseFiles(): Record<string, string> {
  return {
    [`${P1}/项目.md`]: projectNote('p1'),
    [`${P2}/项目.md`]: projectNote('p2'),
    [`${WS_A}/workspace.md`]: workspaceNote('p1-ws-a'),
    [`${WS_B}/workspace.md`]: workspaceNote('p1-ws-b'),
    [`${WS_X}/workspace.md`]: workspaceNote('p2-ws-x'),
    [REPORT_A]: reportNote('p1-report-a'),
    [REVIEW_A]: reviewNote({
      id: 'p1-ws-a-conclusion',
      workspacePath: WS_A,
      gate: '结论',
      result: '通过',
      subject: REPORT_A,
      updated: '2026-10-25T09:00:00Z',
      reviewer: 'Senior A',
    }),
    [REPORT_X]: reportNote('p2-report-x'),
    [REVIEW_X]: reviewNote({
      id: 'p2-ws-x-conclusion',
      workspacePath: WS_X,
      gate: '结论',
      result: '通过',
      subject: REPORT_X,
      updated: '2026-10-26T09:00:00Z',
      reviewer: 'Senior X',
    }),
  };
}

const makeVault = (extra: Record<string, string> = {}) => makeFixtureVault({ ...baseFiles(), ...extra });

let vault: Vault;
let cleanup: () => Promise<void>;
beforeEach(async () => {
  ({ vault, cleanup } = await makeVault());
});
afterEach(async () => cleanup());

describe('D-56 ⑤b: confirmedReports', () => {
  it('1: a report confirmed in WS-A is listed from WS-B as not own, and from WS-A as own', async () => {
    const expected = {
      reportPath: REPORT_A,
      reportName: '报告 v1',
      investigation: INVESTIGATION,
      workspace: 'WS-A',
      reviewPath: REVIEW_A,
      confirmedBy: 'Senior A',
      confirmedAt: '2026-10-25T09:00:00Z',
      own: false,
    };
    expect(await confirmedReports(vault, WS_B)).toEqual([expected]);
    expect(await confirmedReports(vault, WS_A)).toEqual([{ ...expected, own: true }]);
  });

  it('2: a project lists only its own confirmed reports', async () => {
    const p1 = await confirmedReports(vault, WS_A);
    const p2 = await confirmedReports(vault, WS_X);
    expect(p1.map((r) => r.reportPath)).toEqual([REPORT_A]);
    expect(p2.map((r) => r.reportPath)).toEqual([REPORT_X]);
  });

  it('3: a pending, a 打回 and a G1 review are not confirmations', async () => {
    const report = `${WS_A}/调查/调查乙/报告 v2.md`;
    const { vault: v2, cleanup: c2 } = await makeVault({
      [report]: reportNote('p1-report-b'),
      [`${WS_A}/review/结论 2026-10-27.md`]: reviewNote({
        id: 'pending',
        workspacePath: WS_A,
        gate: '结论',
        result: null,
        subject: report,
        updated: '2026-10-27T09:00:00Z',
        status: '进行中',
      }),
      [`${WS_A}/review/结论 2026-10-27 (2).md`]: reviewNote({
        id: 'rejected',
        workspacePath: WS_A,
        gate: '结论',
        result: '打回',
        subject: report,
        updated: '2026-10-27T10:00:00Z',
      }),
      [`${WS_A}/review/G1 2026-10-27.md`]: reviewNote({
        id: 'g1',
        workspacePath: WS_A,
        gate: 'G1',
        result: '通过',
        subject: report,
        updated: '2026-10-27T11:00:00Z',
      }),
    });
    try {
      expect((await confirmedReports(v2, WS_A)).map((r) => r.reportPath)).toEqual([REPORT_A]);
    } finally {
      await c2();
    }
  });

  it('4: a conclusion review resolving to another project or to a workplan is ignored', async () => {
    const workplan = `${WS_A}/workplan v1.md`;
    const { vault: v2, cleanup: c2 } = await makeVault({
      [workplan]: workplanNote('p1-ws-a-wp'),
      [`${WS_A}/review/结论 2026-10-27.md`]: reviewNote({
        id: 'other-project',
        workspacePath: WS_A,
        gate: '结论',
        result: '通过',
        subject: REPORT_X,
        updated: '2026-10-27T09:00:00Z',
      }),
      [`${WS_A}/review/结论 2026-10-27 (2).md`]: reviewNote({
        id: 'workplan',
        workspacePath: WS_A,
        gate: '结论',
        result: '通过',
        subject: workplan,
        updated: '2026-10-27T10:00:00Z',
      }),
    });
    try {
      expect((await confirmedReports(v2, WS_A)).map((r) => r.reportPath)).toEqual([REPORT_A]);
    } finally {
      await c2();
    }
  });

  it('5: the same report confirmed twice is listed once, with the later confirmation', async () => {
    const later = `${WS_A}/review/结论 2026-10-28.md`;
    const { vault: v2, cleanup: c2 } = await makeVault({
      [later]: reviewNote({
        id: 'confirmed-again',
        workspacePath: WS_A,
        gate: '结论',
        result: '通过',
        subject: REPORT_A,
        updated: '2026-10-28T09:00:00Z',
        reviewer: 'Senior B',
      }),
    });
    try {
      const list = (await confirmedReports(v2, WS_A)).filter((r) => r.reportPath === REPORT_A);
      expect(list).toHaveLength(1);
      expect(list[0]).toMatchObject({ reviewPath: later, confirmedBy: 'Senior B', confirmedAt: '2026-10-28T09:00:00Z' });
    } finally {
      await c2();
    }
  });

  it('6: newer confirmations come first', async () => {
    const reportB = `${WS_B}/调查/买方决策链/报告 v1.md`;
    const reviewB = `${WS_B}/review/结论 2026-10-29.md`;
    const { vault: v2, cleanup: c2 } = await makeVault({
      [reportB]: reportNote('p1-report-b'),
      [reviewB]: reviewNote({
        id: 'ws-b-conclusion',
        workspacePath: WS_B,
        gate: '结论',
        result: '通过',
        subject: reportB,
        updated: '2026-10-29T09:00:00Z',
        reviewer: 'Senior C',
      }),
    });
    try {
      const list = await confirmedReports(v2, WS_A);
      expect(list.map((r) => r.reportPath)).toEqual([reportB, REPORT_A]);
      expect(list.map((r) => r.own)).toEqual([false, true]);
    } finally {
      await c2();
    }
  });
});
