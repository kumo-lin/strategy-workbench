/**
 * D-64 T34 (ui-1): what the project page shows — the decision contract and the issue tree, each item with where it is —
 * and the Senior's confirmation of the contract (确定，指派负责人). An item's status is read, never stored (D63 §3.1.2):
 * no Workspace → 未开始; waiting for an item that has no confirmed decision yet → 等 M1 的决定; done → 已完成; else 深挖中.
 */
import type { Role } from '@/lib/config/roles';
import { ApprovalDenied } from '@/lib/harness/events';
import { issueTreeSchema, type IssueTree } from '@/lib/notes/schema';
import type { Vault } from '@/lib/vault';

export type ItemStatus = 'todo' | 'active' | 'waiting' | 'done';

export interface ContractView {
  status: string;
  question: string;
  original_question: string | null;
  decision: string;
  decision_owner: string;
  horizon: string;
  geography: string;
  product_scope: string;
  out_of_scope: string[];
  approved_by: string | null;
  approved_at: string | null;
}

export interface ProjectPage {
  project: string;
  contract: ContractView | null;
  /** null: an older project without an issue tree (the page keeps the older layout). */
  tree: (Omit<IssueTree, 'lines'> & { lines: (Omit<IssueTree['lines'][number], 'items'> & { items: (IssueTree['lines'][number]['items'][number] & { status: ItemStatus; label: string })[] })[] }) | null;
}

const DONE_STAGES = ['撰写中', '骨架待审', '终稿待审', '完成'];
const contractPath = (project: string) => `20_项目/${project}/决策契约.md`;
const str = (v: unknown) => (v === null || v === undefined ? '' : String(v));

/** Workspaces of the project with a confirmed decision drawn from them (the decision's links name the Workspace folder). */
async function decidedWorkspaces(vault: Vault, project: string): Promise<Set<string>> {
  const out = new Set<string>();
  for (const e of await vault.list(`20_项目/${project}/决策`).catch(() => [])) {
    if (e.kind !== 'file') continue;
    const n = await vault.read(e.path).catch(() => null);
    if (n?.data.type !== 'decision' || n.data.status !== '已确认') continue;
    const links = [...(Array.isArray(n.data.derived_from) ? n.data.derived_from : []), ...(Array.isArray(n.data.relates_to) ? n.data.relates_to : [])].map(String).join(' ');
    for (const m of links.matchAll(new RegExp(`20_项目/${project}/([^/|\\]]+)/`, 'g'))) out.add(m[1]);
  }
  return out;
}

export async function loadProjectPage(vault: Vault, project: string): Promise<ProjectPage> {
  const c = await vault.read(contractPath(project)).catch(() => null);
  const contract: ContractView | null = c
    ? {
        status: str(c.data.status),
        question: str(c.data.question),
        original_question: c.data.original_question ? str(c.data.original_question) : null,
        decision: str(c.data.decision),
        decision_owner: str(c.data.decision_owner),
        horizon: str(c.data.horizon),
        geography: str(c.data.geography),
        product_scope: str(c.data.product_scope),
        out_of_scope: Array.isArray(c.data.out_of_scope) ? c.data.out_of_scope.map(String) : [],
        approved_by: c.data.approved_by ? str(c.data.approved_by) : null,
        approved_at: c.data.approved_at ? str(c.data.approved_at) : null,
      }
    : null;
  const note = await vault.read(`20_项目/${project}/项目.md`).catch(() => null);
  const parsed = issueTreeSchema.safeParse(note?.data.issue_tree);
  if (!parsed.success) return { project, contract, tree: null };
  const decided = await decidedWorkspaces(vault, project);
  const stageOf = async (ws: string) => str((await vault.read(`20_项目/${project}/${ws}/workspace.md`).catch(() => null))?.data.stage);
  const all = parsed.data.lines.flatMap((l) => l.items);
  const isDone = async (id: string) => {
    const it = all.find((i) => i.id === id);
    return !!it?.workspace && (decided.has(it.workspace) || DONE_STAGES.includes(await stageOf(it.workspace)));
  };
  const lines = [];
  for (const l of parsed.data.lines) {
    const items = [];
    for (const it of l.items) {
      const waiting = [];
      for (const w of it.waits_for) if (!(await isDone(w))) waiting.push(w);
      const s: { status: ItemStatus; label: string } = !it.workspace
        ? { status: 'todo', label: '未开始' }
        : await isDone(it.id)
          ? { status: 'done', label: '已完成' }
          : waiting.length
            ? { status: 'waiting', label: `等 ${waiting.join('、')} 的决定` }
            : { status: 'active', label: '深挖中' };
      items.push({ ...it, ...s });
    }
    lines.push({ ...l, items });
  }
  return { project, contract, tree: { question: parsed.data.question, lines } };
}

/** 确定，指派负责人: the Senior confirms the contract (and with it the issue tree and its owners). A person's event only. */
export async function confirmContract(vault: Vault, actor: Role, project: string, now = new Date()): Promise<void> {
  if (actor.kind !== 'senior') throw new ApprovalDenied('只有 Senior 能确认决策契约');
  const p = contractPath(project);
  const n = await vault.read(p);
  const day = now.toISOString().slice(0, 10);
  await vault.write(p, { frontmatter: { ...n.data, status: '已确认', approved_by: actor.name, approved_at: day, updated: day }, body: n.body }, { overwrite: true });
  await vault
    .appendLog(`20_项目/${project}/日志.md`, { time: now.toISOString(), actor: actor.name, action: 'contract.confirm', change: `确认决策契约和议题树（${project}）`, reason: '确定，指派负责人' })
    .catch(() => {});
}
