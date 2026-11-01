/** Gathers the facts `computeFlow` needs for one Workspace. Reads the vault and the server's job table; writes nothing. */
import { loadProjectOverview, originOf } from '@/lib/project/overview';
import { findJob, jobKey } from '@/lib/research/job';
import { latestVersion } from '@/lib/research/folders';
import { INTERVIEW_HITS_FILE } from '@/lib/research/interview-followup';
import { parseWikiLink, type Vault } from '@/lib/vault';
import { listCommentRefs, listReviews, listWorkplans } from '@/lib/workplan/state';
import { computeFlow, type FlowFacts, type FlowState } from './steps';

export interface InvestigationRef {
  name: string;
  /** How far it got, most advanced wins when several exist. */
  state: FlowFacts['research'];
}

export interface WorkspaceFlow {
  facts: FlowFacts;
  state: FlowState;
  /** The investigation the research steps are about, for links. */
  investigation: InvestigationRef | null;
  unhandled: number;
  /** The latest G1 review's note path name, for links. */
  pendingReview: string | null;
}

const RANK: Record<FlowFacts['research'], number> = { none: 0, planning: 1, approved: 2, running: 3, reported: 4 };

/** What breaks a tie between investigations at the same state: their latest delivered report (its updated, version). */
interface Latest {
  updated: string;
  version: number;
}

async function investigations(vault: Vault, workspacePath: string): Promise<(InvestigationRef & { latest: Latest | null })[]> {
  const dirs = (await vault.list(`${workspacePath}/调查`).catch(() => [])).filter((e) => e.kind === 'dir');
  const out: (InvestigationRef & { latest: Latest | null })[] = [];
  for (const d of dirs) {
    const plan = await latestVersion(vault, d.path, '计划');
    const report = await latestVersion(vault, d.path, '报告');
    let state: FlowFacts['research'] = 'none';
    if (plan) {
      const p = (await vault.read(plan.path)).data;
      state = p.approved_at && p.approved_by_owner && p.status === '已确认' ? 'approved' : 'planning';
    }
    const r = report ? (await vault.read(report.path)).data : null;
    if (findJob(jobKey(workspacePath, d.path))?.status === 'running') state = 'running';
    else if (r?.delivery === '已交付') state = 'reported';
    out.push({ name: d.name, state, latest: r?.delivery === '已交付' ? { updated: String(r.updated ?? r.created ?? ''), version: Number(r.version) || report!.n } : null });
  }
  return out;
}

/**
 * Decisions of this project that were drafted from a report of this Workspace: [drafted, confirmed]; and, per
 * investigation, the newest decision still to confirm drafted from it (its created date).
 */
async function decisionsOf(vault: Vault, project: string, workspacePath: string): Promise<{ drafted: boolean; confirmed: boolean; pending: Map<string, string> }> {
  const entries = await vault.list(`20_项目/${project}/决策`).catch(() => []);
  let drafted = false;
  let confirmed = false;
  const pending = new Map<string, string>();
  for (const e of entries) {
    if (e.kind !== 'file') continue;
    const n = await vault.read(e.path);
    if (n.data.type !== 'decision') continue;
    for (const raw of Array.isArray(n.data.derived_from) ? (n.data.derived_from as string[]) : []) {
      if (!parseWikiLink(raw)) continue;
      const r = await vault.resolveLink(raw, e.path);
      if (r.ok && r.path.startsWith(`${workspacePath}/调查/`)) {
        drafted = true;
        if (n.data.status === '已确认') confirmed = true;
        else {
          const dir = r.path.slice(`${workspacePath}/调查/`.length).split('/')[0];
          const at = String(n.data.created ?? '');
          if (!pending.has(dir) || at > pending.get(dir)!) pending.set(dir, at);
        }
      }
    }
  }
  return { drafted, confirmed, pending };
}

/**
 * The investigation the flow is about: the most advanced. Tied (S3-D48: 买方采购逻辑 and 买方采购逻辑（问题树）, both
 * delivered; the sort kept the folder order and 去确认 opened the old one): the one a decision still to confirm comes
 * from (the newest such decision), then the one with the newest delivered report (updated, then version), else as listed.
 */
export function pickInvestigation(invs: (InvestigationRef & { latest: Latest | null })[], pending: Map<string, string>): InvestigationRef | null {
  if (!invs.length) return null;
  const top = Math.max(...invs.map((i) => RANK[i.state]));
  const tied = invs.filter((i) => RANK[i.state] === top);
  const byDecision = (i: InvestigationRef) => pending.get(i.name) ?? null;
  const cmp = (a: (typeof invs)[number], b: (typeof invs)[number]) => {
    const [da, db] = [byDecision(a), byDecision(b)];
    if ((da === null) !== (db === null)) return da === null ? 1 : -1;
    if (da !== null && db !== null && da !== db) return da > db ? -1 : 1;
    const [la, lb] = [a.latest, b.latest];
    if (la && lb && la.updated !== lb.updated) return la.updated > lb.updated ? -1 : 1;
    if (la && lb && la.version !== lb.version) return lb.version - la.version;
    if (!!la !== !!lb) return la ? -1 : 1;
    return 0;
  };
  const best = [...tied].sort(cmp)[0];
  return { name: best.name, state: best.state };
}

export async function loadWorkspaceFlow(vault: Vault, project: string, workspacePath: string): Promise<WorkspaceFlow> {
  const [overview, reviews, comments, invs, decisions] = await Promise.all([
    loadProjectOverview(vault, project),
    listReviews(vault, workspacePath),
    listCommentRefs(vault, workspacePath),
    investigations(vault, workspacePath),
    decisionsOf(vault, project, workspacePath),
  ]);
  const ws = (await vault.readTyped(`${workspacePath}/workspace.md`, 'workspace')).note;
  const g1s = reviews.filter((r) => r.note.gate === 'G1');
  const last = g1s[g1s.length - 1];
  const g1: FlowFacts['g1'] = !last ? 'none' : last.note.result === null ? 'pending' : last.note.result === '通过' ? 'approved' : 'rejected';
  const conclusions = reviews.filter((r) => r.note.gate === '结论');
  const lastConclusion = conclusions[conclusions.length - 1];
  const reportReview: FlowFacts['reportReview'] = !lastConclusion
    ? 'none'
    : lastConclusion.note.result === null
      ? 'open'
      : lastConclusion.note.result === '通过'
        ? 'confirmed'
        : 'sent_back';
  const best = pickInvestigation(invs, decisions.pending);
  const origin = originOf(overview, workspacePath);
  const sibling = origin.dependents[0] ?? origin.siblings[0];
  const unhandled = comments.filter((c) => c.result !== null && c.handledIn.length === 0).length;
  const facts: FlowFacts = {
    projectConfirmed: overview.hasProjectNote && overview.confirmed,
    projectOwner: overview.owner,
    owner: ws.owner,
    reviewer: ws.reviewer,
    stage: ws.stage,
    g1,
    unhandledComments: unhandled,
    research: best?.state ?? 'none',
    decisionDrafted: decisions.drafted,
    decisionConfirmed: decisions.confirmed,
    reportReview,
    ...(best && best.state === 'reported' ? await afterReport(vault, `${workspacePath}/调查/${best.name}`) : {}),
    workplanWritten: (await listWorkplans(vault, workspacePath)).length > 0,
    next: sibling ? { workspace: sibling.name, owner: sibling.owner } : null,
  };
  const pending = last && last.note.result === null ? last.name : null;
  return { facts, state: computeFlow(facts), investigation: best && best.state !== 'none' ? best : null, unhandled, pendingReview: pending };
}

/** T30: the latest delivered report of the investigation has gap rows (step 4); interviews were matched (step 5). */
async function afterReport(vault: Vault, dir: string): Promise<Pick<FlowFacts, 'reportGaps' | 'interviewHits'>> {
  const v = await latestVersion(vault, dir, '报告');
  const body = v ? ((await vault.read(v.path).catch(() => null))?.body ?? '') : '';
  const gapSection = body.split(/^## 缺乏信息、需要另外验证的问题\s*$/m)[1]?.split(/^## /m)[0] ?? '';
  const rows = gapSection.split('\n').filter((l) => /^\|/.test(l.trim())).length - 2; // header and rule
  return { reportGaps: rows > 0, interviewHits: await vault.exists(`${dir}/${INTERVIEW_HITS_FILE}`) };
}
