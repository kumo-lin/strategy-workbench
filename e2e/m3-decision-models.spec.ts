/**
 * PRD §11.2 step 4 (D-26): switching the model by config also shows up in the decision. The Senior drafts a decision
 * with the default provider, edits `active` in 90_配置/模型.md to the second provider, drafts again from the SAME report:
 * both drafts are kept and shown side by side, each marked with the model that wrote it; the same model drafting again
 * replaces only its own draft; confirming one leaves the other a draft.
 * (`MODEL_MOCK=1` still puts the scripted model underneath, but provider, label and model name come from the config.)
 *
 * Own spec file and own snapshot: the card-per-decision locators of m3-decision.spec.ts assume a single card.
 */
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { E2E_VAULT } from './support/env';
import { apiPost, openAs, WS_A, WS_A_PATH, type RoleWindow } from './support/roles';
import { readVaultFile, resetVault, vaultFiles } from './support/vault';

const NAME = 'IT 可管理性';
const RESEARCH_DIR = `${WS_A_PATH}/调查/${NAME}`;
const RESEARCH_URL = `${WS_A}/research/${encodeURIComponent(NAME)}`;
const DECISION_DIR = '20_项目/个人AI战略/决策';
const MODEL_NOTE = path.join(E2E_VAULT, '90_配置/模型.md');
const FLASH = 'DeepSeek V4.1-Flash（deepseek-flash）'; // stored on the card (data-model); the page shows the name only
const PRO = 'DeepSeek V4 Pro（deepseek-v4-pro）';
const nameOf = (m: string) => m.replace(/（[^（）]*）$/, '');

test.describe.configure({ mode: 'serial' });

let senior: RoleWindow;
let junior: RoleWindow;
let originalModelNote = '';

test.beforeAll(async ({ browser }) => {
  test.setTimeout(420_000);
  await resetVault('e2e-vault-g1-plan');
  originalModelNote = await readFile(MODEL_NOTE, 'utf8');
  senior = await openAs(browser, 'senior');
  junior = await openAs(browser, 'junior-a');

  // a delivered team report on WS-A (approve the snapshot's plan v1, run), driven through the API as Junior A
  const body = { workspacePath: WS_A_PATH, researchDir: RESEARCH_DIR };
  const approve = await apiPost(junior, '/api/research/approve', body);
  expect(approve.ok(), await approve.text()).toBe(true);
  const run = await apiPost(junior, '/api/research/execute', { ...body, mode: 'small' });
  expect(run.ok()).toBe(true);
  expect(await run.text()).toContain('"delivered":true');
});
test.afterAll(async () => {
  // the config is part of the vault the next spec resets, but leave it as found anyway
  if (originalModelNote) await writeFile(MODEL_NOTE, originalModelNote);
  await Promise.all([senior?.context.close(), junior?.context.close()]);
});

const cardOf = (model: string) => senior.page.locator(`[data-testid="decision-card"][data-model="${model}"]`);

async function draft(): Promise<void> {
  const answered = senior.page.waitForResponse((r) => r.url().endsWith('/api/decision/draft'));
  await senior.page.getByTestId('decision-draft').click();
  expect((await answered).status()).toBe(200);
}

const decisionNotes = async () => (await vaultFiles(DECISION_DIR)).filter((f) => f.endsWith('.md'));

test('the first draft is written by the default provider and stands alone', async () => {
  const { page } = senior;
  expect(originalModelNote).toMatch(/^active: deepseek$/m);
  await page.goto(`${RESEARCH_URL}?step=confirm`); // D-64 T41: the decision is step 6
  await expect(page.getByTestId('decision-panel')).toBeVisible();
  await draft();

  await expect(page.getByTestId('decision-card')).toHaveCount(1);
  await expect(cardOf(FLASH)).toHaveAttribute('data-status', '推断');
  await expect(cardOf(FLASH).getByTestId('decision-drafted-by')).toHaveText(`起草模型：${nameOf(FLASH)}`);
  await expect(page.getByTestId('decision-cards')).toHaveAttribute('data-layout', 'stacked'); // side by side only from two drafts
  expect(await decisionNotes()).toHaveLength(1);
});

test('switching `active` in 模型.md and drafting again keeps both, side by side, each with its model', async () => {
  const { page } = senior;
  // what the demo does in Obsidian: one line in the config note
  await writeFile(MODEL_NOTE, originalModelNote.replace(/^active: deepseek$/m, 'active: deepseek-pro'));
  await draft();

  await expect(page.getByTestId('decision-card')).toHaveCount(2);
  await expect(page.getByTestId('decision-cards')).toHaveAttribute('data-layout', 'side-by-side');
  expect(await page.getByTestId('decision-card').evaluateAll((els) => els.map((e) => e.getAttribute('data-model')).sort())).toEqual([FLASH, PRO].sort());
  await expect(cardOf(FLASH)).toHaveAttribute('data-status', '推断');
  await expect(cardOf(PRO)).toHaveAttribute('data-status', '推断');
  await expect(cardOf(PRO).getByTestId('decision-drafted-by')).toHaveText(`起草模型：${nameOf(PRO)}`);
  await expect(cardOf(FLASH).getByTestId('decision-drafted-by')).toHaveText(`起草模型：${nameOf(FLASH)}`);

  // two notes in 决策/, one per model, both still drafts
  const notes = await decisionNotes();
  expect(notes).toHaveLength(2);
  const bodies = await Promise.all(notes.map((f) => readVaultFile(`${DECISION_DIR}/${f}`)));
  expect(bodies.every((b) => /^status: 推断$/m.test(b))).toBe(true);
  expect(bodies.map((b) => /^drafted_by_model: (.+)$/m.exec(b)?.[1]?.replace(/^"|"$/g, '')).sort()).toEqual([FLASH, PRO].sort());

  // the draft is logged with the model that wrote it
  expect(await readVaultFile(`${WS_A_PATH}/日志.md`)).toContain('tool:propose_decision');
});

// N4: in the demo (one browser window shared in Teams) the two drafts must be compared at a glance, left and right.
for (const vp of [
  { width: 1440, height: 900 },
  { width: 1280, height: 800 },
]) {
  test(`at ${vp.width}x${vp.height} the two drafts sit left and right, both on one screen`, async () => {
    const { page } = senior;
    await page.setViewportSize(vp);
    await page.goto(`${RESEARCH_URL}?step=confirm`); // D-64 T41: the decision is step 6
    await expect(page.getByTestId('decision-card')).toHaveCount(2);
    const a = cardOf(FLASH);
    const b = cardOf(PRO);
    await a.scrollIntoViewIfNeeded();
    const boxes = [await a.boundingBox(), await b.boundingBox()];
    test.info().annotations.push({ type: 'boxes', description: JSON.stringify(boxes) });
    const [boxA, boxB] = boxes;
    expect(boxA && boxB).toBeTruthy();
    // same row: tops line up, and one is to the right of the other without overlapping
    expect(Math.abs(boxA!.y - boxB!.y)).toBeLessThan(20);
    const [left, right] = boxA!.x < boxB!.x ? [boxA!, boxB!] : [boxB!, boxA!];
    expect(right.x).toBeGreaterThanOrEqual(left.x + left.width - 1);
    expect(left.width).toBeGreaterThan(280);
    // folded by default: title, model and the start of the reasons on one screen, not a 1900 px card
    for (const box of [boxA!, boxB!]) expect(box.height).toBeLessThan(vp.height * 0.85);
    // D-64 T41: a draft is its three fields (决定, 理由, 适用边界), not the folded text
    await expect(a.getByTestId('decision-field')).toHaveCount(3);
    await expect(a.getByTestId('decision-drafted-by')).toBeInViewport();
    await expect(b.getByTestId('decision-drafted-by')).toBeInViewport();
  });
}

test('drafting again with the same model replaces only its own draft', async () => {
  const { page } = senior;
  await draft();
  await expect(page.getByTestId('decision-card')).toHaveCount(2);
  expect(await decisionNotes()).toHaveLength(2);
});

test('after a reload both drafts are still there; confirming one leaves the other a draft', async () => {
  const { page } = senior;
  await page.reload();
  await expect(page.getByTestId('decision-card')).toHaveCount(2);
  await expect(page.getByTestId('decision-cards')).toHaveAttribute('data-layout', 'side-by-side');

  await cardOf(PRO).getByTestId('confirm-store').click();
  await expect(cardOf(PRO)).toHaveAttribute('data-status', '已确认');
  await expect(cardOf(PRO)).toContainText('Senior 确认');
  await expect(cardOf(FLASH)).toHaveAttribute('data-status', '推断'); // the other model's draft is untouched
  await expect(cardOf(FLASH).getByTestId('confirm-store')).toBeVisible();

  const statuses = await Promise.all((await decisionNotes()).map(async (f) => /^status: (.+)$/m.exec(await readVaultFile(`${DECISION_DIR}/${f}`))?.[1]));
  expect(statuses.sort()).toEqual(['推断', '已确认'].sort());

});
