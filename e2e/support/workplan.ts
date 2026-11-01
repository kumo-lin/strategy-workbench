import { expect, type Page } from '@playwright/test';
import { answerQuestion } from './ui';
import { WS_A_PATH } from './roles';
import { vaultFiles } from './vault';

/** From the first co-creation question to a finished workplan v1 (the compose pipeline), through the page only. The caller has already clicked 开始共创. */
export async function answerFirstCoCreation(page: Page): Promise<void> {
  await answerQuestion(page, '这项研究要支撑什么决策？', '明年要不要押注企业端 AI PC');
  await answerQuestion(page, '就按这个拆？', '就按这个拆');
  // compose_workplan runs three or four JSON calls; the workplan note is the last thing it writes
  await expect(async () => {
    expect(await vaultFiles(WS_A_PATH)).toContain('workplan v1.md');
  }).toPass({ timeout: 120_000 });
  // the AI's closing sentence means the compose request is over (the note above is written just before it)
  await expect(page.getByTestId('chat-timeline').getByText(/v1 拆好了/).first()).toBeVisible({ timeout: 120_000 });
  // the panel is server-rendered from the vault: a reload is what makes it show the version compose just wrote
  await page.reload();
  await expect(page.getByTestId('plan-doc')).toBeVisible(); // D-64 T35: the plan as a document (the text stays in the page, hidden)
}

/** The Junior's 「发给 Senior 征求意见」 through the workplan page's dialog, filled the way a user would; the caller is on the page, already reloaded after compose. */
export async function sendWorkplanToSenior(page: Page): Promise<void> {
  await page.getByTestId('ask-senior').click(); // D-64 T35: was send-for-opinion
  await page.getByLabel('要他看什么（摘要）').fill('请看拆题：问题、子问题、假设和下一步。');
  await page.getByLabel('请他重点看（一行一条，最多 8 条）').fill('H1 是否可证伪');
  await page.getByTestId('send-for-opinion-confirm').click();
  await expect(page.getByTestId('opinion-pending')).toContainText('已发给 Senior，等回复（不挡你）');
}
