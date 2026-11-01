/** C1: which 结论 review (if any) a delivered report is in, read from the Workspace's review notes. */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Vault } from '@/lib/vault';
import { addComment, decideReview, requestReview } from '@/lib/workplan/review-flow';
import { reportReviewOf } from '@/lib/workplan/report-review';
import { makeFixtureVault, ROLES } from '../helpers/fixture-vault';

const WS = '20_项目/P/WS-A';
const WS_NOTE = `${WS}/workspace.md`;
const DIR = `${WS}/调查/买方采购逻辑`;
const REPORT = `${DIR}/报告 v1.md`;
const OTHER_REPORT = `${WS}/调查/别的调查/报告 v1.md`;
const G1_REVIEW = `${WS}/review/G1 2026-10-25.md`;
const NOW = new Date('2026-10-25T09:00:00Z');

const common = (id: string, type: string, extra: string, author = 'Senior', status = '已确认') =>
  `---\nid: ${id}\ntype: ${type}\nstatus: ${status}\ncreated: "2026-10-24"\nupdated: "2026-10-24"\nauthor: ${author}\nderived_from: ["[[团队]]"]\nrelates_to: ["[[团队]]"]\n${extra}\n---\n`;

const workspace = (stage: string) =>
  `${common(
    'ws-a',
    'workspace',
    `week: W2
owner: Junior A
reviewer: Senior
stage: ${stage}
flags: []
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

let vault: Vault;
let cleanup: () => Promise<void>;
beforeEach(async () => {
  ({ vault, cleanup } = await makeFixtureVault({
    [WS_NOTE]: workspace('执行中'),
    [REPORT]: report('report-v1', 1, '已交付'),
    [OTHER_REPORT]: report('report-other', 1, '已交付'),
  }));
});
afterEach(async () => cleanup());

const submit = (subject = REPORT) =>
  requestReview({ vault, actor: ROLES.juniorA, workspacePath: WS, gate: '结论', subject, summary: '见报告', focus: [], now: NOW });

describe('reportReviewOf', () => {
  it('1: a report with no 结论 review is none', async () => {
    expect(await reportReviewOf(vault, WS, REPORT)).toEqual({ state: 'none', reviewPath: null });
  });

  it('2: a pending request is open', async () => {
    const { reviewPath } = await submit();
    expect(await reportReviewOf(vault, WS, REPORT)).toEqual({ state: 'open', reviewPath });
  });

  it('3: a review sent back is sent_back', async () => {
    const { reviewPath } = await submit();
    await addComment({ vault, actor: ROLES.senior, reviewPath, text: 'Q1 的证据不够', now: NOW });
    await decideReview({ vault, actor: ROLES.senior, reviewPath, decision: 'reject', now: NOW });
    expect(await reportReviewOf(vault, WS, REPORT)).toEqual({ state: 'sent_back', reviewPath });
  });

  it('4: a second request and approval are confirmed, the latest review wins', async () => {
    const first = await submit();
    await addComment({ vault, actor: ROLES.senior, reviewPath: first.reviewPath, text: 'Q1 的证据不够', now: NOW });
    await decideReview({ vault, actor: ROLES.senior, reviewPath: first.reviewPath, decision: 'reject', now: NOW });
    const second = await submit();
    await decideReview({ vault, actor: ROLES.senior, reviewPath: second.reviewPath, decision: 'approve', now: NOW });
    expect(second.reviewPath).not.toBe(first.reviewPath);
    expect(await reportReviewOf(vault, WS, REPORT)).toEqual({ state: 'confirmed', reviewPath: second.reviewPath });
  });

  it('5: a 结论 review of another report does not count', async () => {
    const { reviewPath } = await submit(OTHER_REPORT);
    expect(await reportReviewOf(vault, WS, REPORT)).toEqual({ state: 'none', reviewPath: null });
    expect(await reportReviewOf(vault, WS, OTHER_REPORT)).toEqual({ state: 'open', reviewPath });
  });

  it('6: a G1 review never counts', async () => {
    await vault.write(G1_REVIEW, {
      frontmatter: {
        id: 'g1-review',
        type: 'review',
        status: '已确认',
        created: '2026-10-25',
        updated: '2026-10-25',
        author: 'Senior',
        derived_from: [`[[${DIR}/报告 v1|报告 v1]]`],
        relates_to: [`[[${WS}/workspace|WS-A]]`],
        requester: 'Junior A',
        reviewer: 'Senior',
        result: '通过',
        gate: 'G1',
      },
      body: '# review\n',
    });
    expect(await reportReviewOf(vault, WS, REPORT)).toEqual({ state: 'none', reviewPath: null });
  });
});
