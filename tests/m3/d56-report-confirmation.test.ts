/** 结论 review flow: the Junior submits a delivered report, the Senior confirms or sends it back (M3 task 07). */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Role } from '@/lib/config/roles';
import { ApprovalDenied } from '@/lib/harness';
import type { Vault } from '@/lib/vault';
import { addComment, decideReview, requestReview, ReviewFlowError } from '@/lib/workplan/review-flow';
import { makeFixtureVault, ROLES } from '../helpers/fixture-vault';

const WS = '20_项目/P/WS-A';
const WS_NOTE = `${WS}/workspace.md`;
const LOG = `${WS}/日志.md`;
const DIR = `${WS}/调查/买方采购逻辑`;
const REPORT_V1 = `${DIR}/报告 v1.md`;
const REPORT_V2 = `${DIR}/报告 v2.md`;
const NON_REPORT = `${DIR}/报告 v3.md`;
const REPORT_MISSING = `${DIR}/报告 v9.md`;
const G1_REVIEW = `${WS}/review/G1 2026-10-25.md`;
const REVIEW = `${WS}/review/结论 2026-10-25.md`;
const NOW = new Date('2026-10-25T09:00:00Z');

let vault: Vault;
let cleanup: () => Promise<void>;

const common = (id: string, type: string, extra: string, author = 'Senior', status = '已确认') =>
  `---\nid: ${id}\ntype: ${type}\nstatus: ${status}\ncreated: "2026-10-24"\nupdated: "2026-10-24"\nauthor: ${author}\nderived_from: ["[[团队]]"]\nrelates_to: ["[[团队]]"]\n${extra}\n---\n`;

const workspace = (stage: string, flags = '[]') =>
  `${common(
    'ws-a',
    'workspace',
    `week: W2
owner: Junior A
reviewer: Senior
stage: ${stage}
flags: ${flags}
depends_on: []`,
  )}\n# WS-A\n`;

const report = (id: string, version: number, delivery: string) =>
  `${common(
    id,
    'report',
    `version: ${version}
research_plan: null
mode: team
exploratory: false
delivery: ${delivery}
failed_checks: []`,
    'AI',
    '进行中',
  )}\n# 报告 v${version}\n`;

beforeEach(async () => {
  ({ vault, cleanup } = await makeFixtureVault({
    [WS_NOTE]: workspace('执行中'),
    [REPORT_V1]: report('report-v1', 1, '已交付'),
    [REPORT_V2]: report('report-v2', 2, '草稿'),
    [NON_REPORT]: `${common('meeting-x', 'meeting', 'date: "2026-10-24"\nattendees: []\nsimulated: false\ndecisions: []', 'AI', '进行中')}\n# 不是报告\n`,
  }));
});
afterEach(async () => cleanup());

const stageOf = async () => (await vault.readTyped(WS_NOTE, 'workspace')).note.stage;

const submit = (actor: Role = ROLES.juniorA, subject = REPORT_V1) =>
  requestReview({ vault, actor, workspacePath: WS, gate: '结论', subject, summary: '见报告', focus: ['Q1 的证据'], now: NOW });

const submitG1 = () =>
  requestReview({ vault, actor: ROLES.juniorA, workspacePath: WS, gate: 'G1', subject: `${WS}/workplan v1.md`, summary: '看拆题', focus: [], now: NOW });

describe('requestReview: 结论 needs a delivered report of this Workspace', () => {
  it('the owner submits a delivered report: review note created, stage to 结论待审, both logged', async () => {
    const { reviewPath } = await submit();
    expect(reviewPath).toBe(REVIEW);
    const review = await vault.readTyped(reviewPath, 'review');
    expect(review.note).toMatchObject({
      gate: '结论',
      result: null,
      requester: 'Junior A',
      reviewer: 'Senior',
      status: '进行中',
      derived_from: [`[[${DIR}/报告 v1|报告 v1]]`],
    });
    expect(review.body).toContain('# 结论 审批 2026-10-25');
    expect(review.body).toContain(`送审：[[${DIR}/报告 v1|报告 v1]]`);
    expect(await stageOf()).toBe('结论待审');
    const rows = await vault.readLog(LOG);
    expect(rows.map((r) => [r.actor, r.action])).toEqual([
      ['Junior A', 'write:review/结论 2026-10-25'],
      ['Junior A', 'event:review.request'],
    ]);
    expect(rows[0]).toMatchObject({ change: '新建 结论 2026-10-25（送审 报告 v1）', reason: '提交给 Senior 审批' });
  });

  it('a draft report is refused, nothing written, stage unchanged', async () => {
    await expect(submit(ROLES.juniorA, REPORT_V2)).rejects.toThrow(/草稿/);
    expect(await vault.exists(REVIEW)).toBe(false);
    expect(await stageOf()).toBe('执行中');
    expect(await vault.readLog(LOG)).toEqual([]);
  });

  it.each([
    ['a path outside this Workspace', '20_项目/P/WS-B/调查/x/报告 v1.md'],
    ['a note that is not a report', NON_REPORT],
    ['a missing file', REPORT_MISSING],
  ])('%s is refused', async (_name, subject) => {
    await expect(submit(ROLES.juniorA, subject)).rejects.toBeInstanceOf(ReviewFlowError);
    expect(await vault.exists(REVIEW)).toBe(false);
    expect(await stageOf()).toBe('执行中');
  });

  it('the stage must be 执行中: the event refuses, no review note is written', async () => {
    await vault.write(WS_NOTE, { frontmatter: { ...(await vault.read(WS_NOTE)).data, stage: '拆题中' }, body: '# WS-A\n' }, { overwrite: true });
    await expect(submit()).rejects.toBeInstanceOf(ApprovalDenied);
    expect(await vault.exists(REVIEW)).toBe(false);
    expect(await stageOf()).toBe('拆题中');
  });

  it('a second 结论 submit is refused while the first is open', async () => {
    await submit();
    await expect(submit()).rejects.toThrow('上一份报告还在等 Senior 确认，确认或打回之后才能再提交。');
  });

  it('an open G1 review does not block a 结论 submit', async () => {
    await submitG1();
    await expect(submit()).resolves.toMatchObject({ reviewPath: REVIEW });
    expect(await stageOf()).toBe('结论待审');
  });
});

describe('decideReview: the Senior confirms or sends the report back', () => {
  it('approve: review 通过, stage 撰写中, the approve event is logged', async () => {
    const { reviewPath } = await submit();
    await addComment({ vault, actor: ROLES.senior, reviewPath, text: 'Q1 的口径确认一下', now: NOW });
    await decideReview({ vault, actor: ROLES.senior, reviewPath, decision: 'approve', now: NOW });
    expect((await vault.readTyped(reviewPath, 'review')).note).toMatchObject({ result: '通过', status: '已确认' });
    expect(await stageOf()).toBe('撰写中');
    const row = (await vault.readLog(LOG)).find((r) => r.action === 'event:review.approve');
    expect(row).toMatchObject({ actor: 'Senior' });
  });

  it('a non-reviewer cannot approve; the review stays open and the stage does not move', async () => {
    const { reviewPath } = await submit();
    await expect(decideReview({ vault, actor: ROLES.juniorA, reviewPath, decision: 'approve' })).rejects.toBeInstanceOf(ApprovalDenied);
    expect(await stageOf()).toBe('结论待审');
    expect((await vault.readTyped(reviewPath, 'review')).note.result).toBeNull();
  });

  it('reject needs a comment; with one: 打回, stage back to 执行中, flag 返工中, the Junior can submit again', async () => {
    const { reviewPath } = await submit();
    await expect(decideReview({ vault, actor: ROLES.senior, reviewPath, decision: 'reject' })).rejects.toThrow(/comment/);
    await addComment({ vault, actor: ROLES.senior, reviewPath, text: 'Q1 的证据不够', now: NOW });
    await decideReview({ vault, actor: ROLES.senior, reviewPath, decision: 'reject', now: NOW });
    const ws = (await vault.readTyped(WS_NOTE, 'workspace')).note;
    expect(ws.stage).toBe('执行中');
    expect(ws.flags).toContain('返工中');
    expect((await vault.readTyped(reviewPath, 'review')).note.result).toBe('打回');
    await expect(submit()).resolves.toMatchObject({ reviewPath: `${WS}/review/结论 2026-10-25 (2).md` });
  });

  it('the G1 path still works', async () => {
    const { reviewPath } = await submitG1();
    expect(reviewPath).toBe(G1_REVIEW);
    expect((await vault.readTyped(reviewPath, 'review')).note).toMatchObject({ gate: 'G1', result: null, requester: 'Junior A', reviewer: 'Senior' });
    expect(await stageOf()).toBe('执行中');
  });
});
