/**
 * D-39: a run on a SPLIT question tree — the structure the demo's WS-A plan has. Q1 is not split (one hypothesis H1); Q2 is split
 * into Q2-1 and Q2-2 (hypotheses H2-1, H2-2). Snapshot e2e-vault-g1-plan; the split plan is written as plan v2 into the scratch vault
 * (the editor's own split / save is covered by the plan-page specs), approved by Junior A, run through the API.
 *
 * The small run takes the first lowest-level sub-question only (Q1): the rest of the tree is said to be not run. The full run
 * answers every sub-question, so the report shows every level: ## Q2 → ### Q2-1 → #### 假设 H2-1.
 */
import { expect, test } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { E2E_VAULT } from './support/env';
import { runToDelivery } from './support/research';
import { apiPost, openAs, WS_A, WS_A_PATH, type RoleWindow } from './support/roles';
import { readVaultFile, resetVault } from './support/vault';

const NAME = 'IT 可管理性';
const DIR = `${WS_A_PATH}/调查/${NAME}`;
const BODY = { workspacePath: WS_A_PATH, researchDir: DIR };
const URL = `${WS_A}/research/${encodeURIComponent(NAME)}`;

test.describe.configure({ mode: 'serial' });

let junior: RoleWindow;
test.beforeAll(async ({ browser }) => {
  junior = await openAs(browser, 'junior-a');
});
test.afterAll(async () => {
  await junior?.context.close();
});

const SPLIT_CLAIMS = `  - id: C2
    question: IT 管得住是不满足就出局的准入要求吗？
    parent: Q2
    statement: IT 可管理性是采购的准入要求，不满足就出局
    hypothesis: null
    conditions: ["采购文件把管理能力写在资格条款里"]
    sub_questions:
      - { id: C2-Q1, question: "采购文件里，管理能力是写在资格条款还是评分项？", methods: [知识库, 网络] }
    counter_search: 找管理能力只是加分项的采购文件
  - id: C3
    question: 几家都管得住的时候，买方按什么来选？
    parent: Q2
    statement: 过了准入之后，买方按价格和换机周期来选，不按管理能力
    hypothesis: null
    conditions: ["过了管理评审之后，比的是价格和换机节奏"]
    sub_questions:
      - { id: C3-Q1, question: "采购评分表里价格和管理能力各占多少权重？", methods: [知识库, 网络] }
    counter_search: 找中标案例里写明因为管理能力更全而胜出的
`;

/** The snapshot's plan v1 (Q1 → C1) made a split tree as plan v2: Q2 (question_tree) split into C2 and C3. */
async function writeSplitPlanV2(): Promise<void> {
  const v1 = await readVaultFile(`${DIR}/计划 v1.md`);
  const at = v1.indexOf('\nclaims:\n');
  const end = v1.indexOf('\napproved_by_owner:');
  expect(at).toBeGreaterThan(0);
  expect(end).toBeGreaterThan(at);
  const v2 =
    v1.slice(0, at) +
    '\nquestion_tree:\n  - id: Q2\n    question: 买方按什么标准放行，又按什么标准选？' +
    v1.slice(at, end) +
    '\n' +
    SPLIT_CLAIMS.trimEnd() +
    v1.slice(end);
  await writeFile(path.join(E2E_VAULT, DIR, '计划 v2.md'), v2.replace(/^version: 1$/m, 'version: 2'), 'utf8');
}

/** Reset, write the split plan, approve it and run it in `mode`; returns the report. */
async function runSplitPlan(mode: 'small' | 'full'): Promise<string> {
  await resetVault('e2e-vault-g1-plan');
  await writeSplitPlanV2();
  const approve = await apiPost(junior, '/api/research/approve', BODY);
  expect(approve.ok(), await approve.text()).toBe(true);
  await runToDelivery(junior, { ...BODY, mode });
  return readVaultFile(`${DIR}/报告 v1.md`);
}

const section = (report: string, heading: RegExp) => {
  const start = report.search(heading);
  expect(start, `${heading} is in the report`).toBeGreaterThanOrEqual(0);
  return report.slice(start);
};

test('the plan page shows the split tree as it was written: Q1 with H1, Q2 split into Q2-1 / Q2-2, and can be approved', async () => {
  await resetVault('e2e-vault-g1-plan');
  await writeSplitPlanV2();
  const { page } = junior;
  await page.goto(URL);
  await expect(page.getByRole('heading', { name: '计划 v2' })).toBeVisible();
  await expect(page.getByTestId('plan-tree-node')).toHaveCount(1); // Q2 is the only split sub-question
  await expect(page.getByTestId('plan-leaf')).toHaveCount(3);
  await expect(page.getByTestId('plan-tree-node')).toContainText('拆成：Q2-1、Q2-2');
  await expect(page.getByTestId('approve-blockers')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '计划定了，开始调查 →' })).toBeEnabled();
});

test('a full run on the split tree: every level is in the report, every lowest-level sub-question has its answer line', async () => {
  test.setTimeout(420_000);
  const report = await runSplitPlan('full');
  expect(report).toMatch(/^report_format: question_tree$/m);

  // the sections: Q1 (not split) → its hypothesis and one answer; Q2 → Q2-1 → hypothesis H2-1 …
  expect(report).toMatch(/^## Q1 /m);
  expect(report).toMatch(/^### 假设 H1：/m);
  expect(report).toMatch(/^### Q1 的回答$/m);
  expect(report).toMatch(/^## Q2 /m);
  expect(report).toMatch(/^### Q2-1 /m);
  expect(report).toMatch(/^#### 假设 H2-1：/m);
  expect(report).toMatch(/^### Q2-2 /m);
  expect(report).toMatch(/^#### 假设 H2-2：/m);
  expect(report).toMatch(/^### Q2 的回答$/m);
  // the order: Q2 comes after Q1, and Q2-1 and Q2-2 sit inside Q2, before its own answer
  const at = (re: RegExp) => report.search(re);
  const order = [/^## Q1 /m, /^## Q2 /m, /^### Q2-1 /m, /^### Q2-2 /m, /^### Q2 的回答$/m, /^## 对研究计划的影响/m].map(at);
  expect(order).toEqual([...order].sort((a, b) => a - b));
  expect(at(/^## Q1 /m)).toBeGreaterThan(at(/^## 怎么查的/m));

  // each lowest-level sub-question under a split one has the line written by code from its hypothesis' judgment; the unsplit Q1 has none
  const q2 = section(report, /^## Q2 /m);
  expect(q2).toMatch(/^- Q2-1 的回答：.+/m);
  expect(q2).toMatch(/^- Q2-2 的回答：.+/m);
  expect(report).not.toMatch(/^- Q1 的回答：/m);
  expect(section(report, /^## Q1 /m).split(/^## Q2 /m)[0].match(/的回答/g)).toHaveLength(1); // only "### Q1 的回答"

  // the Summary: the tree, each answer, why they are enough, the table with every hypothesis
  const summary = report.slice(report.indexOf('## Summary'), report.indexOf('## 怎么查的'));
  expect(summary).toMatch(/^- 核心问题：/m);
  // D-48: how the tree was split may come first (split_basis), then the tree itself
  expect(summary).toMatch(/^- 问题树：(?:[^\n→]+：)?核心问题 → Q1 .*／Q2 .*（→ Q2-1 .*、Q2-2 .*）/m);
  expect(summary).toMatch(/^ {2}- Q1 → .+/m);
  expect(summary).toMatch(/^ {2}- Q2 → .+/m);
  expect(summary).toMatch(/^- 为什么这几个回答足以回答核心问题：.+/m);
  expect(summary).toMatch(/由 Q1、Q2 的回答组装而成/);
  for (const row of ['H1', 'H2-1', 'H2-2']) expect(summary).toMatch(new RegExp(`^\\| Q?[\\d-]+ \\| ${row} `, 'm'));
  expect(summary).not.toContain('本次没有查');

  // the page opens it
  const { page } = junior;
  await page.goto(URL);
  const pane = page.getByRole('tabpanel', { name: /报告/ });
  await expect(pane.getByText('已交付 · 引用已自检')).toBeVisible();

  // D-48: the tree is drawn under the Summary's 问题树 line (Q2 with Q2-1 and Q2-2 under it), and each hypothesis card's
  // third layer (evidence, counter-evidence, gaps) is one closed block with its counts in the title
  const tree = pane.getByTestId('question-tree');
  await expect(tree).toBeVisible();
  await expect(tree.getByRole('link')).toHaveCount(4);
  await expect(tree.getByRole('link', { name: /^Q2-1 / })).toBeVisible();
  const folds = pane.getByTestId('evidence-fold');
  await expect(folds).toHaveCount(3);
  await expect(folds.first()).toContainText(/^证据、反证和挑战、缺口（支持 \d+ · 反证 \d+ · 要问专家 \d+）/);
  await expect(folds.first()).not.toHaveAttribute('open', '');
});

test('a small run on the split tree runs only the first sub-question (Q1); Q2 and its parts are said to be not run, and the report still has every level', async () => {
  test.setTimeout(420_000);
  const report = await runSplitPlan('small');
  expect(report).toMatch(/^report_format: question_tree$/m);

  // Q1 was run: its hypothesis section and its one answer
  expect(report).toMatch(/^### 假设 H1：/m);
  expect(report).toMatch(/^### Q1 的回答$/m);
  // Q2 and its parts: in the tree, said to be not run, no hypothesis section for them
  expect(report).toMatch(/^## Q2 /m);
  expect(report).toMatch(/^### Q2-1 /m);
  expect(report).toMatch(/^### Q2-2 /m);
  expect(report).not.toMatch(/^#### 假设 H2-[12]：/m);
  const q2 = section(report, /^## Q2 /m);
  expect(q2).toMatch(/^- Q2-1 的回答：本次没有查（试水调查范围）/m);
  expect(q2).toMatch(/^- Q2-2 的回答：本次没有查（试水调查范围）/m);
  expect(q2).toMatch(/^- 假设 H2-1：.*（本次没有查（试水调查范围））/m);

  const summary = report.slice(report.indexOf('## Summary'), report.indexOf('## 怎么查的'));
  // D-48: how the tree was split may come first (split_basis), then the tree itself
  expect(summary).toMatch(/^- 问题树：(?:[^\n→]+：)?核心问题 → Q1 .*／Q2 .*（→ Q2-1 .*、Q2-2 .*）/m);
  expect(summary).toMatch(/^ {2}- Q1 → .+/m);
  expect(summary).toMatch(/^ {2}- Q2 → 本次没有查（试水调查范围）/m);
  expect(summary).toMatch(/由 Q1 的回答组装而成/);
  expect(report).toMatch(/计划之外的调整：[^\n]*H2-1 本次没有查（试水调查范围）/);
});
