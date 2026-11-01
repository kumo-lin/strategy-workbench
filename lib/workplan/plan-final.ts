/** D-64 T35: 研究计划定了，往下做调查计划 → — the owner says the plan is final; the Workspace moves to step 2 (T30). */
import type { Role } from '@/lib/config/roles';
import { ApprovalDenied } from '@/lib/harness/events';
import type { Vault } from '@/lib/vault';

const BEFORE = ['拆题中', 'workplan待审'];

export async function markPlanFinal(vault: Vault, actor: Role, workspacePath: string, now = new Date()): Promise<void> {
  const path = `${workspacePath}/workspace.md`;
  const ws = await vault.read(path);
  if (actor.name !== ws.data.owner) throw new ApprovalDenied(`只有 Workspace 的负责人（${String(ws.data.owner)}）能定研究计划`);
  if (!BEFORE.includes(String(ws.data.stage))) return; // already past it
  await vault.write(path, { frontmatter: { ...ws.data, stage: '执行中', updated: now.toISOString().slice(0, 10) }, body: ws.body }, { overwrite: true });
  await vault.appendLog(`${workspacePath}/日志.md`, { time: now.toISOString(), actor: actor.name, action: 'plan.final', change: '研究计划定了，往下做调查计划', reason: '负责人定稿（征求意见不卡流程）' }).catch(() => {});
}
