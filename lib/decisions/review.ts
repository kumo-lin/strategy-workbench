/**
 * The Senior's side of "决定 + 理由": edit the AI's draft, then confirm it. Confirmation
 * is the human approval event `decision.confirm` (lib/harness/events.ts), nothing else:
 * this file reads the draft, checks the rule of ./check.ts and calls `applyApprovalEvent`.
 */
import type { Role } from '@/lib/config/roles';
import { ApprovalDenied, applyApprovalEvent, planApprovalEvent, type ApprovalEvent } from '@/lib/harness/events';
import type { DecisionNote } from '@/lib/notes/schema';
import { parseWikiLink, type Vault } from '@/lib/vault';
import { checkDecisionBody, citedBlocks, type DecisionCheck } from './check';
import { DecisionFlowError } from './propose';
import { localDate } from '@/lib/local-date';
import { decisionFields, withFields, type DecisionFields } from './fields';

export { decisionFields, withFields, type DecisionFields };

const DECISION_PATH = /^20_项目\/[^/]+\/决策\/[^/]+\.md$/;

export interface LoadedDecision {
  path: string;
  data: Record<string, unknown>;
  body: string;
  reportPath: string;
  /** `20_项目/<项目>/<Workspace>` the report belongs to. */
  workspacePath: string;
}

export async function loadDecision(vault: Vault, decisionPath: string): Promise<LoadedDecision> {
  if (!DECISION_PATH.test(decisionPath) || decisionPath.split('/').includes('..')) throw new DecisionFlowError(`不是决策笔记的路径：${decisionPath}`);
  const n = await vault.read(decisionPath);
  if (n.data.type !== 'decision') throw new DecisionFlowError(`${decisionPath} 不是决定`);
  for (const raw of Array.isArray(n.data.derived_from) ? (n.data.derived_from as string[]) : []) {
    if (!parseWikiLink(raw)) continue;
    const r = await vault.resolveLink(raw, decisionPath);
    if (!r.ok) continue;
    const m = /^(20_项目\/[^/]+\/[^/]+)\/调查\/[^/]+\/报告 v\d+\.md$/.exec(r.path);
    if (m) return { path: decisionPath, data: n.data, body: n.body, reportPath: r.path, workspacePath: m[1] };
  }
  throw new DecisionFlowError('这条决定没有链接到它所依据的报告（derived_from），无法核对理由');
}

const today = localDate;

/** Dry-run `decision.confirm`: throws ApprovalDenied if this actor may not confirm this decision now. */
function assertMayConfirm(event: ApprovalEvent, decisionPath: string, data: Record<string, unknown>, now: string): void {
  const plan = planApprovalEvent(event, { [decisionPath]: data as unknown as DecisionNote }, now);
  if (!plan.ok) throw new ApprovalDenied(plan.reason);
}

export interface SaveResult {
  path: string;
  saved: boolean;
  check: DecisionCheck;
}

/** Senior edits the text of a draft (status stays 推断). A draft with problems may be saved; it just cannot be confirmed. */
export async function saveDecisionEdit(input: { vault: Vault; actor: Role; decisionPath: string; body: string; now?: Date }): Promise<SaveResult> {
  const { vault, actor, decisionPath } = input;
  const now = input.now ?? new Date();
  const d = await loadDecision(vault, decisionPath);
  assertMayConfirm({ type: 'decision.confirm', actor, decision: decisionPath }, decisionPath, d.data, now.toISOString());
  const body = input.body.endsWith('\n') ? input.body : `${input.body}\n`;
  if (body !== d.body) {
    await vault.write(decisionPath, { frontmatter: { ...d.data, edited_by: actor.name, updated: today(now) }, body }, { overwrite: true });
  }
  return { path: decisionPath, saved: body !== d.body, check: await checkDecisionBody(vault, { decisionPath, reportPath: d.reportPath, body }) };
}

/** Write the three fields back (and `scope` into the frontmatter); the draft stays 推断. */
export async function saveDecisionFields(input: { vault: Vault; actor: Role; decisionPath: string; fields: DecisionFields; now?: Date }): Promise<SaveResult> {
  const d = await loadDecision(input.vault, input.decisionPath);
  const body = withFields(d.body, input.fields);
  const saved = await saveDecisionEdit({ ...input, body });
  const scope = input.fields.scope.replace(/\s+/g, ' ').trim();
  const n = await input.vault.read(input.decisionPath);
  if (scope && n.data.scope !== scope) await input.vault.write(input.decisionPath, { frontmatter: { ...n.data, scope }, body: n.body }, { overwrite: true });
  return saved;
}

/** 退回，写明理由: the Senior sends the draft back (`decision.reject`), the reason kept on the note and in the log. */
export async function returnDecision(input: { vault: Vault; actor: Role; decisionPath: string; reason: string; now?: Date }): Promise<{ path: string; status: '已否决'; reason: string }> {
  const { vault, actor, decisionPath } = input;
  const now = input.now ?? new Date();
  const event: ApprovalEvent = { type: 'decision.reject', actor, decision: decisionPath };
  const d = await loadDecision(vault, decisionPath);
  assertMayConfirm(event, decisionPath, d.data, now.toISOString());
  const logPath = `${d.workspacePath}/日志.md`;
  await applyApprovalEvent(vault, event, { now, logPath: (await vault.exists(logPath)) ? logPath : undefined, reason: `Senior 退回决定：${input.reason}` });
  const after = await vault.read(decisionPath);
  await vault.write(decisionPath, { frontmatter: { ...after.data, return_reason: input.reason }, body: after.body }, { overwrite: true });
  return { path: decisionPath, status: '已否决', reason: input.reason };
}

export interface ConfirmResult {
  path: string;
  status: '已确认';
  decidedBy: string;
  summary: string;
}

/** `decision.confirm`: optional last edit, then the rule check, then the approval event. */
export async function confirmDecision(input: { vault: Vault; actor: Role; decisionPath: string; body?: string; now?: Date }): Promise<ConfirmResult> {
  const { vault, actor, decisionPath } = input;
  const now = input.now ?? new Date();
  const event: ApprovalEvent = { type: 'decision.confirm', actor, decision: decisionPath };
  const d = await loadDecision(vault, decisionPath);
  assertMayConfirm(event, decisionPath, d.data, now.toISOString());

  const saved = input.body === undefined ? null : await saveDecisionEdit({ vault, actor, decisionPath, body: input.body, now });
  const check = saved?.check ?? (await checkDecisionBody(vault, { decisionPath, reportPath: d.reportPath, body: d.body }));
  if (!check.ok) throw new DecisionFlowError(`这条决定还不能确认：${check.problems.join('；')}`);

  const logPath = `${d.workspacePath}/日志.md`;
  const { summary } = await applyApprovalEvent(vault, event, {
    now,
    logPath: (await vault.exists(logPath)) ? logPath : undefined,
    reason: `Senior 确认决定「${decisionPath.split('/').pop()?.replace(/\.md$/, '')}」${saved?.saved ? '（确认前改过正文）' : ''}`,
  });
  // The draft banner written by propose_decision would now be false: say who confirmed it instead.
  const after = await vault.read(decisionPath);
  const banner = /^> \*\*草稿，状态"推断"\*\*.*$/m;
  if (banner.test(after.body)) {
    const report = `[[${d.reportPath.replace(/\.md$/, '')}|${d.reportPath.split('/').pop()?.replace(/\.md$/, '')}]]`;
    const body = after.body.replace(banner, `> **已确认**：${actor.name} 于 ${today(now)} 确认（AI 根据 ${report} 起草，${actor.name} 审阅）。`);
    await vault.write(decisionPath, { frontmatter: after.data, body }, { overwrite: true });
  }
  return { path: decisionPath, status: '已确认', decidedBy: actor.name, summary };
}

/** What the report page's decision card shows (plain JSON: also returned by the draft / confirm routes). */
export interface DecisionCard {
  path: string;
  name: string;
  status: string;
  decidedBy: string | null;
  /** "label（model）" that drafted it (frontmatter `drafted_by_model`), null for hand-written / older notes. */
  draftedByModel: string | null;
  body: string;
  /** The three parts the Senior edits (D-64 T17); optional while the older panel builds cards without it. */
  fields?: DecisionFields;
  /** Why a 推断 draft cannot be confirmed yet (empty = it can). */
  problems: string[];
}

async function cardOf(vault: Vault, path: string, reportPath: string, inReport?: Set<string>): Promise<DecisionCard> {
  const n = await vault.read(path);
  const check = n.data.status === '推断' ? await checkDecisionBody(vault, { decisionPath: path, reportPath, body: n.body, inReport }) : { ok: true, problems: [] };
  return { path, name: path.split('/').pop()!.replace(/\.md$/, ''), status: String(n.data.status), decidedBy: typeof n.data.decided_by === 'string' ? n.data.decided_by : null, draftedByModel: typeof n.data.drafted_by_model === 'string' ? n.data.drafted_by_model : null, body: n.body, fields: decisionFields(n.body), problems: check.problems };
}

/** One decision as its card, checked against the report it was drafted from. */
export async function loadDecisionCard(vault: Vault, decisionPath: string): Promise<DecisionCard> {
  const d = await loadDecision(vault, decisionPath);
  return cardOf(vault, decisionPath, d.reportPath);
}

/** The decisions drafted from one report (any status), sorted by name, for the report page. */
export async function decisionsOfReport(vault: Vault, projectPath: string, reportPath: string): Promise<DecisionCard[]> {
  let entries;
  try {
    entries = await vault.list(`${projectPath}/决策`);
  } catch {
    return [];
  }
  const out: DecisionCard[] = [];
  let inReport: Set<string> | undefined;
  for (const e of entries) {
    if (e.kind !== 'file') continue;
    const n = await vault.read(e.path);
    if (n.data.type !== 'decision') continue;
    const from = Array.isArray(n.data.derived_from) ? (n.data.derived_from as string[]) : [];
    let isFromReport = false;
    for (const raw of from) {
      if (!parseWikiLink(raw)) continue;
      const r = await vault.resolveLink(raw, e.path);
      if (r.ok && r.path === reportPath) isFromReport = true;
    }
    if (!isFromReport) continue;
    if (n.data.status === '推断') inReport ??= await citedBlocks(vault, (await vault.read(reportPath)).body, reportPath);
    out.push(await cardOf(vault, e.path, reportPath, inReport));
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}
