/**
 * D-64 T18: 发布为公司资产. A Senior publishes a confirmed report or a confirmed decision; it then shows under
 * 公司资产 in every project's files (lib/workplan/files-view.ts). `published_by` / `published_at` are human-only
 * fields (lib/harness/guards.ts): only this person's event writes them.
 */
import type { Role } from '@/lib/config/roles';
import { ApprovalDenied } from '@/lib/harness/events';
import { localDate } from '@/lib/local-date';
import { confirmedReports } from '@/lib/research/confirmed-reports';
import type { Vault } from '@/lib/vault';
import { ReviewFlowError } from '@/lib/workplan/review-flow';

const REPORT_PATH = /^(20_项目\/[^/]+\/[^/]+)\/调查\/[^/]+\/报告 v\d+\.md$/;
const DECISION_PATH = /^(20_项目\/[^/]+)\/决策\/[^/]+\.md$/;

/** Which Workspace log records the publish: the report's own; for a decision, the Workspace of the report it was drafted from. */
async function logPathFor(vault: Vault, notePath: string, data: Record<string, unknown>): Promise<string | null> {
  const own = REPORT_PATH.exec(notePath);
  if (own) return `${own[1]}/日志.md`;
  const trigger = typeof data.trigger === 'string' ? data.trigger : null;
  if (!trigger) return null;
  const r = await vault.resolveLink(trigger, notePath);
  const ws = r.ok ? REPORT_PATH.exec(r.path) : null;
  return ws ? `${ws[1]}/日志.md` : null;
}

export async function publishAsset(vault: Vault, actor: Role, notePath: string, now: Date = new Date()): Promise<{ path: string; publishedBy: string; publishedAt: string }> {
  if (actor.kind !== 'senior') throw new ApprovalDenied('只有 Senior 可以发布为公司资产');
  if (notePath.split('/').includes('..')) throw new ReviewFlowError(`不是报告或决定的路径：${notePath}`);
  const report = REPORT_PATH.exec(notePath);
  if (!report && !DECISION_PATH.test(notePath)) throw new ReviewFlowError(`只能发布报告或决定：${notePath}`);
  const n = await vault.read(notePath);
  if (report) {
    if (n.data.type !== 'report') throw new ReviewFlowError(`${notePath} 不是报告`);
    if (!(await confirmedReports(vault, report[1])).some((r) => r.reportPath === notePath)) throw new ReviewFlowError('这份报告还没有经 Senior 确认，不能发布');
  } else if (n.data.type !== 'decision' || n.data.status !== '已确认') {
    throw new ReviewFlowError('这条决定还没有经 Senior 确认，不能发布');
  }
  const publishedAt = localDate(now);
  await vault.write(notePath, { frontmatter: { ...n.data, published_by: actor.name, published_at: publishedAt }, body: n.body }, { overwrite: true });
  const logPath = await logPathFor(vault, notePath, n.data);
  if (logPath && (await vault.exists(logPath))) {
    await vault.appendLog(logPath, { time: now.toISOString(), actor: actor.name, action: 'asset.publish', change: `发布为公司资产：${notePath}`, reason: '公司资产：所有项目可见' });
  }
  return { path: notePath, publishedBy: actor.name, publishedAt };
}
