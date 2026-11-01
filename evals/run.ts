/**
 * Eval runner (D-15): `pnpm eval [--cases 1,2,3,4,5] [--runs 3] [--concurrency 3]`.
 *
 * Runs every case against the real configured model (the snapshot's 90_配置/模型.md, deepseek-flash) on copies
 * of the S3 snapshot under .scratch/evals/<stamp>/ — demo-vault is only read. Writes evals/results/<date>.md.
 * Reads keys from .env.local; never prints them.
 */
import { execSync } from 'node:child_process';
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { cpus, totalmem } from 'node:os';
import path from 'node:path';
import { activeModelInfo, modelText } from '@/lib/config/model-info';
import { getModel } from '@/lib/models/provider';
import { createVault } from '@/lib/vault';
import {
  caseNowWhat,
  CLAIM,
  judgeCitations,
  judgeCounter,
  judgeDirectiveOrigin,
  recordKbUse,
  Scratch,
  SNAPSHOT,
  teamRun,
  type CaseRun,
  type MachineLoad,
  type TeamRun,
} from './cases';
import { NOW_WHAT_LLM_CRITERION } from './judges';

try {
  process.loadEnvFile('.env.local');
} catch {
  // rely on the environment
}

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const CASES = new Set(arg('cases', '1,2,3,4,5').split(',').map(Number));
const RUNS = Number(arg('runs', '3'));
const CONCURRENCY = Number(arg('concurrency', '3'));

async function pool<T>(jobs: (() => Promise<T>)[], n: number): Promise<T[]> {
  const out: T[] = new Array(jobs.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, jobs.length) }, async () => {
      while (next < jobs.length) {
        const i = next++;
        out[i] = await jobs[i]();
      }
    }),
  );
  return out;
}

interface CaseResult {
  id: number;
  title: string;
  how: string;
  runs: CaseRun[];
  skipped?: string;
  /** Not judged: the runs only record facts for the scorer (④ since D-17). */
  recordOnly?: boolean;
}

const TITLES: Record<number, { title: string; how: string }> = {
  1: { title: '① G1 comment「我没看懂，所以这个调查结果的SoWhat是什么」：AI 列出的理解里有“缺的是 now what”', how: '规则（选项里有 “now what” 字样）；规则没过时再由 **LLM 判定**（标准见文末）' },
  2: { title: '② 小调查的结果里有反证，或者写了“证据不足”', how: '规则' },
  3: { title: '③ 引用都对得上原文，没有出处不明的数字', how: '规则' },
  4: { title: '④ 报告的推导用了知识库里的哪些笔记（会议、决定、专家输入等）', how: '只记录，不判通过与否（D-17，留给打分）' },
  45: { title: '④′ 报告里系统写的“这次调查的出发点”引用了高层周会 ^m1 的原文「重点看 IT 能不能管」，并且过 check_citations', how: '规则，三项都要过：(a) 有出发点；(b) 引用了 ^m1 且引文含这句话；(c) 这条引用核对通过' },
  5: { title: '⑤ S1（桩）', how: '—' },
};

const rate = (r: CaseResult) => (r.skipped ? `跳过：${r.skipped}` : r.recordOnly ? `只记录（${r.runs.filter((x) => x.note && !x.note.startsWith('运行出错')).length}/${r.runs.length} 次有记录）` : passRate(r.runs));

const passRate = (runs: CaseRun[]) => {
  const judged = runs.filter((r) => r.pass !== null);
  const passed = judged.filter((r) => r.pass).length;
  return `${passed}/${runs.length}${judged.length < runs.length ? `（${runs.length - judged.length} 次运行出错）` : ''}`;
};

/** Small runs have a ~3 minute target (PRD §11.2 live demo); longer ones are flagged. */
const SMALL_TARGET_S = 180;

function timingTable(teams: TeamRun[]): string[] {
  if (!teams.length) return [];
  const sec = (ms: number) => Math.round(ms / 1000);
  const cell = (ms: number | undefined, err?: string) => (ms === undefined ? '—' : `${sec(ms)} 秒${err ? '（出错）' : sec(ms) > SMALL_TARGET_S ? ' ⚠ 超过 3 分钟' : ''}`);
  const mach = (m: MachineLoad | undefined) => (!m ? '—' : `load ${m.load}；空闲内存 ${m.freePct ?? '?'}%；期间换出 ${m.swapoutsDuring ?? '?'} 页`);
  const delivery = (t: TeamRun | undefined) => (!t ? '—' : t.error ? `运行出错：${t.error.slice(0, 80)}` : t.delivered ? '已交付' : '**自检没通过（草稿）**');
  const out = ['', `每次运行的用时（并发 1，各自单独跑；小调查的目标是 ${SMALL_TARGET_S / 60} 分钟以内）。机器状态：load 是开始时的 1 / 5 / 15 分钟负载（同 uptime，这台机器 ${cpus().length} 核、${Math.round(totalmem() / 2 ** 30)} GB 内存）；空闲内存是开始时 memory_pressure 的 free percentage；换出页数是运行期间 vm_stat Swapouts 的增量（每页 16 KB）：`, '', '| 第几次 | 团队工作流（小调查，论点 C2） | 团队报告 | 运行时的机器状态 |', '|---|---|---|---|'];
  for (let i = 0; i < teams.length; i++) out.push(`| ${i + 1} | ${cell(teams[i]?.ms, teams[i]?.error)} | ${delivery(teams[i])} | ${mach(teams[i]?.machine)} |`);
  const parts = (rec: Record<string, { n: number; ms: number }>) =>
    Object.entries(rec)
      .sort((a, b) => b[1].ms - a[1].ms)
      .map(([k, v]) => `${k} ${v.n} 次 ${sec(v.ms)} 秒`)
      .join('、');
  const timed = teams.filter((t) => t?.timing);
  if (timed.length) {
    out.push('', '团队小调查的时间花在哪（各调用的耗时之和；并行的调用会重叠，所以加起来可能超过总用时）：', '');
    for (const t of timed) out.push(`- 第 ${t.run} 次：模型调用按任务 ${parts(t.timing!.llmByTask)}；工具 ${parts(Object.fromEntries(Object.entries(t.timing!.byKind).filter(([k]) => k !== 'llm')))}`);
  }
  const failed = teams.filter((t) => t && !t.error && !t.delivered);
  if (failed.length) {
    out.push('', '自检没通过的原因（报告 frontmatter 的 failed_checks，原样）：', '');
    for (const t of failed) out.push(`- 第 ${t.run} 次：`, ...(t.failedChecks?.length ? t.failedChecks : ['（没有记录原因）']).map((f) => `  - ${f}`));
  }
  return out;
}

function render(results: CaseResult[], meta: Record<string, string>, timing: string[] = []): string {
  const out: string[] = [];
  out.push(`## ${meta.time} 的一轮`, '');
  for (const [k, v] of Object.entries(meta)) if (k !== 'time') out.push(`- ${k}：${v}`);
  out.push(...timing);
  out.push('', '| 用例 | 判定方式 | 通过率 |', '|---|---|---|');
  for (const r of results) out.push(`| ${r.title} | ${r.how} | ${rate(r)} |`);
  for (const r of results) {
    out.push('', `### ${r.title}`, '', `判定方式：${r.how}`, '');
    if (r.skipped) {
      out.push(`跳过：${r.skipped}`);
      continue;
    }
    if (r.recordOnly) {
      for (const run of r.runs) out.push(`**第 ${run.run} 次**${run.note ? ` · ${run.note}` : ''}`, '', `> ${run.excerpt}`, '');
      continue;
    }
    for (const run of r.runs) {
      const llm = run.checks.some((c) => c.kind === 'llm');
      out.push(`**第 ${run.run} 次：${run.pass === null ? '运行出错' : run.pass ? '通过' : '没通过'}**${llm ? '（含 LLM 判定）' : ''} · ${Math.round(run.ms / 1000)} 秒${run.note ? ` · ${run.note}` : ''}`, '');
      for (const c of run.checks) out.push(`- ${c.pass ? '✓' : '✗'} [${c.kind === 'llm' ? 'LLM 判定' : '规则'}] ${c.name}：${c.detail}`);
      if (run.pass !== true || llm) out.push('', '原文摘录：', '', ...run.excerpt.split('\n').map((l) => `> ${l}`));
      out.push('');
    }
  }
  out.push('', '### LLM 判定的标准（只用于 ①，规则没过时）', '', ...NOW_WHAT_LLM_CRITERION.split('\n').map((l) => `> ${l}`), '');
  return out.join('\n');
}

async function main() {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const scratch = new Scratch(path.resolve('.scratch/evals', stamp));
  // Anything that falls back to the global vault lands on a scratch copy, never on demo-vault.
  const guard = await scratch.copy('_guard');
  process.env.VAULT_DIR = guard.dir;

  const snapVault = createVault(SNAPSHOT);
  const model = await getModel({ vault: snapVault });
  const info = await activeModelInfo(snapVault);
  console.log(`eval: model ${modelText(info)}, runs ${RUNS}, cases ${[...CASES].join(',')}, scratch ${scratch.root}`);

  const results: CaseResult[] = [];
  const needTeam = [2, 3, 4, 45].some((c) => CASES.has(c));
  const runIds = Array.from({ length: RUNS }, (_, i) => i + 1);

  const jobs: (() => Promise<unknown>)[] = [];
  const c1: CaseRun[] = [];
  const teams: TeamRun[] = [];
  if (CASES.has(1)) for (const i of runIds) jobs.push(async () => {
    console.log(`① run ${i} …`);
    c1[i - 1] = await caseNowWhat(scratch, i, model.model).catch((e) => ({ run: i, pass: null, checks: [], excerpt: String(e), ms: 0, note: '运行出错' }));
    console.log(`① run ${i}: ${c1[i - 1].pass}`);
  });
  if (needTeam) for (const i of runIds) jobs.push(async () => {
    console.log(`team run ${i} …`);
    teams[i - 1] = await teamRun(scratch, i);
    console.log(`team run ${i}: ${teams[i - 1].error ?? teams[i - 1].reportPath} (${Math.round(teams[i - 1].ms / 1000)}s)`);
  });
  await pool(jobs, CONCURRENCY);

  if (CASES.has(1)) results.push({ id: 1, ...TITLES[1], runs: c1 });
  if (CASES.has(2)) results.push({ id: 2, ...TITLES[2], runs: teams.map(judgeCounter) });
  if (CASES.has(3)) results.push({ id: 3, ...TITLES[3], runs: teams.map(judgeCitations) });
  if (CASES.has(4)) results.push({ id: 4, ...TITLES[4], runs: await Promise.all(teams.map(recordKbUse)), recordOnly: true });
  // ④′ is run with ④ (same team runs) unless cases are picked one by one.
  if (CASES.has(4) || CASES.has(45)) results.push({ id: 45, ...TITLES[45], runs: teams.map(judgeDirectiveOrigin) });
  if (CASES.has(5)) results.push({ id: 5, ...TITLES[5], runs: [], skipped: 'S1 做不做还没定（D-15），先留桩' });

  let commit = '?';
  try {
    commit = execSync('git rev-parse --short HEAD').toString().trim();
  } catch {
    /* not a git checkout */
  }
  const now = new Date();
  const meta = {
    time: now.toLocaleString('zh-CN', { hour12: false }),
    模型: modelText(info),
    代码: commit,
    数据: `${SNAPSHOT}（每次运行一份副本，在 ${path.relative(process.cwd(), scratch.root)}）`,
    '②③④④′ 的调查': `WS-A 买方 / 买方采购逻辑 / 计划 v1，小调查，只跑论点 ${CLAIM}；这几条用例共用同 ${RUNS} 次运行`,
    '④ 和 ④′ 的标准': 'D-17（PRD v0.7 §11.1）：不再和普通模式比结论，改看报告自己写的出发点',
    每条运行次数: String(RUNS),
  };
  const md = render(results, meta, timingTable(teams));
  const dir = path.resolve('evals/results');
  await mkdir(dir, { recursive: true });
  const day = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const file = path.join(dir, `${day}.md`);
  const exists = await readFile(file, 'utf8').then(() => true, () => false);
  if (exists) await appendFile(file, `\n---\n\n${md}`);
  else await writeFile(file, `# Eval 结果 ${day}\n\n${md}`);
  console.log(`\n${results.map((r) => `${r.title.slice(0, 2)} ${rate(r)}`).join('\n')}\n→ ${path.relative(process.cwd(), file)}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
