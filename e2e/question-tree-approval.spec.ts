/**
 * D-39: a question-tree plan whose tree fails its deterministic checks (lib/research/question-tree.ts `treeChecks`) is not
 * approved — the approve route refuses with the reasons, nothing is unlocked, and nothing is written to the log. A plan
 * that passes is approved as before; a plan from before the question tree (no `question` on its claims) is not checked.
 *
 * Snapshot: e2e-vault-g1-plan (WS-A's unapproved plan v1, a question tree with one sub-question Q1 → hypothesis H1).
 * The bad plans are written as plan v2 straight into the scratch vault (the editor would not let a person save most of them
 * as an approvable plan; the plan page test at the end edits one in the editor).
 */
import { expect, test } from '@playwright/test';
import { apiPost, openAs, WS_A, WS_A_PATH, type RoleWindow } from './support/roles';
import { E2E_VAULT } from './support/env';
import { readVaultFile, resetVault } from './support/vault';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';

const NAME = 'IT 可管理性';
const DIR = `${WS_A_PATH}/调查/${NAME}`;
const URL = `${WS_A}/research/${encodeURIComponent(NAME)}`;
const BODY = { workspacePath: WS_A_PATH, researchDir: DIR };

test.describe.configure({ mode: 'serial' });

let junior: RoleWindow; // Junior A, the owner of WS-A

test.beforeAll(async ({ browser }) => {
  junior = await openAs(browser, 'junior-a');
});
test.afterAll(async () => {
  await junior?.context.close();
});
test.beforeEach(async () => {
  await resetVault('e2e-vault-g1-plan');
});

/** The snapshot's plan v1 as plan v2, after `change` (a plain string edit of its text). */
async function writePlanV2(change: (text: string) => string): Promise<string> {
  const v1 = await readVaultFile(`${DIR}/计划 v1.md`);
  const v2 = change(v1).replace(/^version: 1$/m, 'version: 2');
  expect(v2).not.toBe(v1);
  await writeFile(path.join(E2E_VAULT, DIR, '计划 v2.md'), v2, 'utf8');
  return v2;
}

const approvedEvents = async () => ((await readVaultFile(`${WS_A_PATH}/日志.md`)).match(/research_plan\.approve/g) ?? []).length;

test('a tree with no mece_check, a sub-question that is not a question and a hypothesis without conditions is not approved; the reasons are listed', async () => {
  await writePlanV2((t) =>
    t
      .replace(/^mece_check: .*\n/m, '')
      .replace('question: 企业买单的首要条件是不是 IT 能管？', 'question: 企业买单的首要条件')
      .replace('conditions: ["采购由 IT 牵头"]', 'conditions: []'),
  );
  const res = await apiPost(junior, '/api/research/approve', BODY);
  expect(res.status()).toBe(409);
  const { error, problems } = (await res.json()) as { error: string; problems: string[] };
  expect(problems).toHaveLength(3);
  expect(error).toContain('不能批准');
  expect(problems.join('\n')).toContain('不是问句');
  expect(problems.join('\n')).toContain('必须成立的条件');
  expect(problems.join('\n')).toContain('mece_check');

  // nothing was unlocked or logged
  expect(await readVaultFile(`${DIR}/计划 v2.md`)).toContain('approved_by_owner: null');
  expect(await approvedEvents()).toBe(0);
});

test('a split with only one part, and an id out of order, are listed too', async () => {
  await writePlanV2((t) =>
    t
      .replace('mece_check:', 'question_tree:\n  - id: Q2\n    question: 买方为什么买？\nmece_check:')
      .replace('    parent: null\n', '    parent: Q2\n'),
  );
  const res = await apiPost(junior, '/api/research/approve', BODY);
  expect(res.status()).toBe(409);
  const { problems } = (await res.json()) as { problems: string[] };
  expect(problems.join('\n')).toContain('只拆出 1 个');
  expect(problems.join('\n')).toContain('编号要和顺序一致'); // the only top-level sub-question is Q1, the tree calls it Q2
  expect(await approvedEvents()).toBe(0);
});

test('the same plan with the tree fixed is approved', async () => {
  await writePlanV2((t) => t.replace('conditions: ["采购由 IT 牵头"]', 'conditions: ["采购由 IT 牵头", "拍板的是 IT 或 CIO"]'));
  const res = await apiPost(junior, '/api/research/approve', BODY);
  expect(res.ok(), await res.text()).toBe(true);
  expect(await readVaultFile(`${DIR}/计划 v2.md`)).toMatch(/approved_by_owner: Junior A/);
  expect(await approvedEvents()).toBe(1);
});

test('a plan from before the question tree (no question on its claims, no mece_check) is not checked and is approved as before', async () => {
  await writePlanV2((t) => t.replace(/^mece_check: .*\n/m, '').replace(/^ {4}question: .*\n/m, '').replace(/^ {4}parent: null\n/m, ''));
  const v2 = await readVaultFile(`${DIR}/计划 v2.md`);
  expect(v2).not.toContain('mece_check');
  const res = await apiPost(junior, '/api/research/approve', BODY);
  expect(res.ok(), await res.text()).toBe(true);
  expect(await approvedEvents()).toBe(1);
});

test('the plan page: the approve button is disabled and the reasons are listed; fixing the tree and saving turns it on', async () => {
  await writePlanV2((t) => t.replace(/^mece_check: .*\n/m, ''));
  const { page } = junior;
  await page.goto(URL);
  await expect(page.getByRole('heading', { name: '计划 v2' })).toBeVisible();
  const approve = page.getByRole('button', { name: '计划定了，开始调查 →' });
  await expect(approve).toBeDisabled();
  const blockers = page.getByTestId('approve-blockers');
  await expect(blockers).toContainText('现在还不能批准');
  await expect(blockers).toContainText('mece_check');

  // write the MECE check (the one thing missing): the reasons go, but it is an unsaved edit, so the button waits for the save
  await page.getByLabel('MECE 和充分必要的自检（AI 提议）').fill('只有一个子问题，不存在重叠；少了它就答不了核心问题。');
  await expect(blockers).not.toContainText('mece_check');
  await expect(approve).toBeDisabled();
  await page.getByRole('button', { name: '保存为新版本' }).click();
  await expect(page.getByText('已保存为 计划 v3')).toBeVisible();
  await expect(page.getByTestId('approve-blockers')).toHaveCount(0);
  await expect(approve).toBeEnabled();
  expect(await readVaultFile(`${DIR}/计划 v3.md`)).toContain('不存在重叠');
  expect(await approvedEvents()).toBe(0); // enabled, not clicked
});
