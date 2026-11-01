/**
 * The citation checks again on a delivered report (D-48): citation-fit (all only flagged) and entity-check. Only
 * frontmatter citation_flags / entity_flags / citation_fit and the appendix's "引用核对" line change; the rest of the
 * body and its footnote numbers stay. The model is the vault's (90_配置/模型.md). Needs 报告 vN.judgment.json.
 *
 *   pnpm tsx scripts/recheck-citations.ts --vault <vault dir> --report <vault path of 报告 vN.md>
 *
 * Runs as the workspace's owner. Never prints keys.
 */
import path from 'node:path';
import { loadRoles } from '@/lib/config/roles';
import { buildToolContext } from '@/lib/harness';
import { recheckCitations } from '@/lib/research/recheck';
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
if (!VAULT || !REPORT) {
  console.error('用法：pnpm tsx scripts/recheck-citations.ts --vault <vault 目录> --report <vault 里的 报告 vN.md 路径>');
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
  const r = await recheckCitations({ ctx, reportPath });
  console.log(`引用核对按分批补跑，正文未改（${r.batches} 批）：查了 ${r.checked} 个，标了 ${r.flagged} 个；实体核对标了 ${r.entityFlagged} 个；补跑 summary_flags，正文未改：${r.summaryFlagged} 条；用时 ${r.seconds} 秒`);
}

main(VAULT, REPORT).catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
