/**
 * read_task_context (D-64 T20): before anything else in a phase, the AI reads what it was assigned — the decision
 * contract, the plans, the owner's opinions, the confirmed decisions and reports, and the file selection. The code
 * enforces it: until it has been called in this phase (and, on the research track, for this investigation), the
 * phase's tool list holds only this tool (registry.buildToolsForPhase, runner.prepareStep).
 *
 * "Called in this phase" is read from the Workspace log: the registry logs every call with `阶段=<phase>` in its
 * reason, and this tool's change line names the plan it read, whose path holds the investigation folder.
 */
import { z } from 'zod';
import { confirmedConclusions, ownerOpinions, type Conclusion, type Opinion } from '@/lib/research/premises';
import { readSelection, type Selection } from '@/lib/research/selection';
import type { Vault } from '@/lib/vault';
import { listWorkplans } from '@/lib/workplan/state';
import type { ToolContext, ToolSpec } from '../types';

export const READ_TASK_CONTEXT = 'read_task_context' as const;

export interface TaskContext {
  /** 决策契约.md as stored (its fields and status), or null when the project has none yet. */
  contract: Record<string, unknown> | null;
  /** The latest workplan (研究计划) and, on the research track, the investigation plan (调查计划): `[[link]]（status）` + an excerpt. */
  /** `dir`: the investigation folder on the research track (null on the workspace track) — the log line names it. */
  plan: { workplan: string | null; research: string | null; dir: string | null };
  opinions: Opinion[];
  /** The project's confirmed decisions: name and its 决定 section. */
  decisions: { name: string; decision: string }[];
  /** The confirmed reports' So what (and those other projects published). */
  reports: Conclusion[];
  selection: Selection;
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);
const section = (body: string, heading: string) => body.split(new RegExp(`^${heading}\\s*$`, 'm'))[1]?.split(/^## /m)[0]?.trim() ?? '';

async function listDir(vault: Vault, dir: string) {
  try {
    return await vault.list(dir);
  } catch {
    return [];
  }
}

export async function loadTaskContext(ctx: ToolContext): Promise<TaskContext> {
  const { vault, projectPath, workspacePath } = ctx;
  const contractPath = `${projectPath}/决策契约.md`;
  const contract = (await vault.exists(contractPath)) ? { path: contractPath, ...(await vault.read(contractPath)).data } : null;

  const latest = (await listWorkplans(vault, workspacePath)).at(-1) ?? null;
  const workplan = latest ? `[[${latest.path.replace(/\.md$/, '')}|workplan v${latest.version}]]（${latest.note.status}）\n${clip(latest.body.trim(), 1500)}` : null;
  let research: string | null = null;
  if (ctx.research?.planPath) {
    const n = await vault.read(ctx.research.planPath);
    research = `[[${ctx.research.planPath.replace(/\.md$/, '')}|${ctx.research.planPath.split('/').pop()?.replace(/\.md$/, '')}]]（${String(n.data.status)}）\n${clip(n.body.trim(), 1500)}`;
  }

  const decisions: TaskContext['decisions'] = [];
  for (const e of await listDir(vault, `${projectPath}/决策`)) {
    if (e.kind !== 'file') continue;
    const n = await vault.read(e.path).catch(() => null);
    if (n?.note?.type !== 'decision' || n.note.status !== '已确认') continue;
    decisions.push({ name: n.title, decision: section(n.body, '## 决定') || n.note.reason });
  }

  return {
    contract,
    plan: { workplan, research, dir: ctx.research?.dir ?? null },
    opinions: await ownerOpinions(vault, workspacePath),
    decisions,
    reports: await confirmedConclusions(vault, workspacePath),
    selection: ctx.selection ?? (await readSelection(vault, workspacePath)),
  };
}

/** What the log line of a read says: which plan it read (the investigation folder is in its path). */
export function taskContextScope(ctx: Pick<ToolContext, 'research'>): string {
  return ctx.research?.dir ?? '';
}

/** Has the task context been read in this phase (and investigation)? From the Workspace log. */
export async function taskContextReadIn(vault: Vault, logPath: string, ctx: Pick<ToolContext, 'phase' | 'research'>): Promise<boolean> {
  const scope = taskContextScope(ctx);
  const log = await vault.readLog(logPath).catch(() => []);
  return log.some((e) => e.action === `tool:${READ_TASK_CONTEXT}` && e.reason.endsWith(`阶段=${ctx.phase}`) && (!scope || e.change.includes(`调查=${scope}`)));
}

export const readTaskContextParameters = z.object({});

export const readTaskContextTool: ToolSpec<typeof readTaskContextParameters, TaskContext> = {
  name: READ_TASK_CONTEXT,
  description:
    'Read your task context first: the decision contract, the workplan and investigation plan, the owner\'s opinions (direction, not evidence), the confirmed decisions and reports (premises), and which files you may read. Call it before anything else in this phase.',
  parameters: readTaskContextParameters,
  owner: 'M1',
  implemented: true,
  async execute(_args, ctx) {
    const out = await loadTaskContext(ctx);
    ctx.taskContextRead = true;
    return out;
  },
  // the investigation folder in the log line: taskContextReadIn finds it there (a plan may not exist yet)
  summarize: (_a, r) => `读取任务背景${r?.plan.dir ? `（调查=${r.plan.dir}）` : ''}：契约${r?.contract ? '有' : '无'}、意见 ${r?.opinions.length ?? 0} 条、已确认决定 ${r?.decisions.length ?? 0} 条、已确认报告 ${r?.reports.length ?? 0} 份`,
};
