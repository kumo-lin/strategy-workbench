/**
 * 演示用的 vault 副本：生成，并检查它们处在可以演示的状态。彩排清单的"演示前"那一节就是这个脚本检查的东西。
 *
 *   pnpm exec tsx scripts/demo-snapshot.ts make  [s0 s3 marketing fallback clean m1 m1done | all]   重建副本（先删后建，demo-vault 本身从不被改）
 *   pnpm exec tsx scripts/demo-snapshot.ts check [s0 s3 marketing fallback clean | all] [--servers] [--kimi]
 *   pnpm exec tsx scripts/demo-snapshot.ts restore                                       = make all（演示后恢复原状）
 *
 * 五份副本：
 *   s0         .scratch/vault           demo-vault 的干净副本。端口 3000，演示第 3 段前半（WS-A 从头共创）。
 *   s3         .scratch/S3              demo-vault/.snapshots/S3-D48 的整份副本（D-48 定稿：WS-A 报告 v10、W5 报告 v7，全部版本都在）。
 *                                       端口 3001：对比、WS-B 草稿计划、WS-A 的报告、W5。不再叠在 demo-vault 上：S3 冻结了，demo-vault 以后的改动不进 S3。
 *   marketing  .scratch/team-marketing  demo-vault/.snapshots/team-marketing 的副本。只在 Obsidian 里并排给人看（第 4 段换团队）。
 *   fallback   .scratch/fallback        兜底：S3-D48 + demo-vault/.snapshots/fallback。端口 3003，提前起好；试水调查或 Kimi 卡住时切过去。
 *   clean      .scratch/clean           干净演示：S3-D48 的资料库、方法库、专家输入、配置，加 demo-vault/.snapshots/clean（一个项目、一个空白 Workspace）。
 *                                       没有固定端口，用 VAULT_DIR=.scratch/clean 起服务（甲路评测、D-56 的新演示）；指向 S3-D48 调查计划的断链改指项目笔记。
 *   m1         .scratch/m1             说明文档 v4 的课题（D-64）：S3-D48 的方法库和配置，加 demo-vault/.snapshots/m1-qira（个人AI战略的议题树、
 *                                       决策契约草稿、M1 和 L2 两个 Workspace、另外 3 个示意项目、它自己的资料库）。端口 3004。
 *   m1done     .scratch/m1-done        D-64 T56：用真实模型把 m1 从 2.2 跑到 2.14 之后整份存下的 demo-vault/.snapshots/m1-qira-done（备查、③ 对照用）。
 *                                       端口 3008。只在点名时建（不在 all 里）。
 *
 * 任何一项检查不满足，退出码就是 1。`make` 之后会自动检查刚建的副本。
 * 没有 --servers / --kimi 的时候，只读文件，不起服务、不联网、不调模型。
 *
 * ── 兜底快照 demo-vault/.snapshots/fallback/ 要放什么（等 v4、W5 好了再放；没放的时候 fallback 的检查会报"待内容"）──
 * 它是叠在 s3 上面的一层（同名文件覆盖 s3 的）。它要表示的是：第 3 段试水调查已经跑完，第 4 段 Kimi 的卡片已经预先跑好。
 *   1. 20_项目/个人AI战略/WS-B 用户/调查/员工自带AI的程度/
 *        计划 v2.md        已批准（approved_by_owner、approved_at 有值），含补的那条监管子问题
 *        报告 v1.md        delivery: 已交付（试水调查跑完）
 *   2. 20_项目/个人AI战略/决策/WS-A…的决定.md   status: 已确认（演示第 3 段第 ⑥ 步 Senior 确认的那条），WS-B 的报告引用了它
 *   3. 20_项目/个人AI战略/决策/ 里另一条 status: 推断、drafted_by_model 含 "Kimi" 的决定（第 4 段 Kimi 的预跑卡片）。
 *      它和第 2 条起草于同一份 WS-A 报告（derived_from 相同）。**Kimi 起草的决定不能是已确认**：已确认的会被别的调查检索到。
 *      第 4 段不再现场跑 Kimi（D-25 作废）：讲 模型.md 的 active，再把这张卡和 DeepSeek 那张一起给人看。
 *   4. 90_配置/模型.md 的 active 仍是 deepseek
 */
import { spawnSync } from 'node:child_process';
import { cp, mkdir, rm, stat, readdir } from 'node:fs/promises';
import path from 'node:path';
import { loadPerspectives } from '@/lib/config/perspectives';
import { perspectiveGaps } from '@/lib/research/perspectives';
import { createVault, type Vault } from '@/lib/vault';
import { LIBRARY_INDEX_PATH, loadLibraryIndex } from '@/lib/vault/library-index';
import { relinkUnresolved, vaultIntegrity } from './demo-snapshot-relink';

const ROOT = process.cwd();
const DEMO = path.join(ROOT, 'demo-vault');
const SNAPSHOTS = path.join(DEMO, '.snapshots');
const PROJECT = '20_项目/个人AI战略';
const WS_A = `${PROJECT}/WS-A 买方`;
const WS_B = `${PROJECT}/WS-B 用户`;
const W5 = `${PROJECT}/W5 联想的位置`;
const DECISIONS = `${PROJECT}/决策`;

type TargetId = 's0' | 's3' | 'marketing' | 'fallback' | 'clean' | 'm1' | 'm1done';
const TARGET_IDS: TargetId[] = ['s0', 's3', 'marketing', 'fallback', 'clean', 'm1'];

interface Target {
  id: TargetId;
  dir: string;
  port: number | null;
  /** The vault is the demo-vault minus .snapshots, then these snapshot folders laid over it (in order). */
  base: 'demo-vault' | 'none';
  /** Copied after `base` and before `overlays`: snapshot folder name, then vault-relative paths (file or folder). */
  picks?: { from: string; paths: string[] }[];
  overlays: string[];
  /** After the overlays, repoint frontmatter links that do not resolve to this note. */
  relink?: string;
}

const TARGETS: Record<TargetId, Target> = {
  s0: { id: 's0', dir: '.scratch/vault', port: 3000, base: 'demo-vault', overlays: [] },
  s3: { id: 's3', dir: '.scratch/S3', port: 3001, base: 'none', overlays: ['S3-D48'] },
  marketing: { id: 'marketing', dir: '.scratch/team-marketing', port: null, base: 'none', overlays: ['team-marketing'] },
  fallback: { id: 'fallback', dir: '.scratch/fallback', port: 3003, base: 'none', overlays: ['S3-D48', 'fallback'] },
  clean: {
    id: 'clean',
    dir: '.scratch/clean',
    port: null,
    base: 'none',
    picks: [{ from: 'S3-D48', paths: ['10_资料库', '00_团队知识/方法库', '00_团队知识/专家输入', '90_配置'] }],
    overlays: ['clean'],
    // full path: a bare [[项目]] turns ambiguous as soon as the vault has a second project
    relink: '[[20_项目/个人AI战略/项目|项目]]',
  },
  // D-64 T50: the method library and the config of S3-D48, under the m1-qira layer (its own projects, roles, models, library)
  m1: { id: 'm1', dir: '.scratch/m1', port: 3004, base: 'none', picks: [{ from: 'S3-D48', paths: ['00_团队知识/方法库', '90_配置'] }], overlays: ['m1-qira'] },
  // D-64 T56: the M1 run with real models, saved whole after 2.14 (备查; not part of `all`, made only when asked by name)
  m1done: { id: 'm1done', dir: '.scratch/m1-done', port: 3008, base: 'none', overlays: ['m1-qira-done'] },
};

// ── output ───────────────────────────────────────────────────────────────────

let failures = 0;
let pending = 0;

function ok(label: string): void {
  console.log(`  ✓ ${label}`);
}
function bad(label: string, why: string, isPending = false): void {
  failures += 1;
  if (isPending) pending += 1;
  console.log(`  ✗ ${isPending ? '[待内容] ' : ''}${label}\n      ${why}`);
}
function check(cond: boolean, label: string, why: string, isPending = false): void {
  if (cond) ok(label);
  else bad(label, why, isPending);
}

// ── make ─────────────────────────────────────────────────────────────────────

const skipHidden = (src: string) => !src.split(path.sep).includes('.snapshots') && !src.split(path.sep).includes('.obsidian');

async function exists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

async function make(t: Target): Promise<void> {
  const out = path.join(ROOT, t.dir);
  await rm(out, { recursive: true, force: true });
  if (t.base === 'demo-vault') await cp(DEMO, out, { recursive: true, filter: skipHidden });
  for (const pick of t.picks ?? []) {
    for (const p of pick.paths) {
      const src = path.join(SNAPSHOTS, pick.from, p);
      if (!(await exists(src))) throw new Error(`没有 demo-vault/.snapshots/${pick.from}/${p}：pick 缺了就停止`);
      await mkdir(path.dirname(path.join(out, p)), { recursive: true });
      await cp(src, path.join(out, p), { recursive: true, force: true, filter: (s) => !s.split(path.sep).includes('.obsidian') });
    }
  }
  for (const name of t.overlays) {
    const src = path.join(SNAPSHOTS, name);
    if (!(await exists(src))) {
      console.log(`  ! 没有 demo-vault/.snapshots/${name}，跳过这一层`);
      continue;
    }
    await cp(src, out, { recursive: true, force: true, filter: (s) => !s.split(path.sep).includes('.obsidian') });
  }
  if (t.relink) {
    const rewritten = await relinkUnresolved(createVault(out), t.relink);
    console.log(`  重新指向了 ${rewritten.length} 份笔记的断链（→ ${t.relink}）`);
  }
  console.log(`  已重建 ${t.dir}`);
}

// ── helpers over a vault ─────────────────────────────────────────────────────

const LATEST = (prefix: string) => new RegExp(`^${prefix} v(\\d+)\\.md$`);

async function versions(vault: Vault, dir: string, prefix: string): Promise<{ n: number; path: string }[]> {
  const re = LATEST(prefix);
  const entries = await vault.list(dir).catch(() => []);
  return entries.flatMap((e) => (e.kind === 'file' && re.test(e.name) ? [{ n: Number(re.exec(e.name)![1]), path: e.path }] : [])).sort((a, b) => b.n - a.n);
}

async function decisionsIn(vault: Vault) {
  const entries = (await vault.list(DECISIONS).catch(() => [])).filter((e) => e.kind === 'file');
  const out: { name: string; path: string; status: string; data: Record<string, unknown> }[] = [];
  for (const e of entries) {
    const n = await vault.read(e.path);
    if (n.data.type === 'decision') out.push({ name: e.name.replace(/\.md$/, ''), path: e.path, status: String(n.data.status), data: n.data });
  }
  return out;
}

/** A decision "of WS-A": its name starts with WS-A, or a derived_from / relates_to link points into the WS-A folder. */
function isWsA(d: { name: string; data: Record<string, unknown> }): boolean {
  const links = [...((d.data.derived_from as unknown[]) ?? []), ...((d.data.relates_to as unknown[]) ?? [])].map(String);
  return d.name.startsWith('WS-A') || links.some((l) => l.includes('WS-A 买方'));
}

async function activeIs(vault: Vault, want: string): Promise<{ ok: boolean; got: string }> {
  const n = await vault.read('90_配置/模型.md');
  const got = String(n.data.active);
  return { ok: got === want, got };
}

// ── checks per target ────────────────────────────────────────────────────────

async function checkCommon(t: Target, vault: Vault): Promise<void> {
  const a = await activeIs(vault, 'deepseek');
  check(a.ok, '90_配置/模型.md 的 active 是 deepseek', `现在是 ${a.got}。改回 deepseek（演示前后都必须是 deepseek）`);
  if (t.id !== 'marketing') {
    const providers = ((await vault.read('90_配置/模型.md')).data.providers ?? {}) as Record<string, unknown>;
    check('kimi' in providers, '模型.md 里配了 kimi（第 4 段换模型要用）', 'providers 里没有 kimi');
  }
}

/** A decision drafted by Kimi must stay 推断: a confirmed one is found by other investigations and cited. Not a "pending" item. */
async function checkNoConfirmedKimi(vault: Vault): Promise<void> {
  const kimi = (await decisionsIn(vault)).filter((d) => String(d.data.drafted_by_model ?? '').includes('Kimi'));
  const confirmed = kimi.filter((d) => d.status !== '推断');
  check(confirmed.length === 0, '没有 Kimi 起草的决定是"已确认"（Kimi 的卡只能是推断）', `这些是 ${confirmed.map((d) => `${d.status}：${d.path}`).join('；')}`);
}

async function checkW1Decisions(vault: Vault): Promise<void> {
  const w1 = (await decisionsIn(vault)).filter((d) => d.name.startsWith('W1决定'));
  check(w1.length === 2 && w1.every((d) => d.status === '已确认'), 'W1 的两条决定是已确认', `找到 ${w1.length} 条 W1 决定，状态：${w1.map((d) => d.status).join('、') || '无'}`);
}

async function checkS0(vault: Vault): Promise<void> {
  const ws = await vault.read(`${WS_A}/workspace.md`);
  check(ws.data.stage === '拆题中', 'WS-A 还在"拆题中"（第 3 段从头共创）', `WS-A 的阶段是 ${String(ws.data.stage)}`);
  const entries = await vault.list(WS_A).catch(() => []);
  check(!entries.some((e) => /^workplan v\d+\.md$/.test(e.name)), 'WS-A 里还没有 workplan', '已经有 workplan 了：副本被用过，重建');
  const wsa = (await decisionsIn(vault)).filter((d) => isWsA(d));
  check(wsa.length === 0, 'WS-A 没有任何决定', `有：${wsa.map((d) => d.name).join('、')}`);
  await checkW1Decisions(vault);
}

async function checkWsBDraftPlan(vault: Vault): Promise<void> {
  const dir = `${WS_B}/调查/员工自带AI的程度`;
  const plans = await versions(vault, dir, '计划');
  check(plans.length > 0, 'WS-B 有"员工自带AI的程度"的计划', `${dir} 里没有 计划 vN.md`);
  if (plans.length === 0) return;
  const latest = await vault.read(plans[0].path);
  check(!latest.data.approved_by_owner && !latest.data.approved_at, `WS-B 计划（计划 v${plans[0].n}）是草稿，没有批准`, `已经批准了（approved_by_owner=${String(latest.data.approved_by_owner)}）`);
  const perspectives = await loadPerspectives(vault);
  const gaps = perspectiveGaps(
    { claims: (latest.data.claims as { perspective?: string[]; sub_questions: { perspective?: string[] }[] }[]) ?? [], perspectives_skipped: latest.data.perspectives_skipped as { perspective: string; reason: string }[] | undefined },
    perspectives,
  );
  check(gaps.length === 1 && gaps[0] === '监管', '计划页的提示是"漏了：监管"', `现在漏的是：${gaps.join('、') || '（没有漏，提示不会出现）'}；团队视角清单：${perspectives.join('、') || '（空）'}`);
  const reports = await versions(vault, dir, '报告');
  check(reports.length === 0, 'WS-B 还没有报告（试水调查要现场跑）', `已经有 报告 v${reports[0]?.n}`);
}

async function researchDirsOf(vault: Vault, dirParent: string): Promise<string[]> {
  return (await vault.list(dirParent).catch(() => [])).filter((e) => e.kind === 'dir').map((e) => e.path);
}

async function checkDelivered(vault: Vault, dirParent: string, what: string, isPending: boolean): Promise<void> {
  const researchDirs = (await vault.list(dirParent).catch(() => [])).filter((e) => e.kind === 'dir');
  let found: string | null = null;
  for (const d of researchDirs) {
    for (const r of await versions(vault, d.path, '报告')) {
      if ((await vault.read(r.path)).data.delivery === '已交付') {
        found = r.path;
        break;
      }
    }
    if (found) break;
  }
  check(found !== null, `${what}有一份已交付的报告`, `${dirParent} 下没有 delivery: 已交付 的 报告 vN.md`, isPending);
}

/**
 * The report page opens the newest delivered version (D-39): in S3 that must be one written in the question-tree structure
 * (`report_format: question_tree`), not v4 / W5 v1 as they were. Those exist only after the re-run, so it is a pending item.
 */
async function checkQuestionTreeReport(vault: Vault, researchDirs: string[], what: string): Promise<void> {
  const newest: { path: string; format: unknown }[] = [];
  for (const dir of researchDirs) {
    for (const r of await versions(vault, dir, '报告')) {
      const note = await vault.read(r.path);
      if (note.data.delivery === '已交付') {
        newest.push({ path: r.path, format: note.data.report_format });
        break;
      }
    }
  }
  const old = newest.filter((r) => r.format !== 'question_tree');
  check(newest.length > 0 && old.length === 0, `${what}页面默认打开的报告是新结构（report_format: question_tree）`, newest.length ? `${old.map((r) => r.path).join('、')} 是旧结构（没有 report_format）：要用问题树的计划重跑` : '没有已交付的报告', true);
}

async function checkS3(vault: Vault): Promise<void> {
  const wsa = (await decisionsIn(vault)).filter((d) => isWsA(d) && d.status === '已确认');
  check(wsa.length === 0, 'S3 副本里没有任何 WS-A 已确认的决定（第 3 段现场要确认第一条）', `有：${wsa.map((d) => d.path).join('、')}`);
  await checkW1Decisions(vault);
  await checkNoConfirmedKimi(vault);
  const kimiInS3 = (await decisionsIn(vault)).filter((d) => String(d.data.drafted_by_model ?? '').includes('Kimi'));
  check(kimiInS3.length === 0, 'S3 副本里没有 Kimi 起草的决定（Kimi 的预跑卡放在兜底快照里；现场换过 Kimi 的话，make s3 复原）', `有：${kimiInS3.map((d) => d.path).join('、')}`);
  await checkWsBDraftPlan(vault);
  const dirA = `${WS_A}/调查/买方采购逻辑`;
  const reportsA = await versions(vault, dirA, '报告');
  let delivered = false;
  for (const r of reportsA) if ((await vault.read(r.path)).data.delivery === '已交付') delivered = true;
  check(delivered, 'WS-A 有已交付的团队报告（第 2 段对比、第 3 段起草决定都用它）', `${dirA} 里没有已交付的 报告 vN.md`);
  // v3 带 source_warnings（3 处引用出自一份查无此文的转述）；说明文档写"下一版排除这份资料、重新判断"，那一版是 v4
  check(reportsA.length > 0 && reportsA[0].n >= 4, 'WS-A 的最新报告是 v4 或更新（排除有问题的来源之后重新判断）', `最新是 报告 v${reportsA[0]?.n ?? '无'}：v4 还没放进 S3 快照`, true);
  await checkDelivered(vault, `${W5}/调查`, 'W5 联想的位置', true);
  // the question-tree investigation is the one shown as WS-A's report; 买方采购逻辑 (v1–v4, old structure) stays for the comparison page
  await checkQuestionTreeReport(vault, [`${WS_A}/调查/买方采购逻辑（问题树）`], 'WS-A ');
  await checkQuestionTreeReport(vault, await researchDirsOf(vault, `${W5}/调查`), 'W5 ');
}

async function checkMarketing(vault: Vault): Promise<void> {
  const roles = ((await vault.read('90_配置/角色.md')).data.roles ?? []) as { id: string; name: string }[];
  check(roles.map((r) => r.id).join() === 'senior,junior-a,junior-b' && roles.some((r) => r.name === 'CMO'), '市场部的角色是 CMO / Planner A / Planner B（id 不变）', `角色：${roles.map((r) => `${r.id}=${r.name}`).join('、')}`);
  const methods = (await vault.list('00_团队知识/方法库').catch(() => [])).map((e) => e.name);
  check(methods.some((m) => m.startsWith('brief共创')) && methods.some((m) => m.startsWith('受众洞察')), '市场部的方法库有 brief共创、受众洞察', `方法库：${methods.join('、') || '（空）'}`);
  const team = (await vault.read('90_配置/团队.md')).data;
  check(Array.isArray(team.perspectives) && team.perspectives.length > 0, '市场部的 团队.md 有自己的视角清单（并排对比用）', '团队.md 的 perspectives 是空的');
}

async function checkFallback(vault: Vault): Promise<void> {
  const decisions = await decisionsIn(vault);
  await checkW1Decisions(vault);
  const dir = `${WS_B}/调查/员工自带AI的程度`;
  const plans = await versions(vault, dir, '计划');
  const reports = await versions(vault, dir, '报告');
  const latestPlan = plans[0] ? (await vault.read(plans[0].path)).data : null;
  check(!!latestPlan?.approved_by_owner && !!latestPlan?.approved_at, '兜底：WS-B 的计划已批准（试水调查"已经跑完"的状态）', '最新的计划没有批准：fallback 层里要放批准后的 计划 v2.md', true);
  let delivered = false;
  for (const r of reports) if ((await vault.read(r.path)).data.delivery === '已交付') delivered = true;
  check(delivered, '兜底：WS-B 有已交付的报告', `${dir} 里没有已交付的 报告 vN.md：fallback 层里要放试水调查的报告`, true);
  const confirmed = decisions.filter((d) => isWsA(d) && d.status === '已确认');
  check(confirmed.length >= 1, '兜底：有一条 WS-A 已确认的决定（第 ⑥ 步确认的那条）', `${DECISIONS} 里没有 WS-A 已确认的决定：fallback 层里要放`, true);
  await checkNoConfirmedKimi(vault);
  const kimi = decisions.filter((d) => d.status === '推断' && String(d.data.drafted_by_model ?? '').includes('Kimi'));
  check(kimi.length >= 1, '兜底：有 Kimi 起草的预跑卡片（推断，drafted_by_model 含 Kimi）', `${DECISIONS} 里没有：fallback 层里要放 Kimi 起草的决定`, true);
  // the two cards shown side by side in segment 4 come from the same report
  const reportOf = (d: { data: Record<string, unknown> }) => ((d.data.derived_from as unknown[]) ?? []).map(String).find((l) => l.includes('报告 v')) ?? '';
  const deepseek = decisions.filter((d) => isWsA(d) && !String(d.data.drafted_by_model ?? '').includes('Kimi') && reportOf(d));
  const same = kimi.length > 0 && deepseek.some((d) => kimi.some((k) => reportOf(k) === reportOf(d)));
  check(same, '兜底：Kimi 的卡和 DeepSeek 的卡起草于同一份报告（derived_from 相同）', 'Kimi 卡的 derived_from 报告和 WS-A 的决定不是同一个（报告改了以后，Kimi 卡要重做）', true);
  await checkDelivered(vault, `${W5}/调查`, '兜底：W5 联想的位置', true);
}

// ── clean ────────────────────────────────────────────────────────────────────

const sameNames = (got: string[], want: string[]): boolean =>
  got.length === want.length && [...got].sort().join('\n') === [...want].sort().join('\n');

async function diskNames(dir: string): Promise<string[]> {
  return (await readdir(path.join(SNAPSHOTS, dir))).filter((n) => n.endsWith('.md'));
}

async function checkClean(vault: Vault): Promise<void> {
  const files = (await vault.list('', { recursive: true })).filter((e) => e.kind === 'file');

  const projects = await vault.list('20_项目').catch(() => []);
  check(projects.length === 1 && projects[0].kind === 'dir' && projects[0].name === '个人AI战略', '20_项目 里只有一个项目 个人AI战略', `现在是：${projects.map((e) => e.name).join('、') || '（空）'}`);

  const projectEntries = await vault.list(PROJECT).catch(() => []);
  check(sameNames(projectEntries.map((e) => e.name), ['项目.md', '会议', 'WS-A 买方']), `${PROJECT} 里只有 项目.md、会议、WS-A 买方`, `现在是：${projectEntries.map((e) => e.name).join('、') || '（空）'}`);

  const wsEntries = await vault.list(WS_A).catch(() => []);
  check(sameNames(wsEntries.map((e) => e.name), ['workspace.md', '日志.md']), 'WS-A 买方 里只有 workspace.md 和 日志.md', `现在是：${wsEntries.map((e) => e.name).join('、') || '（空）'}`);
  const ws = await vault.read(`${WS_A}/workspace.md`).catch(() => null);
  check(ws?.data.stage === '拆题中', 'WS-A 还在"拆题中"（空白 Workspace）', `WS-A 的阶段是 ${String(ws?.data.stage)}`);
  const log = await vault.read(`${WS_A}/日志.md`).catch(() => null);
  const rows = (log?.body ?? '').split('\n').filter((l) => l.startsWith('|') && !l.startsWith('| 时间 |') && !l.startsWith('|---'));
  check(rows.length === 0, 'WS-A 日志没有数据行（空白 Workspace）', `有 ${rows.length} 行：${rows.slice(0, 3).join('；')}`);

  const lib = (await vault.list('10_资料库').catch(() => [])).filter((e) => e.kind === 'file').map((e) => e.name);
  const libDisk = await diskNames('S3-D48/10_资料库');
  check(sameNames(lib, libDisk), `10_资料库 的 ${lib.length} 份资料和 S3-D48 一致`, `现在 ${lib.length} 份，S3-D48 ${libDisk.length} 份`);

  if (await vault.exists(LIBRARY_INDEX_PATH)) {
    const index = await loadLibraryIndex(vault);
    const missing: string[] = [];
    for (const entry of index.entries) if (!(await vault.exists(entry.path))) missing.push(entry.path);
    check(
      missing.length === 0 && index.entries.length === lib.length,
      `资料索引 ${index.entries.length} 条，和 10_资料库 一一对应`,
      `索引 ${index.entries.length} 条，10_资料库 ${lib.length} 份${missing.length ? `；不存在的路径：${missing.slice(0, 5).join('、')}` : ''}`,
    );
  }

  const team = await vault.list('00_团队知识').catch(() => []);
  check(sameNames(team.map((e) => e.name), ['方法库', '专家输入', '高层方针']), '00_团队知识 里只有 方法库、专家输入 和 高层方针', `现在是：${team.map((e) => e.name).join('、') || '（空）'}`);
  const methods = (await vault.list('00_团队知识/方法库').catch(() => [])).filter((e) => e.kind === 'file').map((e) => e.name);
  check(sameNames(methods, await diskNames('S3-D48/00_团队知识/方法库')), `方法库 的 ${methods.length} 份方法和 S3-D48 一致`, `现在：${methods.join('、') || '（空）'}`);
  const experts = (await vault.list('00_团队知识/专家输入').catch(() => [])).filter((e) => e.kind === 'file' && e.name.endsWith('.md')).map((e) => e.name);
  check(sameNames(experts, await diskNames('S3-D48/00_团队知识/专家输入')), `专家输入 的 ${experts.length} 份和 S3-D48 一致`, `现在：${experts.join('、') || '（空）'}`);

  const simulated = [`${PROJECT}/会议/2026-10-16 高层周会（模拟）.md`, '00_团队知识/高层方针/2026财年商用PC业务方针（模拟）.md'];
  for (const p of simulated) {
    const n = (await vault.exists(p)) ? await vault.read(p) : null;
    check(n?.data.simulated === true, `${p} 存在且 simulated: true`, n ? 'simulated 不是 true' : '文件不存在');
  }

  const forbidden = new Set(['report', 'research_plan', 'workplan', 'hypothesis', 'decision', 'review']);
  const offenders: string[] = [];
  for (const f of files) {
    const n = await vault.read(f.path);
    if (forbidden.has(String(n.data.type))) offenders.push(f.path);
  }
  check(offenders.length === 0, '没有任何 报告 / 计划 / workplan / 假设 / 决定 / 评审 笔记', `有：${offenders.slice(0, 5).join('、')}`);

  const broken = await vaultIntegrity(vault);
  const detail = broken.slice(0, 5).map((b) => `${b.path}（${b.problems.join('、')}）`).join('；');
  check(broken.length === 0, '所有笔记都完整（frontmatter 合规、链接都能解析、引用都能对上）', `${broken.length} 份有问题：${detail}`);

  const g = spawnSync('git', ['status', '--porcelain', '--', 'demo-vault/.snapshots/S3-D48'], { cwd: ROOT, encoding: 'utf8' });
  check(g.status === 0 && g.stdout.trim() === '', 'S3-D48 快照没有被改动', `git 看到改动：${g.stdout.trim().split('\n').slice(0, 5).join('；')}`);
}

/** D-64 T50: the m1 copy has the M1 topic as the explanation document v4 tells it. */
async function checkM1(vault: Vault): Promise<void> {
  const P = '20_项目/个人AI战略';
  const project = await vault.readTyped(`${P}/项目.md`, 'project').catch(() => null);
  const lines = project?.note.issue_tree?.lines ?? [];
  const items = (id: string) => lines.find((l) => l.id === id)?.items.map((i) => i.id).join(',') ?? '';
  const l2 = lines.flatMap((l) => l.items).find((i) => i.id === 'L2');
  check(
    items('A') === 'M1,M2,M3,M4' && items('B') === 'L1,L2,L3,L4' && lines[0]?.owner === 'junior-a' && lines[1]?.owner === 'junior-b' && l2?.waits_for.join(',') === 'M1',
    '项目.md 的议题树：A 市场如何演进（M1–M4，junior-a）、B 联想如何选择（L1–L4，junior-b），L2 等 M1',
    project ? `现在：A=${items('A')}，B=${items('B')}，L2 等 ${l2?.waits_for.join(',') ?? '（无）'}` : '项目.md 读不出来，或没有 issue_tree',
  );
  const contract = await vault.readTyped(`${P}/决策契约.md`, 'contract').catch(() => null);
  check(contract?.note.status === '推断', '决策契约.md 是 contract，状态推断（等 Senior 确认）', contract ? `状态是 ${contract.note.status}` : '读不出来');
  for (const [folder, item] of [['M1 用户持续使用', 'M1'], ['L2 凭什么赢', 'L2']]) {
    const ws = await vault.readTyped(`${P}/${folder}/workspace.md`, 'workspace').catch(() => null);
    check(ws?.note.stage === '拆题中' && ws.note.item === item, `Workspace「${folder}」拆题中，item ${item}`, ws ? `stage ${ws.note.stage}，item ${String(ws.note.item)}` : '不存在');
  }
  const roles = ((await vault.read('90_配置/角色.md')).data.roles ?? []) as { id: string; name: string }[];
  check(
    roles.map((r) => `${r.id}=${r.name}`).join(',') === 'senior=Senior,junior-a=分析师甲,junior-b=分析师乙',
    '角色：Senior、分析师甲、分析师乙（id 仍是 senior、junior-a、junior-b）',
    `现在：${roles.map((r) => `${r.id}=${r.name}`).join('、')}`,
  );
  const models = (await vault.read('90_配置/模型.md')).data as { roles?: Record<string, string>; providers?: Record<string, { model?: string }> };
  const hasRoles = ['judgment', 'execution', 'review'].every((r) => models.roles?.[r]);
  const hasK31 = Object.values(models.providers ?? {}).some((p) => p.model === 'kimi-k3.1-pro-highspeed');
  check(hasRoles && hasK31, '模型.md 按角色配置（判断、执行、独立复核），providers 里有 kimi-k3.1-pro-highspeed', `roles：${Object.keys(models.roles ?? {}).join('、') || '无'}；kimi-k3.1-pro-highspeed ${hasK31 ? '有' : '没有'}`);
}

// ── global checks ────────────────────────────────────────────────────────────

async function newestMtime(paths: string[]): Promise<number> {
  let newest = 0;
  const walk = async (p: string): Promise<void> => {
    let s;
    try {
      s = await stat(p);
    } catch {
      return;
    }
    if (s.isDirectory()) {
      for (const name of await readdir(p)) if (name !== 'node_modules' && name !== '.next') await walk(path.join(p, name));
    } else newest = Math.max(newest, s.mtimeMs);
  };
  for (const p of paths) await walk(path.join(ROOT, p));
  return newest;
}

async function checkBuild(): Promise<void> {
  const id = path.join(ROOT, '.next/BUILD_ID');
  if (!(await exists(id))) {
    bad('生产构建已经 build 好', '.next/BUILD_ID 不存在：先跑 pnpm build');
    return;
  }
  const builtAt = (await stat(id)).mtimeMs;
  const newest = await newestMtime(['app', 'components', 'lib', 'next.config.ts', 'package.json']);
  check(builtAt >= newest, '生产构建已经 build 好，而且比最后一次改代码新', `代码改过以后没有重新 build（构建时间早于最新改动 ${Math.round((newest - builtAt) / 60000)} 分钟）：pnpm build`);
}

const ROLE_WINDOWS = [
  { id: 'senior', name: 'Senior' },
  { id: 'junior-a', name: 'Junior A' },
  { id: 'junior-b', name: 'Junior B' },
];

async function checkServers(targets: Target[]): Promise<void> {
  for (const t of targets) {
    if (!t.port) continue;
    for (const r of ROLE_WINDOWS) {
      const url = `http://${r.id}.localhost:${t.port}/workspace`;
      const label = `${url} 打开的是 ${r.name} 的窗口（网址决定角色，带别的角色的 cookie 也不理会）`;
      // a cookie naming another role: the address must win
      const other = ROLE_WINDOWS.find((o) => o.id !== r.id)!;
      try {
        const res = await fetch(url, { headers: { cookie: `sw-role=${other.id}` }, signal: AbortSignal.timeout(20_000) });
        const html = await res.text();
        const locked = html.includes(`本窗口固定为 ${r.name}`);
        check(res.status === 200 && locked, label, `HTTP ${res.status}，页面里${locked ? '有' : '没有'}"本窗口固定为 ${r.name}"`);
      } catch (e) {
        bad(label, `连不上：${e instanceof Error ? e.message : String(e)}（服务起了吗？）`);
      }
    }
  }
}

function checkKimi(): void {
  console.log('\n[kimi] 用真实 Kimi 调一次（会用掉一点额度；只验 key 和接口，应用里的换模型要照清单手动做一遍）');
  const r = spawnSync('pnpm', ['exec', 'tsx', 'scripts/smoke-model.ts'], { cwd: ROOT, env: { ...process.env, MODEL_PROVIDER: 'kimi' }, encoding: 'utf8', timeout: 180_000 });
  const out = `${r.stdout}${r.stderr}`;
  check(r.status === 0 && out.includes('provider=kimi'), '真实 Kimi 调用成功', `退出码 ${String(r.status)}。输出末尾：${out.trim().split('\n').slice(-3).join(' | ')}。看 .env.local 里有没有 MOONSHOT_API_KEY`);
  console.log('      记得：这只是接口验证，没有改任何 模型.md。应用里换模型验完以后，再跑一次 check 确认 active 都是 deepseek。');
}

// ── main ─────────────────────────────────────────────────────────────────────

async function checkTarget(t: Target): Promise<void> {
  console.log(`\n[${t.id}] ${t.dir}${t.port ? `（端口 ${t.port}）` : ''}`);
  if (!(await exists(path.join(ROOT, t.dir)))) {
    bad('副本存在', `${t.dir} 不存在：先 make ${t.id}`);
    return;
  }
  const vault = createVault(path.join(ROOT, t.dir));
  await checkCommon(t, vault);
  if (t.id === 's0') await checkS0(vault);
  if (t.id === 's3') await checkS3(vault);
  if (t.id === 'marketing') await checkMarketing(vault);
  if (t.id === 'fallback') await checkFallback(vault);
  if (t.id === 'clean') await checkClean(vault);
  if (t.id === 'm1') await checkM1(vault);
  if (t.id === 'm1done') await checkM1Done(vault);
}

/** T56: the saved real-model run holds a delivered report of M1 and a confirmed decision. */
async function checkM1Done(vault: Vault): Promise<void> {
  const ws = '20_项目/个人AI战略/M1 用户持续使用/调查';
  const reports: { path: string; delivery: unknown }[] = [];
  for (const inv of (await vault.list(ws).catch(() => [])).filter((e) => e.kind === 'dir'))
    for (const f of (await vault.list(inv.path)).filter((e) => /^报告 v\d+\.md$/.test(e.name))) reports.push({ path: f.path, delivery: (await vault.read(f.path)).data.delivery });
  check(reports.some((r) => r.delivery === '已交付'), 'M1 有已交付的报告（真实模型跑出）', `现在是：${reports.map((r) => `${r.path}（${String(r.delivery)}）`).join('、') || '没有报告'}`);
  const confirmed = (await decisionsIn(vault)).filter((d) => d.status === '已确认');
  check(confirmed.length > 0, '有已确认的决定', '决策/ 里没有已确认的决定');
}

function parseTargets(words: string[]): Target[] {
  const names = words.filter((w) => !w.startsWith('--'));
  if (names.length === 0 || names.includes('all')) return TARGET_IDS.map((id) => TARGETS[id]);
  return names.map((n) => {
    if (!(n in TARGETS)) throw new Error(`不认识的副本 "${n}"，可选：${TARGET_IDS.join('、')}、m1done、all`);
    return TARGETS[n as TargetId];
  });
}

async function main(): Promise<void> {
  const [cmd, ...rest] = process.argv.slice(2);
  if (cmd !== 'make' && cmd !== 'check' && cmd !== 'restore') {
    console.log('用法：tsx scripts/demo-snapshot.ts make|check|restore [s0 s3 marketing fallback clean m1 m1done | all] [--servers] [--kimi]');
    process.exit(2);
  }
  const targets = cmd === 'restore' ? TARGET_IDS.map((id) => TARGETS[id]) : parseTargets(rest);
  if (cmd === 'make' || cmd === 'restore') {
    for (const t of targets) {
      console.log(`\n[${t.id}] 重建`);
      await make(t);
    }
  }
  for (const t of targets) await checkTarget(t);
  if (rest.includes('--servers')) {
    console.log('\n[servers] 三个角色窗口（以 <角色>.localhost 网址请求页面）');
    await checkServers(targets);
  }
  if (cmd === 'check') {
    console.log('\n[build]');
    await checkBuild();
  }
  if (rest.includes('--kimi')) checkKimi();

  console.log(failures === 0 ? '\n全部通过。' : `\n${failures} 项不满足${pending ? `（其中 ${pending} 项是在等内容：v4 / W5 / 新结构的报告 / 兜底快照）` : ''}，退出码 1。`);
  process.exit(failures === 0 ? 0 : 1);
}

void main();
