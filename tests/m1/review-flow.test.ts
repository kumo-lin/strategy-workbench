/** G1 review flow: who may do what, what gets written, what gets logged (M1 task 1.6 / 1.8 ③④). */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Role } from '@/lib/config/roles';
import { ApprovalDenied } from '@/lib/harness';
import type { Vault } from '@/lib/vault';
import { addComment, decideReview, recordAnswer, requestReview, ReviewFlowError } from '@/lib/workplan/review-flow';
import { listCommentRefs } from '@/lib/workplan/state';
import { LOG, makeM1Vault, ROLES, stageOf, WS, WS_NOTE } from './helpers';

let vault: Vault;
let cleanup: () => Promise<void>;
beforeEach(async () => {
  ({ vault, cleanup } = await makeM1Vault());
});
afterEach(async () => cleanup());

const W1 = `${WS}/workplan v1.md`;
const NOW = new Date('2026-10-25T09:00:00Z');
const submit = (actor: Role = ROLES.juniorA, subject = W1) =>
  requestReview({ vault, actor, workspacePath: WS, gate: 'G1', subject, summary: '请看拆题逻辑', focus: ['假设 H1 是否可证伪'], now: NOW });

describe('requestReview (the button, not the AI)', () => {
  it('the owner submits: review note created, stage unchanged, both logged', async () => {
    const { reviewPath } = await submit();
    expect(reviewPath).toBe(`${WS}/review/G1 2026-10-25.md`);
    const review = await vault.readTyped(reviewPath, 'review');
    expect(review.note).toMatchObject({ requester: 'Junior A', reviewer: 'Senior', result: null, gate: 'G1', status: '进行中' });
    expect(review.body).toContain('请看拆题逻辑');
    expect(review.body).toContain('假设 H1 是否可证伪');
    expect(await stageOf(vault)).toBe('拆题中');
    const actions = (await vault.readLog(LOG)).map((r) => [r.actor, r.action]);
    expect(actions).toEqual([
      ['Junior A', 'write:review/G1 2026-10-25'],
      ['Junior A', 'event:review.request'],
    ]);
  });

  it.each([
    ['Senior', ROLES.senior],
    ['Junior B', ROLES.juniorB],
  ])('%s is not the owner: denied, nothing written, stage unchanged', async (_n, actor) => {
    await expect(submit(actor)).rejects.toBeInstanceOf(ApprovalDenied);
    expect(await vault.exists(`${WS}/review/G1 2026-10-25.md`)).toBe(false);
    expect(await stageOf(vault)).toBe('拆题中');
    expect(await vault.readLog(LOG)).toEqual([]);
  });

  it('only the latest workplan can be submitted, and only G1 or 结论 are supported', async () => {
    await expect(submit(ROLES.juniorA, `${WS}/workplan v7.md`)).rejects.toBeInstanceOf(ReviewFlowError);
    await expect(
      requestReview({ vault, actor: ROLES.juniorA, workspacePath: WS, gate: 'G2', subject: W1, summary: 'x', focus: [] }),
    ).rejects.toThrow(/G1/);
  });

  it('cannot be submitted twice while pending, but can once the reviewer replied', async () => {
    const { reviewPath } = await submit();
    await expect(submit()).rejects.toBeInstanceOf(ReviewFlowError);
    await expect(submit()).rejects.toThrow(/还在等/);
    await decideReview({ vault, actor: ROLES.senior, reviewPath, decision: 'approve', now: NOW });
    await expect(submit()).resolves.toMatchObject({ reviewPath: `${WS}/review/G1 2026-10-25 (2).md` });
  });
});

describe('addComment', () => {
  it('the reviewer leaves numbered comments that resolve as blocks', async () => {
    const { reviewPath } = await submit();
    const a = await addComment({ vault, actor: ROLES.senior, reviewPath, text: '论点 1 看不出支撑哪个决策', target: '论点与假设', now: NOW });
    const b = await addComment({ vault, actor: ROLES.senior, reviewPath, text: '少了反证', now: NOW });
    expect([a.id, b.id]).toEqual(['m1', 'm2']);
    expect((await vault.checkCitation(a.link)).ok).toBe(true);
    expect((await vault.checkCitation(b.link)).blockText).toBe('（Senior）少了反证');
    const refs = await listCommentRefs(vault, WS);
    expect(refs.map((r) => [r.id, r.result, r.handledIn])).toEqual([
      ['m1', null, []],
      ['m2', null, []],
    ]);
    expect((await vault.readLog(LOG)).filter((r) => r.action.startsWith('comment:'))).toHaveLength(2);
  });

  it('the requester cannot comment on their own review; empty comments are refused', async () => {
    const { reviewPath } = await submit();
    await expect(addComment({ vault, actor: ROLES.juniorA, reviewPath, text: '自己夸自己' })).rejects.toBeInstanceOf(ReviewFlowError);
    await expect(addComment({ vault, actor: ROLES.senior, reviewPath, text: '   ' })).rejects.toBeInstanceOf(ReviewFlowError);
  });

  it('another Junior may comment (PRD §4)', async () => {
    const { reviewPath } = await submit();
    expect((await addComment({ vault, actor: ROLES.juniorB, reviewPath, text: '从用户侧看…' })).id).toBe('m1');
  });

  it('a path outside review/ is not accepted', async () => {
    await expect(addComment({ vault, actor: ROLES.senior, reviewPath: W1, text: 'x' })).rejects.toBeInstanceOf(ReviewFlowError);
  });
});

describe('decideReview: only the reviewer decides (task 1.8 ④)', () => {
  it.each([
    ['the owner (Junior A)', ROLES.juniorA],
    ['another Junior', ROLES.juniorB],
  ])('%s cannot approve or reject; state is untouched', async (_n, actor) => {
    const { reviewPath } = await submit();
    await addComment({ vault, actor: ROLES.senior, reviewPath, text: '有问题' });
    for (const decision of ['approve', 'reject'] as const) {
      await expect(decideReview({ vault, actor, reviewPath, decision })).rejects.toBeInstanceOf(ApprovalDenied);
    }
    expect(await stageOf(vault)).toBe('拆题中');
    expect((await vault.readTyped(reviewPath, 'review')).note.result).toBeNull();
    expect((await vault.readTyped(W1, 'workplan')).note.approved_by).toBeNull();
    expect((await vault.readLog(LOG)).some((r) => r.action.startsWith('event:review.approve'))).toBe(false);
  });

  it('the reviewer approves: stage unchanged, workplan marked seen, review closed, event logged', async () => {
    const { reviewPath } = await submit();
    await addComment({ vault, actor: ROLES.senior, reviewPath, text: '可以，但补一条反证', now: NOW });
    await decideReview({ vault, actor: ROLES.senior, reviewPath, decision: 'approve', now: NOW });
    expect(await stageOf(vault)).toBe('拆题中');
    const wp = (await vault.readTyped(W1, 'workplan')).note;
    expect(wp).toMatchObject({ status: '已确认', approved_by: 'Senior' });
    expect(wp.approved_at).toBeTruthy();
    const review = await vault.readTyped(reviewPath, 'review');
    expect(review.note).toMatchObject({ result: '通过', status: '已确认' });
    expect(review.body).toContain('## 审批结果');
    const row = (await vault.readLog(LOG)).find((r) => r.action === 'event:review.approve');
    expect(row).toMatchObject({ actor: 'Senior' });
    // comments are still readable after the decision, which is when they get interpreted
    expect((await listCommentRefs(vault, WS))[0]).toMatchObject({ id: 'm1', result: '通过' });
  });

  it('rejecting needs a comment; stage and flags stay as they were', async () => {
    const { reviewPath } = await submit();
    await expect(decideReview({ vault, actor: ROLES.senior, reviewPath, decision: 'reject' })).rejects.toThrow(/comment/);
    await addComment({ vault, actor: ROLES.senior, reviewPath, text: '假设不可证伪' });
    await decideReview({ vault, actor: ROLES.senior, reviewPath, decision: 'reject' });
    const ws = (await vault.readTyped(WS_NOTE, 'workspace')).note;
    expect(ws.stage).toBe('拆题中');
    expect(ws.flags).not.toContain('返工中');
    expect((await vault.readTyped(reviewPath, 'review')).note.result).toBe('打回');
    expect((await vault.readTyped(W1, 'workplan')).note.approved_by).toBeNull();
  });

  it('a decided review is closed: no second decision, no more comments', async () => {
    const { reviewPath } = await submit();
    await decideReview({ vault, actor: ROLES.senior, reviewPath, decision: 'approve' });
    await expect(decideReview({ vault, actor: ROLES.senior, reviewPath, decision: 'approve' })).rejects.toBeInstanceOf(ReviewFlowError);
    await expect(addComment({ vault, actor: ROLES.senior, reviewPath, text: '补一句' })).rejects.toBeInstanceOf(ReviewFlowError);
  });
});

describe('recordAnswer', () => {
  it('logs the human half of an ask_user call under the human\'s name', async () => {
    await recordAnswer({ vault, actor: ROLES.juniorA, workspacePath: WS, question: '要支撑什么决策？', answer: '选了：押注企业端', now: NOW });
    expect(await vault.readLog(LOG)).toEqual([
      expect.objectContaining({ actor: 'Junior A', action: 'answer:ask_user', change: '回答：选了：押注企业端' }),
    ]);
  });
});
