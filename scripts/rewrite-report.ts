/**
 * 只重写 (D-48): write a report again, the new way, on an earlier version's evidence. No search, no fetch; the model
 * is the vault's (90_配置/模型.md). The research folder's latest plan must be approved. Stores 报告 vN+1 next to it.
 *
 *   pnpm tsx scripts/rewrite-report.ts --vault <vault dir> --report <vault path of 报告 vN.md> [--allow-missing]
 *   pnpm tsx scripts/rewrite-report.ts --vault <vault dir> --report <…/报告 vN.md> --backfill-judgment
 *   pnpm tsx scripts/rewrite-report.ts --vault <vault dir> --report <…/报告 vN.md> --only H2,H3,一句话回答,推荐表
 *   pnpm tsx scripts/rewrite-report.ts --vault <vault dir> --report <…/报告 vN.md> --rerender [--note "<why>"]
 *
 * vN's judgment is kept (D-48 第 4 轮): its 报告 vN.judgment.json, else read back from its body; the model only writes.
 * --only redoes only what it lists (a hypothesis and the ones under it, 一句话回答, 推荐表); the rest is vN's word for
 * word, from 报告 vN.judgment.json (a part vN's file does not hold is written again too: 本版变化 says what was).
 * --rerender renders vN again by today's rules from its judgment file alone, no model call; then the citation checks
 * run on the new version, batch by batch, only flagged (recheck-citations). --note says why, in 本版变化.
 * --backfill-judgment only writes 报告 vN.judgment.json, read back from vN's body (a report from before the file existed).
 *
 * vN's evidence must all come back from its record; an entry that does not stops it, nothing written, exit 1, the
 * missing sources listed. --allow-missing only when the owner decided it goes out anyway (本版变化 says what is missing).
 *
 * Runs as the workspace's owner (the role a run needs). Never prints keys.
 */
import path from 'node:path';
import { loadRoles } from '@/lib/config/roles';
import { buildToolContext } from '@/lib/harness';
import { recheckCitations } from '@/lib/research/recheck';
import { backfillJudgment, rewriteReport } from '@/lib/research/rewrite';
import { createVault } from '@/lib/vault';

try {
  process.loadEnvFile('.env.local');
} catch {
  // rely on the environment
}

const arg = (name: string) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const VAULT = arg('--vault');
const REPORT = arg('--report');
const ALLOW_MISSING = process.argv.includes('--allow-missing');
const BACKFILL = process.argv.includes('--backfill-judgment');
const RERENDER = process.argv.includes('--rerender');
const NOTE = arg('--note');
const ONLY = arg('--only')?.split(/[,，、]/).map((t) => t.trim()).filter(Boolean);
if (!VAULT || !REPORT) {
  console.error('用法：pnpm tsx scripts/rewrite-report.ts --vault <vault 目录> --report <vault 里的 报告 vN.md 路径> [--allow-missing] [--only H2,H3,一句话回答,推荐表 | --rerender [--note "<why>"]] | --backfill-judgment');
  process.exit(2);
}

async function main(vaultDir: string, reportPath: string) {
  const vault = createVault(path.resolve(vaultDir));
  const researchDir = path.posix.dirname(reportPath);
  const workspacePath = researchDir.split('/调查/')[0];
  const ws = await vault.readTyped(`${workspacePath}/workspace.md`, 'workspace');
  const role = (await loadRoles(vault)).find((r) => r.name === ws.note.owner);
  if (!role) throw new Error(`角色配置里没有 workspace 的负责人「${ws.note.owner}」`);
  const ctx = await buildToolContext({ vault, role, workspacePath, track: 'research', researchDir });
  if (BACKFILL) {
    const b = await backfillJudgment(ctx, reportPath);
    console.log(`已写 ${b.path}：${b.claims.join('、')}`);
    for (const u of b.unreadable) console.log(`读不回来：${u.label}（${u.why}）`);
    if (b.unreadable.length) process.exitCode = 1;
    return;
  }
  const r = await rewriteReport({
    ctx,
    reportPath,
    allowMissing: ALLOW_MISSING,
    only: ONLY,
    ...(RERENDER ? { rerender: { note: NOTE } } : {}),
    emit: (e) => {
      if (e.kind === 'step' && e.status !== 'running') console.log(`[${e.status}] ${e.title}${e.detail ? `：${e.detail}` : ''}`);
    },
  });
  console.log(`${r.reportName}：${r.delivered ? '已交付' : `草稿（${r.failedChecks.join('；')}）`}`);
  console.log(`搜索 ${r.usage.searches} 次、抓取 ${r.usage.fetches} 次，用时 ${Math.round(r.durationMs / 1000)} 秒，模型 ${r.model.label}（${r.model.model}）`);
  console.log(r.reportPath);
  if (!r.delivered) process.exitCode = 1;
  // --rerender: the citation checks the render did not run, on the version just written (only flags)
  if (RERENDER && r.delivered) {
    const c = await recheckCitations({ ctx, reportPath: r.reportPath });
    console.log(`引用核对按分批补跑，正文未改（${c.batches} 批）：查了 ${c.checked} 个，标了 ${c.flagged} 个；实体核对标了 ${c.entityFlagged} 个；summary_flags ${c.summaryFlagged} 条`);
  }
}

main(VAULT, REPORT).catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
