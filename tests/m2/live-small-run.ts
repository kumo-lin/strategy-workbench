/**
 * 2.11 ⑦ — one small Deep Research run with the REAL model and the real DeepSeek
 * Search/Fetch, on a throwaway copy of demo-vault. Not part of `pnpm test`.
 *
 *   pnpm tsx tests/m2/live-small-run.ts [--keep]
 *
 * Steps: plan (research_plan agent, grill pre-answered) → owner approves (human event)
 * → executeResearch('small') → prints timings, usage and the report. Never prints keys.
 */
import { cp, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { buildToolContext, runAgent, applyApprovalEvent } from '@/lib/harness';
import { loadRoles } from '@/lib/config/roles';
import { executeResearch } from '@/lib/research/execute';
import { createVault } from '@/lib/vault';

try {
  process.loadEnvFile('.env.local');
} catch {
  /* rely on the environment */
}

const ROOT = path.resolve('.scratch/m2-live');
const WS = '20_项目/个人AI战略/WS-A 买方';
const RDIR = `${WS}/调查/IT可管理性 小调查`;

async function main() {
  await rm(ROOT, { recursive: true, force: true });
  await cp('demo-vault', ROOT, { recursive: true });
  await mkdir(path.join(ROOT, RDIR), { recursive: true });
  const vault = createVault(ROOT);
  // The seed vault no longer ships WS-A hypotheses (they are born in the live workplan session):
  // make the one this run tests, in the scratch copy only.
  const HYP = '20_项目/个人AI战略/假设/WS-A-H1 IT 可管理性决定采购.md';
  if (!(await vault.exists(HYP))) {
    await vault.write(HYP, {
      frontmatter: {
        id: 'ws-a-h1',
        type: 'hypothesis',
        status: '进行中',
        created: '2026-10-24',
        updated: '2026-10-24',
        author: 'Junior A',
        derived_from: [`[[${WS}/workspace|WS-A 买方]]`],
        relates_to: [`[[${WS}/workspace|WS-A 买方]]`],
        workspace: `[[${WS}/workspace|WS-A 买方]]`,
        statement: '企业为员工个人 AI 买单的首要条件是 IT 能管理',
        verdict_proposed: null,
        verdict: null,
        evidence: [],
        counter_evidence: [],
      },
      body: '# WS-A-H1：IT 可管理性决定采购（scratch 副本里为实测临时建立）\n',
    });
  }
  const juniorA = (await loadRoles(vault)).find((r) => r.name === 'Junior A')!;
  const t0 = Date.now();
  const at = () => `${((Date.now() - t0) / 1000).toFixed(1)}s`;

  // 1. plan
  let ctx = await buildToolContext({ vault, role: juniorA, workspacePath: WS, track: 'research', researchDir: RDIR });
  console.log(`[${at()}] phase=${ctx.phase} — drafting the plan`);
  const plan = await runAgent({
    ctx,
    maxSteps: 8,
    messages: [
      {
        role: 'user',
        content:
          '我要做一次小调查（现场演示用）。调查什么：企业为员工的 AI PC 买单，IT 可管理性是不是首要条件。为什么：决定 WS-A 先验证哪个买方场景。论点就用假设 WS-A-H1。这三件事已经对齐，不用再提问，请直接用 write_draft 写出 计划 v1：1 个论点、2 个子问题，查法是知识库和网络。',
      },
    ],
  });
  for await (const part of plan.fullStream) {
    if (part.type === 'tool-call') console.log(`[${at()}]   tool-call ${part.toolName}`);
    if (part.type === 'tool-error') console.log(`[${at()}]   tool-error ${part.toolName}: ${String((part as { error?: unknown }).error).slice(0, 300)}`);
  }
  const tPlan = Date.now() - t0;
  ctx = await buildToolContext({ vault, role: juniorA, workspacePath: WS, track: 'research', researchDir: RDIR });
  if (!ctx.research?.planPath) throw new Error('the model did not write a plan');
  console.log(`[${at()}] plan written: ${ctx.research.planPath} (${ctx.research.plan?.claims.map((c) => `${c.id}: ${c.sub_questions.map((q) => q.id).join(',')}`).join('; ')})`);

  // 2. the owner approves (human event)
  await applyApprovalEvent(vault, { type: 'research_plan.approve', actor: juniorA, workspace: `${WS}/workspace.md`, plan: ctx.research.planPath }, { logPath: ctx.logPath });
  ctx = await buildToolContext({ vault, role: juniorA, workspacePath: WS, track: 'research', researchDir: RDIR });
  console.log(`[${at()}] approved → phase=${ctx.phase}`);

  // 3. execute (small)
  const tExec = Date.now();
  const result = await executeResearch({
    ctx,
    mode: 'small',
    emit: (e) => {
      if (e.kind === 'step' && e.status !== 'running') console.log(`[${at()}] step ${e.step} ${e.id} ${e.status} ${e.detail ?? ''}`.slice(0, 400));
      if (e.kind === 'tool-end' && !e.ok) console.log(`[${at()}]   ✗ ${e.error}`.slice(0, 300));
    },
  });
  const execMs = Date.now() - tExec;
  console.log('\n===== result');
  console.log(JSON.stringify({ ...result, planMs: tPlan, execMs }, null, 1));
  const tm = result.timing;
  console.log('\n===== timing (seconds; spans overlap when sub-questions run in parallel)');
  console.log(`plan (agent, incl. 1 write_draft) ${(tPlan / 1000).toFixed(1)}  |  execute wall ${(execMs / 1000).toFixed(1)}`);
  for (const [k, v] of Object.entries(tm.byKind)) console.log(`  ${k.padEnd(8)} n=${String(v.n).padStart(2)}  sum=${(v.ms / 1000).toFixed(1)}`);
  for (const [k, v] of Object.entries(tm.llmByTask)) console.log(`  llm:${k.padEnd(10)} n=${String(v.n).padStart(2)}  sum=${(v.ms / 1000).toFixed(1)}`);
  for (const s of tm.steps) console.log(`  step ${s.step} ${s.id.padEnd(10)} ${(s.ms / 1000).toFixed(1)}s  ${s.title.slice(0, 50)}`);
  console.log('\n===== report');
  console.log((await vault.read(result.reportPath)).body);
  const hyp = await vault.search({ types: ['hypothesis'] });
  console.log('\n===== hypotheses', hyp.map((h) => `${h.path}: verdict_proposed=${h.data.verdict_proposed} verdict=${h.data.verdict}`));
  if (!process.argv.includes('--keep')) console.log(`\n(vault copy left at ${ROOT})`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.stack : e);
  process.exit(1);
});
