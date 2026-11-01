/** D-64 T55: v6 2.1–2.14, added in independently verified segments. Mock models only. */
import { readdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { createVault } from '../lib/vault';
import { M1_CONTRACT, M1_CORE, M1_KEYS, M1_PLAN } from '../lib/testing/scripts/m1';
import { E2E_VAULT } from './support/env';
import { openAs, type RoleWindow } from './support/roles';
import { answerQuestion, attemptName, expectFitsWindow, expectReaderWords } from './support/ui';
import { readVaultFile, resetVault } from './support/vault';

test.describe('2.1 新建项目（独立空项目夹具）', () => {
  test.beforeEach(async () => {
    await resetVault('e2e-vault-m1');
    await rm(path.join(E2E_VAULT, '20_项目'), { recursive: true, force: true });
  });

  test('asks the three framing questions before drafting an inferred contract and issue tree', async ({ browser }) => {
    const { page, context } = await openAs(browser, 'senior');
    const vault = createVault(E2E_VAULT);
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    try {
      await page.goto('/');
      for (const text of ['我的项目', '＋ 新建项目', '新项目会自动读取团队资料库和以往已确认的决定']) await expect(page.getByText(text, { exact: true })).toBeVisible();
      await expect(page.getByTestId('project-card')).toHaveCount(0);
      await page.getByTestId('new-project').click();
      await expect(page).toHaveURL(/\/new$/);
      for (const id of ['contract-empty', 'tree-empty', 'framing-chat', 'chat-composer']) await expect(page.getByTestId(id)).toBeVisible();
      for (const text of ['未命名项目', '草稿', '决策契约', '【待输入 Main Question，定义要支持的决策】', '议题树与工作线', '【待输入 Main Question 进行 Workstream 拆解】', '和 AI 定义问题']) await expect(page.getByText(text, { exact: true })).toBeVisible();
      const created = page.waitForResponse((r) => r.url().endsWith('/api/project/create') && r.request().method() === 'POST');
      const topic = '个人 AI 市场将如何演进，对联想意味着什么？';
      await page.getByTestId('chat-input').fill(topic);
      await page.getByTestId('chat-send').click();
      const response = await created;
      expect(response.status()).toBe(200);
      const project = await response.json() as { name: string; projectPath: string };
      const first = page.getByTestId('question-card').filter({ hasText: '先定三件事' });
      await expect(first).toHaveAttribute('data-state', 'input-available');
      for (const text of ['这次研究要支撑什么决定', '时间和地域', '哪些不研究']) await expect(first).toContainText(text);
      expect(await vault.exists(`${project.projectPath}/决策契约.md`)).toBe(false);
      await expect(page.getByTestId('contract-empty')).toBeVisible();
      const choice = `${M1_CONTRACT.decision}；${M1_CONTRACT.horizon}；${M1_CONTRACT.geography}；不研究${M1_CONTRACT.out_of_scope.join('和')}`;
      await answerQuestion(page, '先定三件事', choice);
      await answerQuestion(page, '题目定成', '就按这个拆');
      await expect(page.getByTestId('contract-card')).toHaveAttribute('data-status', '推断');
      await expect(page.getByTestId('issue-tree')).toBeVisible();
      await expect(page.getByTestId('assign-owners')).toHaveText('确定，指派负责人');
      for (const text of ['2027', '2028–2030', '全球', '企业级 AI 基础设施']) await expect(page.getByTestId('contract-card')).toContainText(text);
      const contract = await vault.readTyped(`${project.projectPath}/决策契约.md`, 'contract');
      expect(contract.note.approved_by).toBeNull();
      expect(contract.note.approved_at).toBeNull();
      expect(contract.note.original_question).toBe(topic);
      const tree = page.getByTestId('issue-tree');
      await expect(tree.getByTestId('issue-line')).toHaveCount(2);
      await expect(tree.getByTestId('issue-item')).toHaveCount(8);
      for (const id of ['M1', 'L2']) await expect(tree.locator(`[data-item="${id}"]`)).toBeVisible();
      await expectReaderWords(page);
      expect(errors).toEqual([]);
      await page.screenshot({ path: test.info().outputPath('2.1-inferred-contract.png'), fullPage: true });
    } finally { await context.close(); }
  });
});

const M1_PATH = '20_项目/个人AI战略/M1 用户持续使用';
const M1_URL = `/workspace/${encodeURIComponent('个人AI战略')}/${encodeURIComponent('M1 用户持续使用')}`;

test.describe('2.2–2.14 契约、研究计划、意见、调查计划、文件、执行、报告、访谈、追加分析、确认、存入、复用、配置', () => {
  test.describe.configure({ mode: 'serial' });
  let junior: RoleWindow;
  let senior: RoleWindow;
  /** The investigation 2.5 creates; 2.7–2.10 work in it. */
  let investigation = '';
  const researchUrl = () => `${M1_URL}/research/${encodeURIComponent(investigation)}`;
  test.beforeAll(async ({ browser }) => {
    await resetVault('e2e-vault-m1');
    junior = await openAs(browser, 'junior-a');
    senior = await openAs(browser, 'senior');
  });
  test.afterAll(async () => { await Promise.all([junior?.context.close(), senior?.context.close()]); });

  test('2.2 Senior confirms the inferred contract and the assigned issue tree', async () => {
    const { page } = senior;
    const vault = createVault(E2E_VAULT);
    await page.goto('/');
    const projects = (await vault.list('20_项目')).filter((p) => p.kind === 'dir');
    await expect(page.getByTestId('project-card')).toHaveCount(projects.length);
    for (const project of projects) {
      const dirs = (await vault.list(project.path)).filter((p) => p.kind === 'dir');
      const workspaces = [];
      let reports = 0;
      for (const dir of dirs) {
        if (!(await vault.exists(`${dir.path}/workspace.md`))) continue;
        workspaces.push(dir);
        for (const investigation of await vault.list(`${dir.path}/调查`).catch(() => [])) {
          if (investigation.kind === 'dir') reports += (await vault.list(investigation.path)).filter((f) => /^报告 v\d+\.md$/.test(f.name)).length;
        }
      }
      let decisions = 0;
      for (const entry of await vault.list(`${project.path}/决策`).catch(() => [])) {
        if (entry.kind === 'file' && (await vault.read(entry.path)).data.status === '已确认') decisions++;
      }
      await expect(page.locator(`[data-testid="project-card"][data-project="${project.name}"]`).getByTestId('project-card-counts')).toHaveText(`工作区 ${workspaces.length} · 报告 ${reports} · 已确认决定 ${decisions}`);
    }
    await page.locator('[data-testid="project-card"][data-project="个人AI战略"]').click();
    for (const text of ['决策契约', '原题', '决策负责人', '时间', '要做的决定', '地域', '产品范围', '不研究', '议题树与工作线', '要回答的问题：', '确定，指派负责人']) await expect(page.getByText(text, { exact: true })).toBeVisible();
    await expect(page.getByTestId('contract-card')).toHaveAttribute('data-status', '推断');
    await expect(page.getByTestId('issue-tree')).toBeVisible();
    await expect(page.getByTestId('issue-line')).toHaveCount(2);
    for (const line of ['A', 'B']) await expect(page.locator(`[data-testid="issue-line"][data-line="${line}"]`)).toBeVisible();
    await expect(page.locator('[data-testid="issue-item"][data-item="L2"]')).toHaveAttribute('data-status', 'waiting');
    await expect(page.locator('[data-testid="issue-item"][data-item="L2"]')).toContainText('等 M1 的决定');
    await page.getByTestId('assign-owners').click();
    await expect(page.getByTestId('contract-card')).toHaveAttribute('data-status', '已确认');
    await expect(page.getByTestId('assign-owners')).toHaveCount(0);
    const c = await vault.readTyped('20_项目/个人AI战略/决策契约.md', 'contract');
    expect(c.note.approved_by).toBe('Senior');
    expect(c.note.approved_at).toBeTruthy();
    await expectReaderWords(page);
    await page.screenshot({ path: test.info().outputPath('2.2-confirmed-contract.png'), fullPage: true });
  });

  test('2.3 Junior composes the actual M1 research plan with twelve questions and four key questions', async () => {
    const { page } = junior;
    await page.goto(M1_URL);
    await expect(page.getByTestId('flow-bar')).toHaveAttribute('data-current', '1');
    // 复核 B1/B2: the title and the line come from the issue tree
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('M1 哪些用户会持续使用');
    await expect(page.getByTestId('workspace-origin')).toContainText('来自议题树「市场如何演进」');
    await expect(page.getByText('和 AI 讨论 · 研究计划', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: '开始共创研究计划', exact: true }).click();
    await answerQuestion(page, '这项研究要支撑什么决策？', M1_CONTRACT.decision);
    await answerQuestion(page, '就按这个拆？', '就按这个拆');
    await expect(page.getByTestId('chat-timeline').getByText(/v1 拆好了/).first()).toBeVisible();
    await page.reload();
    const doc = page.getByTestId('plan-doc');
    await expect(doc).toBeVisible();
    await expect(doc).toContainText(M1_CORE);
    for (const text of ['要回答的问题', '要支撑的决策', '初步判断', '分支', '子问题', '初始假设（待验证）']) await expect(doc).toContainText(text);
    await expect(doc.locator('li')).toHaveCount(12);
    await expect(page.getByTestId('knockout-line')).toHaveCount(4);
    for (const k of M1_KEYS) await expect(doc.locator(`[data-testid="knockout-line"][data-key="${k.key}"]`)).toContainText('Knock-out（P0）：结果不理想就会改变 2027 年产品战略');
    await expect(page.getByTestId('ask-senior')).toHaveText('请 Senior 提意见');
    await expect(page.getByTestId('plan-final')).toHaveText('研究计划定了，往下做调查计划 →');
    await expectReaderWords(page);
    expect((await createVault(E2E_VAULT).readTyped(`${M1_PATH}/workplan v1.md`, 'workplan')).note.changes).toEqual([]);
    await page.screenshot({ path: test.info().outputPath('2.3-workplan-v1.png'), fullPage: true });
  });

  test('2.4 Senior replies from the inbox; Junior revises the real plan without losing its tree or comment trail', async () => {
    const { page } = junior;
    const vault = createVault(E2E_VAULT);
    const before = (await vault.read(`${M1_PATH}/workplan v1.md`)).body;
    expect(before).toContain('跨设备对所有用户都有价值');
    await page.getByTestId('ask-senior').click();
    await page.getByLabel('要他看什么（摘要）').fill('请看 M1 的 12 个子问题和 K1–K4，尤其跨设备的适用范围。');
    await page.getByLabel('请他重点看（一行一条，最多 8 条）').fill('K3 是否把跨设备当成所有用户的普遍价值');
    await page.getByTestId('send-for-opinion-confirm').click();
    await expect(page.getByTestId('opinion-pending')).toContainText('已发给 Senior，等回复（不挡你）');
    await expect(page.getByTestId('plan-final')).toBeEnabled();
    const opinion = '不要把跨设备当成所有用户的普遍价值。先区分哪些用户、哪些重复任务真正受益；如果没有独立增量，就缩为细分场景。';
    const s = senior.page;
    await s.goto('/inbox');
    const item = s.getByTestId('inbox-item').filter({ hasText: 'M1 用户持续使用' });
    await expect(item).toHaveAttribute('data-kind', 'opinion');
    await item.getByRole('link').click();
    await expect(s.getByRole('heading', { name: '待你处理', exact: true })).toBeVisible();
    for (const text of ['研究计划只是来征求意见，不卡流程；报告要你确认，确认以后才会作为项目产出存入文件管理', '你的意见', '稍后', '看过了，没有意见', '发送意见']) await expect(s.getByText(text, { exact: true })).toBeVisible();
    for (const id of ['opinion-input', 'opinion-later', 'opinion-none', 'opinion-send', 'plan-doc']) await expect(s.getByTestId(id)).toBeVisible();
    await s.getByTestId('opinion-input').fill(opinion);
    const sent = s.waitForResponse((r) => r.url().endsWith('/api/workspace/review/decision') && r.request().method() === 'POST');
    await s.getByTestId('opinion-send').click();
    expect((await sent).status()).toBe(200);
    await expect(s.getByTestId('opinion-input')).toHaveCount(0);
    await expectReaderWords(s);
    await page.reload();
    await page.getByTestId('tab-comments').click();
    const comment = page.getByTestId('comment-card');
    await expect(comment).toContainText(opinion);
    await comment.getByRole('button', { name: '和 AI 一起解读', exact: true }).click();
    await answerQuestion(page, 'Senior 这条意见想达成什么？', '区分真正受益的用户和重复任务，不把跨设备当成普遍价值');
    await answerQuestion(page, '怎么改？', '收窄跨设备假设，并在 K3 加入三个竞争解释与通用助手对照');
    await expect(page.getByTestId('chat-timeline')).toContainText('研究计划 v2 写好了，已关联 Senior 的意见');
    await page.reload();
    await page.getByTestId('tab-workplan').click();
    await expect(page.getByText('研究计划 v2', { exact: true })).toBeVisible();
    await expect(page.getByTestId('plan-diff-badge')).toHaveText('v1 → v2 已标出修改');
    await expect(page.getByTestId('plan-doc').locator('li')).toHaveCount(12);
    await expect(page.getByTestId('knockout-line')).toHaveCount(4);
    await expect(page.getByTestId('plan-doc')).toContainText('跨设备只在电脑到手机接续的特定任务中明显，不是普遍价值');
    const change = page.getByTestId('change-card');
    await expect(change).toHaveAttribute('data-traced', 'true');
    await expect(change).toContainText('对应意见 Senior ·');
    await expect(change).toContainText(opinion);
    expect((await vault.read(`${M1_PATH}/workplan v1.md`)).body).toBe(before);
    const v2 = await vault.readTyped(`${M1_PATH}/workplan v2.md`, 'workplan');
    expect(v2.note.changes[0].comment).toMatch(/\/review\/G1 .*#\^m1\]\]$/);
    expect(v2.body).toContain(M1_PLAN.question);
    expect(v2.body).toContain('H1 有持续增量；H2 没有独立增量；H3 被授权成本抵消');
    await expectReaderWords(page);
    await page.screenshot({ path: test.info().outputPath('2.4-workplan-v2.png'), fullPage: true });
  });

  test('2.5 Junior drafts the investigation plan, with three competing hypotheses under K3, before execution', async () => {
    const { page } = junior;
    await page.getByTestId('plan-final').click();
    await expect(page).toHaveURL(new RegExp(`${M1_URL}/research$`));
    const name = attemptName('M1 跨设备价值', test.info().retry);
    investigation = name;
    await page.getByLabel('新调查的名字').fill(name);
    await page.getByRole('button', { name: '新建调查', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/research/${encodeURIComponent(name)}$`));
    await expect(page.getByTestId('research-chat')).toBeVisible();
    await page.getByLabel('给 AI 的消息').fill('请按 Senior 的意见，先调查 K3 的跨设备独立增量。');
    await page.getByRole('button', { name: '发送', exact: true }).click();
    await answerQuestion(page, '先验证哪个关键问题？', 'K3 跨设备是否解决重复出现的真实问题');
    await answerQuestion(page, '这个答案要支撑什么决策？', M1_PLAN.purpose);
    await answerQuestion(page, '“没有价值”和“有价值但被授权成本抵消”要不要分开验证？', '分开：对应的产品动作不同');
    const plan = page.getByTestId('investigation-plan');
    await expect(plan).toBeVisible();
    await expect(page.getByRole('heading', { name: /^和 AI 讨论 · 调查计划/ })).toBeVisible();
    for (const text of ['假设驱动', '为什么查：', '问题树', '竞争假设，和每个假设要什么证据', '假设', '必须成立的条件', '要什么证据', '去哪里查', '证伪标准']) await expect(plan).toContainText(text);
    const k3 = plan.locator('[data-key="K3"]');
    await expect(k3.getByTestId('hypothesis-row')).toHaveCount(3);
    for (const [index, h] of ['H1', 'H2', 'H3'].entries()) {
      const row = k3.locator(`[data-testid="hypothesis-row"][data-h="${h}"]`);
      await expect(row).toContainText(M1_PLAN.claims[index].statement);
      await expect(row).toContainText(M1_PLAN.claims[index].conditions[0].evidence_needed);
      await expect(row).toContainText(M1_PLAN.claims[index].conditions[0].where);
    }
    await expect(page.getByTestId('start-run')).toHaveText('计划定了，开始调查 →');
    const vault = createVault(E2E_VAULT);
    const p = await vault.readTyped(`${M1_PATH}/调查/${name}/计划 v1.md`, 'research_plan');
    expect(p.note.approved_by_owner).toBeNull();
    expect(await vault.exists(`${M1_PATH}/调查/${name}/报告 v1.md`)).toBe(false);
    await expectReaderWords(page);
    await expectFitsWindow(page, { height: true }); // 复核 D
    await page.screenshot({ path: test.info().outputPath('2.5-investigation-plan.png'), fullPage: true });
  });

  test('2.6 the files page: five groups; the chat says TechRadar is unrelated and, once agreed, it is unticked at once; Pew starred', async () => {
    const { page } = junior;
    await page.goto(`${M1_URL}/files`);
    for (const text of ['默认全选 · 取消勾选的 AI 不读 · ★ 为优先阅读', '＋ 上传文件', '按你的任务找资料']) await expect(page.getByText(text, { exact: true }).first()).toBeVisible();
    expect(await page.getByTestId('files-group').evaluateAll((els) => els.map((e) => e.getAttribute('data-group')))).toEqual(['outputs', 'background', 'company', 'public', 'assets']);
    // each group's heading is its name and how many files it holds
    for (const [i, label] of ['项目产出', '项目背景', '公司资料', '公开数据源', '公司资产'].entries()) await expect(page.getByTestId('files-group').nth(i).locator('h3')).toContainText(label);
    for (const id of ['file-check', 'file-star', 'web-toggle']) await expect(page.getByTestId(id).first()).toBeVisible();
    const techRadar = page.getByTestId('file-row').filter({ hasText: 'TechRadar' });
    await expect(techRadar).toHaveAttribute('data-checked', 'true');
    const chat = page.getByTestId('files-chat');
    await chat.getByTestId('chat-input').fill('TechRadar 那篇讲企业采购的，和 M1 有关吗？');
    await chat.getByTestId('chat-send').click();
    const card = chat.getByTestId('selection-proposal');
    await expect(card).toContainText('不读：TechRadar');
    await expect(chat).toContainText('关系不大：M1 研究的是个人用户会不会持续使用，企业采购属于别的论点');
    // nothing changes until the analyst agrees
    await expect(techRadar).toHaveAttribute('data-checked', 'true');
    // T37 补 / 走查截图: the list takes the agreed selection at once and saves in order, so a star clicked right after
    // 同意 (before its save and the server render come back) builds on it — it used to save the old list and put TechRadar back
    const saved = page.waitForResponse((r) => r.url().endsWith('/api/workspace/selection') && r.request().method() === 'POST' && (r.request().postData() ?? '').includes('Pew'));
    await card.getByTestId('selection-accept').click();
    await page.getByTestId('file-row').filter({ hasText: 'Pew 2026-06 Americans and AI 2026' }).getByTestId('file-star').click();
    expect((await saved).status()).toBe(200);
    await expect(card).toContainText('已按这个调整。');
    await expect(techRadar).toHaveAttribute('data-checked', 'false');
    const selection = JSON.parse(await readVaultFile(`${M1_PATH}/资料选择.json`)) as { excluded: string[]; starred: string[]; web: boolean };
    expect(selection.excluded).toEqual(['10_资料库/TechRadar 2025-07 企业并不急着买AI PC.md']);
    expect(selection.starred).toEqual(['10_资料库/Pew 2026-06 Americans and AI 2026.md']);
    expect(selection.web).toBe(true);
    await expectReaderWords(page);
    await page.screenshot({ path: test.info().outputPath('2.6-files.png'), fullPage: true });
  });

  test('2.7 the run: it reads the task first, searches the web by itself (S10, S12), and stops K3 after two rounds with nothing new', async () => {
    const { page } = junior;
    await page.goto(researchUrl());
    await page.getByTestId('start-run').click();
    await page.getByTestId('run-option-full').click();
    await page.getByRole('button', { name: '确认批准，开始完整调查' }).click();
    await expect(page.getByTestId('step-run')).toHaveAttribute('data-state', 'active');
    await expect(page.getByTestId('run-progress')).toHaveAttribute('data-running', 'false', { timeout: 300_000 });
    for (const text of ['执行', '每一步都留痕，可点开', '检索与判断卡片']) await expect(page.getByText(text, { exact: true }).first()).toBeVisible();
    await expect(page.getByTestId('run-steps')).toBeVisible();
    await expect(page.getByTestId('run-step').first()).toContainText('读取决策契约、研究计划和 Senior 意见');
    await expect(page.locator('[data-testid="search-card"][data-source="web"]').first()).toBeVisible();
    const stop = page.locator('[data-testid="search-card"][data-stop="true"]');
    await expect(stop).toHaveCount(1);
    await expect(stop).toContainText('连续 2 轮无新证据');
    const sources = await readdir(path.join(E2E_VAULT, '10_资料库'));
    for (const s of ['Recon Analytics 2026-10 AI 用户切换工具.md', 'Gartner 2026-05 消费者要 AI 帮忙购物，不要 AI 替自己下单.md']) expect(sources).toContain(s);
    // the file the analyst unticked in 2.6 was never read
    expect(await readVaultFile(`${M1_PATH}/日志.md`)).not.toMatch(/读 10_资料库\/TechRadar/);
    await expectReaderWords(page);
    await expectFitsWindow(page, { height: true }); // 复核 D
    await page.screenshot({ path: test.info().outputPath('2.7-run.png'), fullPage: true });
  });

  test('2.8 the report: So what, three reasons with their kind, K2 and K3 in the gap table; a citation opens with its checks', async () => {
    const { page } = junior;
    // the run does not jump to the report by itself: 查看报告 opens the newest version
    await page.getByTestId('run-view-report').click();
    await expect(page.getByTestId('step-report')).toHaveAttribute('data-state', 'active');
    await expect(page.getByRole('tabpanel')).toContainText('报告 v1');
    for (const text of ['So what', '为什么（三条支撑）', '缺乏信息、需要另外验证的问题', '问题', '公开资料缺什么', '怎么验证', '下一步：看访谈建议 →']) await expect(page.getByText(text, { exact: true }).first()).toBeVisible();
    await expect(page.getByTestId('report-sowhat')).toContainText('联想应先找出会持续使用的任务');
    await expect(page.getByTestId('report-reason')).toHaveCount(3);
    expect(await page.getByTestId('basis-tag').evaluateAll((els) => els.map((e) => e.getAttribute('data-kind')))).toEqual(['事实', '事实', '事实']);
    const gaps = page.getByTestId('gap-table');
    await expect(gaps).toContainText('K2');
    await expect(gaps).toContainText('K3');
    // nothing on the page says a number without its source
    await expect(page.getByTestId('report-reason').first()).toContainText('49%');
    await page.getByTestId('report-reason').first().getByTestId('footnote-ref').first().click();
    const popover = page.getByTestId('cite-popover');
    for (const text of ['报告引用的这一句', '原文上下文', '三道核验', '能支持', '不能支持', '打开原网页', '关闭']) await expect(popover.getByText(text, { exact: true }).first()).toBeVisible();
    for (const id of ['cite-checks', 'cite-can', 'cite-cannot']) await expect(popover.getByTestId(id)).toBeVisible();
    // 走查截图 2.8: the details scroll inside their box; they used to spill out of it over the report text below
    expect(await page.getByTestId('cite-scroll').evaluate((el) => el.getBoundingClientRect().bottom <= el.closest('aside')!.getBoundingClientRect().bottom + 1 && el.scrollHeight >= el.clientHeight)).toBe(true);
    await page.screenshot({ path: test.info().outputPath('2.8-citation.png'), fullPage: true });
    await popover.getByRole('button', { name: '关闭', exact: true }).click();
    await expectReaderWords(page);
    await expectFitsWindow(page, { height: true }); // 复核 D
    await page.screenshot({ path: test.info().outputPath('2.8-report.png'), fullPage: true });
  });

  test('2.9 the interview advice: who to ask, what, to verify what, and the rule agreed before', async () => {
    const { page } = junior;
    await page.getByTestId('next-interview').click();
    for (const text of ['找谁', '问什么', '为了验证什么', '验证规则（执行前约定）', '访谈做完了，去追加分析 →']) await expect(page.getByText(text, { exact: true }).first()).toBeVisible();
    await expect(page.getByTestId('interview-table')).toBeVisible();
    await expect(page.getByTestId('interview-row').first()).toBeVisible();
    // E: nine asks, grouped by person — one 找谁 cell per person, not one per ask; 复核 F: nobody is the enterprise buyer
    await expect(page.getByTestId('interview-row')).toHaveCount(9);
    await expect(page.locator('[data-testid="interview-row"] td[rowspan]')).toHaveCount(3);
    await expect(page.getByTestId('interview-table')).not.toContainText('企业 IT');
    await expect(page.getByTestId('interview-rule')).toContainText('访谈最多把判断提到“访谈支持”');
    await expect(page.getByTestId('export-outline')).toBeVisible();
    await expectReaderWords(page);
    await expectFitsWindow(page, { height: true }); // 复核 D
    await page.screenshot({ path: test.info().outputPath('2.9-interviews.png'), fullPage: true });
  });

  test('2.10 three interviews in: only K3 and K4 are judged again, K3 goes to 访谈支持 and not to 成立', async () => {
    const { page } = junior;
    await page.getByRole('button', { name: '访谈做完了，去追加分析 →', exact: true }).click();
    await expect(page.getByText('和 AI 讨论 · 追加分析', { exact: true })).toBeVisible();
    const dir = 'tests/fixtures/e2e-vault-m1-interviews/20_项目/个人AI战略/访谈';
    const files = await Promise.all((await readdir(dir)).filter((f) => f.endsWith('.md')).map(async (f) => ({ name: f, mimeType: 'text/markdown', buffer: await readFile(path.join(dir, f)) })));
    expect(files).toHaveLength(3);
    await page.getByLabel('模拟访谈').check();
    const answered = page.waitForResponse((r) => r.url().endsWith('/api/research/interviews') && r.request().method() === 'POST', { timeout: 120_000 });
    const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByTestId('upload-interview').click()]);
    await chooser.setFiles(files);
    expect((await answered).status()).toBe(200);
    const changes = page.getByTestId('change-table');
    await expect(changes).toBeVisible({ timeout: 60_000 });
    for (const text of ['报告 v2', '因为追加了访谈，结论变了什么']) await expect(page.getByText(text, { exact: true }).first()).toBeVisible();
    const row = (k: string) => changes.locator('tr').filter({ hasText: k });
    await expect(row('K3')).toContainText('证据不足');
    await expect(row('K3')).toContainText('访谈支持');
    await expect(row('K4')).toContainText('部分支持');
    for (const k of ['K1', 'K2']) await expect(row(k)).toContainText('不变（访谈没有涉及）');
    await expect(changes).not.toContainText('成立 |');
    // the analyst asks whether K3 can be 成立: no — the rule agreed before the interviews
    await page.getByTestId('explanation-target').selectOption('key-K3');
    await page.getByTestId('explanation-question').fill('能改成成立吗？');
    await page.getByTestId('explanation-send').click();
    await expect(page.getByTestId('explanation-answer')).toContainText('不能');
    // 复核 D: the conversation and report v2 are both on screen, side by side (the report used to leave the view)
    await expect(page.getByTestId('explanation-answer')).toBeInViewport();
    await expect(page.getByTestId('reanalysis-sowhat')).toBeInViewport();
    await expectFitsWindow(page, { height: true });
    // …and asks what these interviews did change: the answer is the saved re-analysis, not a model's guess
    await page.getByTestId('explanation-question').fill('这些访谈能改哪些判断？');
    await page.getByTestId('explanation-send').click();
    await expect(page.getByTestId('explanation-answer')).toContainText('访谈支持');
    await expect(page.getByTestId('explanation-answer')).toContainText('访谈没有涉及');
    await expect(page.getByTestId('submit-report')).toBeVisible();
    await expect(page.getByText('报告没问题，提交给 Senior →', { exact: true })).toBeVisible();
    await expectReaderWords(page);
    await page.screenshot({ path: test.info().outputPath('2.10-reanalysis.png'), fullPage: true });
  });

  test('2.11 submitted; Senior opens it from the inbox at step 6, the decision drafted as three fields, confirmed and stored', async () => {
    const { page } = junior;
    await page.getByTestId('submit-report').click();
    await page.getByTestId('submit-report-confirm').click();
    await expect(page.getByTestId('report-review-open')).toContainText('已提交给 Senior，等确认');
    const s = senior.page;
    await s.goto('/inbox');
    const item = s.getByTestId('inbox-item').filter({ hasText: 'M1 用户持续使用' }).filter({ has: s.locator('[data-kind="confirm"]') }).or(s.locator('[data-testid="inbox-item"][data-kind="confirm"]').filter({ hasText: 'M1 用户持续使用' }));
    await item.first().getByRole('link').first().click();
    await expect(s).toHaveURL(/step=confirm/);
    await expect(s.getByTestId('confirm-summary')).toContainText('验证范围收窄到电脑和手机之间来回接着做的日常工作'); // v2's So what (v6 2.10)
    await s.getByTestId('decision-draft').click();
    const card = s.locator('[data-testid="decision-card"][data-status="推断"]');
    await expect(card.getByTestId('decision-field')).toHaveCount(3);
    for (const text of ['决定 + 理由', 'AI 起草 · 待你确认', '决定', '理由', '适用边界', '可以直接改', '退回，写明理由', '确认，存入项目文件']) await expect(s.getByText(text, { exact: true }).first()).toBeVisible();
    for (const field of ['decision', 'reason', 'scope']) await expect(card.locator(`[data-testid="decision-field"][data-field="${field}"]`)).not.toHaveValue('');
    await expect(card.getByTestId('return-report')).toBeVisible();
    await expectReaderWords(s);
    await expectFitsWindow(s, { height: true }); // 复核 D
    await s.screenshot({ path: test.info().outputPath('2.11-confirm.png'), fullPage: true });
    await card.getByTestId('confirm-store').click();
    await expect(s.locator('[data-testid="decision-card"][data-status="已确认"]')).toHaveCount(1);
    const vault = createVault(E2E_VAULT);
    const decisions = (await vault.list('20_项目/个人AI战略/决策')).filter((e) => e.kind === 'file');
    const confirmed = await Promise.all(decisions.map((e) => vault.read(e.path)));
    expect(confirmed.filter((n) => n.data.status === '已确认')).toHaveLength(1);
    const reviews = await Promise.all((await vault.list(`${M1_PATH}/review`)).filter((e) => e.name.startsWith('结论')).map((e) => vault.read(e.path)));
    expect(reviews.some((r) => r.data.result === '通过')).toBe(true);
  });

  test('2.12 stored: the report, the decision and the interviews it used; only Senior can publish them as company assets', async () => {
    const s = senior.page;
    await s.goto(`${researchUrl()}?step=stored`);
    const list = s.getByTestId('stored-list');
    await expect(list).toBeVisible();
    for (const text of ['存入项目文件的 项目产出', '同一项目里的其他工作区看得到']) await expect(list).toContainText(text);
    const kinds = await s.getByTestId('stored-item').evaluateAll((els) => els.map((e) => e.getAttribute('data-kind')));
    expect(new Set(kinds)).toEqual(new Set(['报告', '决定', '访谈']));
    expect(kinds.filter((k) => k === '访谈')).toHaveLength(3);
    const report = s.locator('[data-testid="stored-item"][data-kind="报告"]');
    await expect(report).toContainText('报告 v2');
    await report.getByTestId('publish-asset').click();
    await expect(report).toContainText('已发布为公司资产');
    await expectReaderWords(s);
    await expectFitsWindow(s, { height: true }); // 复核 D
    await s.screenshot({ path: test.info().outputPath('2.12-stored.png'), fullPage: true });
    const { page } = junior;
    await page.goto(`${researchUrl()}?step=stored`);
    await expect(page.getByTestId('stored-list')).toBeVisible();
    await expect(page.getByTestId('publish-asset')).toHaveCount(0);
  });

  test('2.13 the next work line (L2) sees M1\'s decision and report among its project outputs, and reads the decision first', async ({ browser }) => {
    const b = await openAs(browser, 'junior-b');
    try {
      const { page } = b;
      await page.goto(`/workspace/${encodeURIComponent('个人AI战略')}/${encodeURIComponent('L2 凭什么赢')}/files`);
      const outputs = page.locator('[data-testid="files-group"][data-group="outputs"]');
      await expect(outputs).toContainText('跨设备先按场景验证');
      await expect(outputs).toContainText('报告 v2');
      const chat = page.getByTestId('files-chat');
      await chat.getByTestId('chat-input').fill('这次要先读什么？');
      await chat.getByTestId('chat-send').click();
      await expect(chat).toContainText(/① .*跨设备先按场景验证（项目里已确认的决定/);
      // 复核 P6: what it recommends is material (the decision, the report, sources), never the project note or the log
      await expect(chat).toContainText(/② .*报告 v2/);
      await expect(chat).not.toContainText(/[②③④] (项目|日志|决策契约)(\s|$)/);
      await expectReaderWords(page);
      await page.screenshot({ path: test.info().outputPath('2.13-l2-files.png'), fullPage: true });
    } finally {
      await b.context.close();
    }
  });

  test('2.14 the config page: team, models by role, and the rules that do not change with the team', async () => {
    const s = senior.page;
    await s.goto('/config');
    for (const text of ['团队与模型配置', '方法库', '研究计划必须覆盖的视角', '角色', '资料来源', '模型（按角色）', '判断', '执行', '独立复核', '不随团队变的工作规则']) await expect(s.getByText(text, { exact: true }).first()).toBeVisible();
    await expect(s.getByText('换团队、换模型只改这里；工作规则和流程不变')).toBeVisible();
    for (const id of ['team-config', 'model-roles', 'fixed-rules']) await expect(s.getByTestId(id)).toBeVisible();
    // the config page names the models by their ids on purpose
    await expectReaderWords(s, /（[a-z0-9.-]+）$/i);
    // 复核 F: the team in v6 2.14 words, and what each model role is used for
    await expect(s.getByTestId('team-config')).toContainText('用户、竞争、经济性、中国市场、监管');
    await expect(s.getByTestId('model-roles')).toContainText('引用的第三道核验');
    await s.screenshot({ path: test.info().outputPath('2.14-config.png'), fullPage: true });
  });
});
