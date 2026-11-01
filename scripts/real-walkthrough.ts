/**
 * D-64 T56: the v6 2.2–2.14 walkthrough against REAL models, driven by a browser the way a person would. Run it only
 * when the owner has asked for a real-model run (the development rule D7 forbids it otherwise); keys stay in the
 * environment and are never printed. It is not a test: the model's questions and wording differ every run, so it
 * answers each question card with the v6 answer it matches (or the first option), and records what happened.
 *
 *   pnpm exec tsx scripts/demo-snapshot.ts make m1                 # .scratch/m1
 *   cp -R .scratch/m1 .scratch/m1-real                             # the copy this run writes into
 *   VAULT_DIR=.scratch/m1-real NEXT_DIST_DIR=real pnpm exec next dev -p 3005 -H 127.0.0.1   # no MODEL_MOCK, no WEB_TOOLS=mock
 *   pnpm exec tsx scripts/real-walkthrough.ts --base http://127.0.0.1:3005 --vault .scratch/m1-real --out .scratch/real-run [--from 2.5] [--to 2.7]
 *
 * Every step writes a screenshot and a line to <out>/run.log; the vault holds the rest (notes, logs, reports).
 */
import { appendFile, mkdir, readdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { chromium, type Browser, type Locator, type Page } from '@playwright/test';

const arg = (name: string, fallback: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const BASE = arg('base', 'http://127.0.0.1:3005');
const VAULT = arg('vault', '.scratch/m1-real');
const OUT = arg('out', '.scratch/real-run');
/** Steps are 2.2 … 2.14: compared by the number after "2." (2.14 comes after 2.6). */
const minor = (step: string) => Number(step.split('.')[1] ?? step);
const FROM = minor(arg('from', '2.2'));  // 2.1 only when asked: it needs a copy without the 个人AI战略 project
const TO = minor(arg('to', '2.14'));
const INVESTIGATION = arg('investigation', 'M1 跨设备价值');

const PROJECT = '个人AI战略';
const M1 = 'M1 用户持续使用';
const M1_PATH = `20_项目/${PROJECT}/${M1}`;
const M1_URL = `/workspace/${encodeURIComponent(PROJECT)}/${encodeURIComponent(M1)}`;
const RESEARCH_URL = `${M1_URL}/research/${encodeURIComponent(INVESTIGATION)}`;
const MIN = 60_000;

const t0 = Date.now();
async function log(line: string): Promise<void> {
  const text = `[${((Date.now() - t0) / 60000).toFixed(1)}m] ${line}`;
  console.log(text);
  await appendFile(path.join(OUT, 'run.log'), `${text}\n`);
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const inVault = (p: string) => existsSync(path.join(VAULT, p));

/** What a person in v6 answers to each kind of question; anything else gets the first option (or a short go-ahead). */
const ANSWERS: { when: RegExp; option?: RegExp; text: string }[] = [
  { when: /要支撑什么决策|支撑什么决定/, option: /定位|优先|投入|卖点|决策/, text: '战略定位、优先机会、资源配置：决定跨设备是否作为 2027 年面向所有用户的主打卖点' },
  { when: /就按这个|这样拆|确认.*题目|题目定成/, option: /就按这个|可以|确认|是/, text: '就按这个拆' },
  { when: /想达成什么|意图|想要什么/, option: /区分|受益|普遍/, text: '区分真正受益的用户和重复任务，不把跨设备当成普遍价值' },
  { when: /怎么改|如何修改|改法/, option: /收窄|竞争|K3/, text: '收窄跨设备假设，并在 K3 加入三个竞争解释与通用助手对照' },
  { when: /先验证|先查|哪个关键问题|优先/, option: /K3|跨设备/, text: 'K3 跨设备是否解决重复出现的真实问题' },
  { when: /分开验证|分开|合并/, option: /分开/, text: '分开：对应的产品动作不同' },
];

/** The chat box of the workspace page (研究计划) and of the research page (调查计划). */
const sayInWorkspace = (page: Page, text: string) => async () => {
  await page.getByTestId('chat-input').fill(text);
  await page.getByTestId('chat-send').click();
};
const sayInResearch = (page: Page, text: string) => async () => {
  await page.getByLabel('给 AI 的消息').fill(text);
  await page.getByRole('button', { name: '发送', exact: true }).click();
};

/** In-flight requests to the agent, so "idle" means the model is not working (useChat sends the next turn by itself). */
function trackAgent(page: Page): () => number {
  let inflight = 0;
  const isAgent = (url: string) => /\/api\/(agent|research\/execute)/.test(url);
  page.on('request', (r) => { if (isAgent(r.url())) inflight++; });
  page.on('requestfinished', (r) => { if (isAgent(r.url())) inflight = Math.max(0, inflight - 1); });
  page.on('requestfailed', (r) => { if (isAgent(r.url())) inflight = Math.max(0, inflight - 1); });
  return () => inflight;
}

async function answerCard(card: Locator): Promise<string> {
  const question = (await card.innerText()).replace(/\s+/g, ' ').slice(0, 200);
  const rule = ANSWERS.find((a) => a.when.test(question));
  const options = card.getByRole('group', { name: '选项' }).getByRole('button');
  const n = await options.count();
  let picked = '';
  if (n > 0) {
    const labels = await options.allInnerTexts();
    let i = rule?.option ? labels.findIndex((l) => rule.option!.test(l)) : -1;
    if (i < 0) i = labels.findIndex((l) => !/自己写|我要改|其他/.test(l));
    if (i < 0) i = 0;
    await options.nth(i).click();
    picked = labels[i].trim();
  } else {
    await card.getByLabel('补充回答').fill(rule?.text ?? '按你的建议来，继续。');
    picked = `（自己写）${rule?.text ?? '按你的建议来，继续。'}`;
  }
  await card.getByRole('button', { name: '发送回答' }).click();
  return `问：${question.slice(0, 80)} → 答：${picked.slice(0, 60)}`;
}

/**
 * Let the model work: answer each pending question card, wait while it works, stop when `done` says so (or when it
 * has been idle with nothing to answer for a while, which the caller reports).
 */
async function drive(page: Page, busy: () => number, done: () => Promise<boolean>, timeoutMs: number, label: string, nudge?: () => Promise<void>): Promise<boolean> {
  const until = Date.now() + timeoutMs;
  let idleSince = 0;
  let nudges = 0;
  let lastNote = Date.now();
  while (Date.now() < until) {
    if (await done()) return true;
    if (Date.now() - lastNote > 60_000) {
      lastNote = Date.now();
      await log(`  ${label} 等待中：进行中的请求 ${busy()}，待回答的卡片 ${await page.locator('[data-testid="question-card"][data-state="input-available"]').count()}`);
    }
    if (busy() > 0) { idleSince = 0; await sleep(2000); continue; }
    const card = page.locator('[data-testid="question-card"][data-state="input-available"]').last();
    if (await card.count()) {
      await log(`  ${label} ${await answerCard(card)}`);
      idleSince = 0;
      await sleep(3000);
      continue;
    }
    idleSince ||= Date.now();
    // a turn that ended without the result (a stream cut off upstream, a model that stopped early): say 继续, as a person would
    if (Date.now() - idleSince > 60_000 && nudge && nudges < 2) {
      nudges++;
      await log(`  ${label} 停住了，没有结果：发“继续”（第 ${nudges} 次）`);
      await nudge();
      idleSince = 0;
      await sleep(5000);
      continue;
    }
    if (Date.now() - idleSince > 90_000) return done();
    await sleep(2000);
  }
  return done();
}

async function shot(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: true }).catch(() => undefined);
}

async function openAs(browser: Browser, role: string) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.addCookies([{ name: 'sw-role', value: role, url: BASE }]);
  context.setDefaultTimeout(5 * MIN);
  const page = await context.newPage();
  page.on('pageerror', (e) => void log(`  [${role}] page error: ${String(e).slice(0, 200)}`));
  return { context, page, busy: trackAgent(page) };
}

const step = (n: number) => n >= FROM && n <= TO;

async function main() {
  await mkdir(OUT, { recursive: true });
  await log(`real walkthrough ${BASE} vault=${VAULT} steps 2.${FROM}–2.${TO}`);
  const browser = await chromium.launch();
  const senior = await openAs(browser, 'senior');
  const junior = await openAs(browser, 'junior-a');
  try {
    // 2.1 runs on its own copy without the 个人AI战略 project (--from 2.1 --to 2.1 against that copy's server)
    if (step(1)) {
      const { page, busy } = senior;
      await page.goto(`${BASE}/new`);
      const created = page.waitForResponse((r) => r.url().endsWith('/api/project/create') && r.request().method() === 'POST', { timeout: 10 * MIN });
      await page.getByTestId('chat-input').fill('个人 AI 市场将如何演进，对联想意味着什么？');
      await page.getByTestId('chat-send').click();
      const project = (await (await created).json()) as { projectPath: string };
      const ok = await drive(page, busy, async () => inVault(`${project.projectPath}/决策契约.md`) && (await page.getByTestId('issue-tree').count()) > 0 && busy() === 0, 20 * MIN, '2.1', sayInWorkspace(page, '继续，把决策契约和议题树写出来。'));
      await shot(page, '2.1-new-project');
      await log(`2.1 新项目 ${project.projectPath}：${ok ? '契约和议题树写好了' : '没有写出来'}`);
    }

    if (step(2)) {
      const { page } = senior;
      await page.goto(`${BASE}/project/${encodeURIComponent(PROJECT)}`);
      const confirm = page.getByTestId('assign-owners');
      if (await confirm.count()) await confirm.click();
      await page.getByTestId('contract-card').waitFor();
      await shot(page, '2.2-project');
      await log('2.2 契约已确认');
    }

    if (step(3)) {
      const { page, busy } = junior;
      await page.goto(`${BASE}${M1_URL}`);
      await page.getByRole('button', { name: '开始共创研究计划', exact: true }).click();
      const ok = await drive(page, busy, async () => inVault(`${M1_PATH}/workplan v1.md`) && busy() === 0, 30 * MIN, '2.3', sayInWorkspace(page, '继续，把研究计划写出来。'));
      await page.reload();
      await shot(page, '2.3-workplan-v1');
      await log(`2.3 研究计划 v1 ${ok ? '写好了' : '没有写出来（看截图和日志）'}`);
      if (!ok) return;
    }

    if (step(4)) {
      const { page, busy } = junior;
      await page.goto(`${BASE}${M1_URL}`);
      await page.getByTestId('ask-senior').click();
      await page.getByLabel('要他看什么（摘要）').fill('请看 M1 的子问题和关键问题，尤其跨设备的适用范围。');
      await page.getByLabel('请他重点看（一行一条，最多 8 条）').fill('K3 是否把跨设备当成所有用户的普遍价值');
      // the request is written before Senior opens the inbox (a page opened first would not show it)
      const requested = page.waitForResponse((r) => r.url().endsWith('/api/workspace/review/request') && r.request().method() === 'POST');
      await page.getByTestId('send-for-opinion-confirm').click();
      await requested;
      const s = senior.page;
      await s.goto(`${BASE}/inbox`);
      await s.getByTestId('inbox-item').filter({ hasText: M1 }).first().getByRole('link').first().click();
      await s.getByTestId('opinion-input').fill('不要把跨设备当成所有用户的普遍价值。先区分哪些用户、哪些重复任务真正受益；如果没有独立增量，就缩为细分场景。');
      await s.getByTestId('opinion-send').click();
      await s.getByTestId('opinion-input').waitFor({ state: 'detached' });
      await shot(s, '2.4-senior-opinion');
      await page.reload();
      await page.getByTestId('tab-comments').click();
      await page.getByTestId('comment-card').first().getByRole('button', { name: '和 AI 一起解读', exact: true }).click();
      const ok = await drive(page, busy, async () => inVault(`${M1_PATH}/workplan v2.md`) && busy() === 0, 30 * MIN, '2.4', sayInWorkspace(page, '继续，按刚才的回答把研究计划 v2 写出来。'));
      await page.reload();
      await shot(page, '2.4-workplan-v2');
      await log(`2.4 研究计划 v2 ${ok ? '按意见写好了' : '没有写出来'}`);
      if (!ok) return;
    }

    if (step(5)) {
      const { page, busy } = junior;
      const dir = `${M1_PATH}/调查/${INVESTIGATION}`;
      if (!inVault(dir)) {
        await page.goto(`${BASE}${M1_URL}/research`);
        await page.getByLabel('新调查的名字').fill(INVESTIGATION);
        await page.getByRole('button', { name: '新建调查', exact: true }).click();
        await page.waitForURL(/\/research\/[^/]+$/);
      } else await page.goto(`${BASE}${RESEARCH_URL}`);
      await page.getByLabel('给 AI 的消息').fill('请按 Senior 的意见，先调查 K3 的跨设备独立增量；其余关键问题也要有竞争假设。');
      await page.getByRole('button', { name: '发送', exact: true }).click();
      const ok = await drive(page, busy, async () => inVault(`${dir}/计划 v1.md`) && busy() === 0, 30 * MIN, '2.5', sayInResearch(page, '继续，把调查计划 v1 写出来。'));
      await page.reload();
      await shot(page, '2.5-investigation-plan');
      await log(`2.5 调查计划 v1 ${ok ? '写好了' : '没有写出来'}`);
      if (!ok) return;
    }

    if (step(6)) {
      const { page, busy } = junior;
      await page.goto(`${BASE}${M1_URL}/files`);
      const chat = page.getByTestId('files-chat');
      await chat.getByTestId('chat-input').fill('TechRadar 那篇讲企业采购的，和 M1 有关吗？');
      await chat.getByTestId('chat-send').click();
      await drive(page, busy, async () => (await chat.getByTestId('selection-proposal').count()) > 0 && busy() === 0, 10 * MIN, '2.6');
      const proposal = chat.getByTestId('selection-proposal');
      if (await proposal.count()) {
        await proposal.getByTestId('selection-accept').click();
        await log('2.6 AI 建议不读 TechRadar，已同意');
      } else await log('2.6 AI 没有提出取消勾选（看截图里的回答）');
      await page.getByTestId('file-row').filter({ hasText: 'Pew 2026-06 Americans and AI 2026' }).getByTestId('file-star').click().catch(() => undefined);
      await sleep(2000);
      await shot(page, '2.6-files');
    }

    if (step(7)) {
      const { page } = junior;
      await page.goto(`${BASE}${RESEARCH_URL}?step=plan`);
      await page.getByTestId('start-run').click();
      await page.getByTestId('run-option-full').click();
      await page.getByRole('button', { name: '确认批准，开始完整调查' }).click();
      await log('2.7 计划已批准，完整调查开始（真实检索）');
      const running = page.getByTestId('run-progress');
      await running.waitFor();
      const until = Date.now() + 120 * MIN;
      while (Date.now() < until && (await running.getAttribute('data-running')) !== 'false') {
        await sleep(30_000);
        await log(`  2.7 进行中：${(await page.getByTestId('search-card').count())} 张检索卡`);
      }
      await shot(page, '2.7-run');
      await log(`2.7 调查结束：${(await page.getByTestId('run-result').innerText().catch(() => '（没有结果）')).replace(/\s+/g, ' ').slice(0, 200)}`);
    }

    if (step(8)) {
      const { page } = junior;
      await page.goto(`${BASE}${RESEARCH_URL}?step=report`);
      await page.getByTestId('report-sowhat').waitFor();
      await shot(page, '2.8-report');
      const ref = page.getByTestId('footnote-ref').first();
      if (await ref.count()) {
        await ref.click();
        await page.getByTestId('cite-popover').waitFor();
        await shot(page, '2.8-citation');
        await page.getByTestId('cite-popover').getByRole('button', { name: '关闭', exact: true }).click();
      }
      await log(`2.8 报告：${(await page.getByTestId('report-sowhat').innerText()).replace(/\s+/g, ' ').slice(0, 160)}`);
    }

    if (step(9)) {
      const { page } = junior;
      await page.goto(`${BASE}${RESEARCH_URL}?step=interview`);
      await page.getByTestId('interview-table').waitFor().catch(() => undefined);
      await shot(page, '2.9-interviews');
      await log(`2.9 访谈建议：${await page.getByTestId('interview-row').count()} 个问题`);
    }

    if (step(10)) {
      const { page } = junior;
      await page.goto(`${BASE}${RESEARCH_URL}?step=reanalysis`);
      const dir = 'tests/fixtures/e2e-vault-m1-interviews/20_项目/个人AI战略/访谈';
      const files = await Promise.all((await readdir(dir)).filter((f) => f.endsWith('.md')).map(async (f) => ({ name: f, mimeType: 'text/markdown', buffer: await readFile(path.join(dir, f)) })));
      await page.getByLabel('模拟访谈').check();
      const answered = page.waitForResponse((r) => r.url().endsWith('/api/research/interviews') && r.request().method() === 'POST', { timeout: 30 * MIN });
      const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByTestId('upload-interview').click()]);
      await chooser.setFiles(files);
      await log(`2.10 访谈分析：HTTP ${(await answered).status()}`);
      await page.reload();
      await page.getByTestId('change-table').waitFor({ timeout: 5 * MIN });
      await page.getByTestId('explanation-question').fill('K3 能直接改成“成立”吗？');
      await page.getByTestId('explanation-send').click();
      await shot(page, '2.10-reanalysis');
      await log(`2.10 变化表：${(await page.getByTestId('change-table').innerText()).replace(/\s+/g, ' ').slice(0, 300)}`);
    }

    if (step(11)) {
      const { page } = junior;
      await page.goto(`${BASE}${RESEARCH_URL}?step=reanalysis`);
      await page.getByTestId('submit-report').click();
      await page.getByTestId('submit-report-confirm').click();
      await page.getByTestId('report-review-open').waitFor();
      const s = senior.page;
      await s.goto(`${BASE}${RESEARCH_URL}?step=confirm`);
      await s.getByTestId('decision-draft').click();
      const card = s.locator('[data-testid="decision-card"][data-status="推断"]');
      await card.first().waitFor({ timeout: 15 * MIN });
      await shot(s, '2.11-confirm');
      // count first: innerText on a missing element waits out the 5-minute default timeout
      const listed = card.first().getByTestId('decision-problems');
      const problems = (await listed.count()) ? await listed.innerText() : '';
      if (problems) await log(`2.11 决定草稿有问题，没有确认：${problems.replace(/\s+/g, ' ').slice(0, 300)}`);
      else {
        await card.first().getByTestId('confirm-store').click();
        await s.locator('[data-testid="decision-card"][data-status="已确认"]').first().waitFor();
        await log('2.11 决定已确认，存入项目文件');
      }
    }

    if (step(12)) {
      const s = senior.page;
      await s.goto(`${BASE}${RESEARCH_URL}?step=stored`);
      const report = s.locator('[data-testid="stored-item"][data-kind="报告"]').first();
      if (await report.getByTestId('publish-asset').count()) await report.getByTestId('publish-asset').click();
      await sleep(2000);
      await shot(s, '2.12-stored');
      await log('2.12 已存入项目文件，报告发布为公司资产');
    }

    if (step(13)) {
      const b = await openAs(browser, 'junior-b');
      const chat = b.page.getByTestId('files-chat');
      await b.page.goto(`${BASE}/workspace/${encodeURIComponent(PROJECT)}/${encodeURIComponent('L2 凭什么赢')}/files`);
      await chat.getByTestId('chat-input').fill('这次要先读什么？');
      await chat.getByTestId('chat-send').click();
      await sleep(5000);
      await drive(b.page, b.busy, async () => b.busy() === 0, 10 * MIN, '2.13');
      await shot(b.page, '2.13-l2-files');
      await log(`2.13 L2 的回答：${(await chat.innerText()).replace(/\s+/g, ' ').slice(-300)}`);
      await b.context.close();
    }

    if (step(14)) {
      await senior.page.goto(`${BASE}/config`);
      await shot(senior.page, '2.14-config');
      await log('2.14 配置页');
    }
  } finally {
    await log('done');
    await browser.close();
  }
}

main().catch(async (e) => {
  await log(`FAILED: ${String(e?.stack ?? e).slice(0, 600)}`);
  process.exit(1);
});
