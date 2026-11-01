/**
 * PRD §11.2 step 3, first half (M1): Junior A co-creates the workplan with the AI, submits it for G1,
 * Senior (a second browser context) comments and approves, a non-reviewer is refused, then Junior A
 * has the AI interpret the comment and gets workplan v2 whose change traces back to it.
 */
import { expect, test } from '@playwright/test';
import { answerQuestion } from './support/ui';
import { apiPost, openAs, WS_A, WS_A_PATH, type RoleWindow } from './support/roles';
import { readVaultFile, resetVault, vaultFiles } from './support/vault';
import { answerFirstCoCreation, sendWorkplanToSenior } from './support/workplan';

const REVIEW_DIR = `${WS_A_PATH}/review`;

test.describe.configure({ mode: 'serial' });

let junior: RoleWindow;
let senior: RoleWindow;
let juniorB: RoleWindow;

test.beforeAll(async ({ browser }) => {
  await resetVault('e2e-vault');
  junior = await openAs(browser, 'junior-a');
  senior = await openAs(browser, 'senior');
  juniorB = await openAs(browser, 'junior-b');
});
test.afterAll(async () => {
  await Promise.all([junior?.context.close(), senior?.context.close(), juniorB?.context.close()]);
});

async function reviewFile(): Promise<string> {
  const files = await vaultFiles(REVIEW_DIR);
  expect(files).toHaveLength(1);
  return files[0];
}

test('Junior A co-creates workplan v1 with the AI (compose flow) and sends it to the Senior for an opinion', async () => {
  const { page } = junior;

  // open the workspace from the list, as a user would
  await page.goto('/workspace');
  await page.getByTestId('workspace-link').filter({ hasText: 'WS-A' }).click();
  await expect(page.getByTestId('workspace-shell')).toBeVisible();
  await expect(page.getByTestId('workplan-panel')).toContainText('还没有研究计划');
  // the flow bar says step 1, and it is Junior A's turn (the next-step bar has the button)
  await expect(page.getByTestId('flow-bar')).toHaveAttribute('data-current', '1');
  await expect(page.getByTestId('next-step')).toHaveAttribute('data-turn', 'mine');
  await expect(page.getByTestId('next-step')).toContainText('第 1 步');

  // 共创: the AI asks one question, frames the topic, asks for a confirmation, then the compose pipeline writes v1
  await page.getByRole('button', { name: '开始共创研究计划' }).click();
  await answerFirstCoCreation(page);

  // v1 and its hypotheses are written; nothing is sent yet
  await expect(page.getByTestId('flow-bar')).toHaveAttribute('data-current', '1');
  expect(await vaultFiles(REVIEW_DIR)).toEqual([]);
  expect(await readVaultFile(`${WS_A_PATH}/workplan v1.md`)).toContain('author: AI');

  await sendWorkplanToSenior(page);
  await page.reload();
  await expect(page.getByTestId('opinion-pending')).toBeVisible();
  await expect(page.getByTestId('flow-bar')).toHaveAttribute('data-current', '1'); // 征求意见 is not a step (D-64 T30): still step 1, Junior A's turn
  await expect(page.getByTestId('next-step')).toHaveAttribute('data-turn', 'mine');
  await expect(page.getByTestId('next-step-aside')).toContainText('已发给 Senior 征求意见');
  await expect(page.getByTestId('workplan-body')).toContainText('问题树与假设');
});

test('a second request is refused while the first one has no answer yet, and nothing is written', async () => {
  // the first request from the test above, still waiting for the Senior
  const first = await reviewFile();
  const res = await apiPost(junior, '/api/workspace/review/request', {
    workspacePath: WS_A_PATH,
    gate: 'G1',
    // the route compares the subject with the latest workplan path, exactly as the page sends it
    subject: `${WS_A_PATH}/workplan v1.md`,
    summary: '再发一次',
    focus: ['H1 是否可证伪'],
  });
  expect(res.status()).toBe(409);
  const { message } = (await res.json()) as { message: string };
  expect(message).toContain('上一份征求意见还在等 Senior 回复');

  // still that one request, and the stage did not move
  expect(await vaultFiles(REVIEW_DIR)).toHaveLength(1);
  expect(await reviewFile()).toBe(first);
  expect(await readVaultFile(`${WS_A_PATH}/workspace.md`)).toContain('stage: 拆题中');
});

test('Senior, in another window, sees the request, comments, and a non-reviewer is refused', async () => {
  const { page } = senior;
  const name = (await reviewFile()).replace(/\.md$/, '');

  // another context: it only sees the submission after loading the page
  await page.goto(`${WS_A}/review`);
  const panel = page.getByTestId('review-panel');
  await expect(panel).toHaveAttribute('data-result', 'pending');
  await expect(page.getByTestId('next-step')).toHaveAttribute('data-turn', 'waiting'); // the main step is Junior A's
  await expect(page.getByTestId('next-step-aside')).toContainText('Junior A 的研究计划来征求你的意见');
  await expect(panel).toContainText('Junior A 发给 Senior 征求意见');
  await expect(panel).toContainText('请看拆题：问题、子问题、假设和下一步。');
  await expect(panel).toContainText('H1 是否可证伪');
  await expect(page.getByTestId('workplan-body')).toContainText('问题树与假设');

  await page.getByTestId('comment-input').fill('H1 少了反证：会不会只是 Win10 换机潮');
  await page.getByTestId('add-comment').click();
  await expect(panel).toContainText('意见（1）');
  await expect(panel).toContainText('H1 少了反证：会不会只是 Win10 换机潮');
  expect(await readVaultFile(`${REVIEW_DIR}/${name}.md`)).toMatch(/H1 少了反证.*\^m1/);

  // the API refuses everyone but the reviewer: the requester and another Junior, straight to the endpoint
  const reviewPath = `${REVIEW_DIR}/${name}.md`;
  for (const who of [junior, juniorB]) {
    const res = await apiPost(who, '/api/workspace/review/decision', { reviewPath, decision: 'approve' });
    expect(res.status()).toBe(403);
  }
  // and the buttons are off for the Junior's own view of the review
  await junior.page.goto(`${WS_A}/review`);
  await expect(junior.page.getByTestId('approve-review')).toBeDisabled();
  await expect(junior.page.getByTestId('next-step')).toHaveAttribute('data-turn', 'mine'); // Junior A is not blocked by the G1 opinion
  await expect(junior.page.getByTestId('next-step-aside')).toContainText('已发给 Senior 征求意见');
  await expect(junior.page.getByTestId('readonly-notice')).toContainText('只读：你不能回复这次征求意见。');
  // G1 only asks for an opinion: the stage stays 拆题中
  expect(await readVaultFile(`${WS_A_PATH}/workspace.md`)).toContain('stage: 拆题中');
  expect(await readVaultFile(`${WS_A_PATH}/workspace.md`)).not.toContain('workplan待审');
});

test('Senior approves G1; Junior A reloads and sees the comment and the new stage', async () => {
  const { page } = senior;
  await page.getByTestId('approve-review').click();
  await page.getByRole('button', { name: '确认', exact: true }).click();
  await expect(page.getByTestId('review-panel')).toHaveAttribute('data-result', '通过');
  await expect(page.getByTestId('review-panel')).toContainText('Senior 看过了');

  // Junior A's window was open on the old state; after a reload the approval is there
  await junior.page.goto(WS_A);
  await expect(junior.page.getByTestId('flow-bar')).toHaveAttribute('data-current', '1'); // the reply is not a step either: Junior A says when the plan is final (T35)
  await expect(junior.page.getByTestId('next-step-aside')).toContainText('回复了 1 条意见');
  await junior.page.getByTestId('tab-comments').click();
  const comment = junior.page.getByTestId('comment-card');
  await expect(comment).toHaveCount(1);
  await expect(comment).toContainText('H1 少了反证：会不会只是 Win10 换机潮');
  await expect(comment).toContainText('Senior');
  await expect(comment).toHaveAttribute('data-handled', 'false');
  await junior.page.getByTestId('tab-workplan').click();
  await expect(junior.page.getByTestId('workplan-panel')).toContainText('Senior 看过');
  expect(await readVaultFile(`${WS_A_PATH}/workplan v1.md`)).toMatch(/approved_by: Senior/);
  // G1 only asks for an opinion: the approval is recorded, the stage stays 拆题中
  expect(await readVaultFile(`${WS_A_PATH}/workspace.md`)).toContain('stage: 拆题中');
});

test('Junior A has the AI interpret the comment and gets workplan v2, traced to the comment', async () => {
  const { page } = junior;
  await page.getByTestId('tab-comments').click();
  await page.getByTestId('comment-card').getByRole('button', { name: '和 AI 一起解读' }).click();

  // intent first (the AI proposes, the Junior confirms), then how to change it
  await answerQuestion(page, 'Senior 这条意见想达成什么？', '担心结论被替代解释（换机潮）推翻，要求排除它');
  await answerQuestion(page, '怎么改？', '在 H1 的做法里加"排除换机潮"的检验');

  await expect(page.getByText('G1 已通过，不用重新审批')).toBeVisible();
  await expect(page.getByTestId('comment-card')).toHaveAttribute('data-handled', 'true');
  await expect(page.getByTestId('comment-card')).toContainText('已在 v2 处理');

  // v2 lists the change and it resolves to the real comment block
  await page.getByTestId('tab-workplan').click();
  await expect(page.getByRole('button', { name: /^v2/ })).toBeVisible();
  await page.getByRole('button', { name: /^v2/ }).click();
  const change = page.getByTestId('change-card');
  await expect(change).toHaveCount(1);
  await expect(change).toHaveAttribute('data-traced', 'true');
  await expect(change).toContainText('H1 少了反证：会不会只是 Win10 换机潮');
  await expect(change).toContainText('担心结论被换机潮这种替代解释推翻');
  await expect(page.getByTestId('workplan-body')).toContainText('H1 检验：对比 Win10 换机前后');

  const v2 = await readVaultFile(`${WS_A_PATH}/workplan v2.md`);
  const name = (await reviewFile()).replace(/\.md$/, '');
  expect(v2).toContain(`${WS_A_PATH}/review/${name}#^m1`);
  expect(v2).toContain('workplan v1');
  // still approved v1; v2 did not need a new approval
  // G1 only asks for an opinion: the stage stays 拆题中, no 返工中 either
  const workspace = await readVaultFile(`${WS_A_PATH}/workspace.md`);
  expect(workspace).toContain('stage: 拆题中');
  expect(workspace).not.toContain('执行中');
  expect(workspace).not.toContain('返工中');
});

test('Senior, after a reload, sees v2 and the handled comment (and every AI step is in the log)', async () => {
  const { page } = senior;
  await page.goto(`${WS_A}`);
  await expect(page.getByTestId('flow-bar')).toHaveAttribute('data-current', '1'); // comment handled in v2; the plan is final when Junior A says so (T35)
  await page.getByTestId('tab-comments').click();
  await expect(page.getByTestId('comment-card')).toContainText('已在 v2 处理');
  await page.getByTestId('tab-workplan').click();
  await expect(page.getByRole('button', { name: /^v2/ })).toBeVisible();

  // D-64 T35: no 日志 tab on the page any more; the log is read from the vault
  const log = await readVaultFile(`${WS_A_PATH}/日志.md`);
  // the first co-creation composes now (no submit_for_review card); the request itself is the API's event:review.request
  for (const action of ['tool:ask_user', 'tool:write_draft', 'tool:compose_workplan', 'event:review.request', 'event:review.approve']) {
    expect(log).toContain(action);
  }
});
