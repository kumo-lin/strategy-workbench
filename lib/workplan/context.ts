/**
 * Context assembly for the workplan phase prompt (PRD §10.2 context 组装):
 * method-library skills, project state, 高层指示, related confirmed decisions,
 * this Workspace's workplan / hypotheses / reviews, and the recent log.
 *
 * `gatherWorkplanContext` reads the vault; the prompt text is rendered from the
 * result by `renderWorkplanPrompt` (lib/harness/prompts/workplan.ts), which is pure.
 */
import path from 'node:path';
import type { ToolContext } from '@/lib/harness/types';
import type { LogEntry, Vault } from '@/lib/vault';
import { parseWikiLink, toWikiLink } from '@/lib/vault';
import type { ProjectNote, WorkspaceNote } from '@/lib/notes/schema';
import type { ReviewComment } from './comments';
import {
  listCommentRefs,
  listReviewerHistory,
  listReviews,
  listWorkplans,
  workplanPath,
  type CommentRef,
  type ReviewEntry,
  type WorkplanVersion,
} from './state';
import { localDate } from '@/lib/local-date';
import { countCocreateAsks } from './ask-budget';
import { isRedoPending } from './redo';
import { isFirstCocreate } from './compose/cocreate';
import { readState } from './compose/state';
import type { ComposeState } from './compose/types';
import { confirmedConclusions, ownerOpinions, type Conclusion, type Opinion } from '@/lib/research/premises';

export const METHOD_DIR = '00_团队知识/方法库';

export interface NoteExcerpt {
  path: string;
  title: string;
  /** `[[…|…]]` link to paste into derived_from / relates_to. */
  link: string;
  body: string;
  meta?: string;
}

export interface WorkplanContext {
  role: { name: string; kind: 'senior' | 'junior' };
  today: string;
  workspacePath: string;
  workspaceName: string;
  /** `WS-A` — prefix of hypothesis note names. */
  wsCode: string;
  workspace: WorkspaceNote;
  project: ProjectNote | null;
  roadmapTopic: string | null;
  /** Links ready to paste. */
  links: { project: string; workspace: string; methods: string[]; latestWorkplan: string | null };
  /** Skills from the method library, in full. */
  skills: { cocreate: NoteExcerpt | null; intent: NoteExcerpt | null };
  /** Other method-library notes: names only. */
  otherMethods: string[];
  directives: NoteExcerpt[];
  decisions: NoteExcerpt[];
  hypotheses: { path: string; name: string; link: string; statement: string; status: string }[];
  nextHypothesisNumber: number;
  workplans: WorkplanVersion[];
  latest: WorkplanVersion | null;
  nextVersion: number;
  /**
   * Which file the next workplan write goes to (the rules write_draft enforces, see
   * lib/workplan/draft-checks.ts): rewrite the latest draft while it has not been
   * submitted, otherwise a new version.
   */
  writeTarget: { version: number; overwrite: boolean; previousLink: string | null; lockedReason: string | null };
  /** The Junior asked for a redo and no workplan has been written since (lib/workplan/redo.ts). */
  redoPending: boolean;
  reviews: ReviewEntry[];
  comments: CommentRef[];
  /** Same reviewer's comments elsewhere in the project. */
  reviewerHistory: { reviewPath: string; workspace: string; comments: ReviewComment[] }[];
  log: LogEntry[];
  /** D-64 T16: the project's confirmed conclusions (premises) and the owner's opinions (direction). */
  conclusions: Conclusion[];
  opinions: Opinion[];
  /** ask_user calls used since the last workplan write (lib/workplan/ask-budget.ts). */
  cocreateAsks: number;
  /**
   * `active` = this is the co-creation the compose pipeline drafts (lib/workplan/compose): the model frames the topic
   * and calls compose_workplan instead of writing the workplan itself. `state` is then the state file (frame, pack, marks).
   */
  compose: { active: boolean; state: ComposeState | null };
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}\n…（已截断，完整内容用 vault_read 读取）` : s);

export function wikiLinkTo(notePath: string, alias?: string): string {
  return toWikiLink(notePath.replace(/\.md$/, ''), alias ? { alias } : {});
}

async function excerpt(vault: Vault, notePath: string, max: number, meta?: (n: Awaited<ReturnType<Vault['read']>>) => string): Promise<NoteExcerpt> {
  const n = await vault.read(notePath);
  return {
    path: notePath,
    title: n.title,
    link: wikiLinkTo(notePath, n.title),
    body: clip(n.body.trim(), max),
    meta: meta?.(n),
  };
}

async function safeList(vault: Vault, dir: string) {
  try {
    return (await vault.list(dir)).filter((e) => e.kind === 'file');
  } catch {
    return [];
  }
}

export async function gatherWorkplanContext(ctx: ToolContext): Promise<WorkplanContext> {
  const { vault, workspacePath, projectPath } = ctx;
  const workspaceName = path.posix.basename(workspacePath);
  const wsCode = workspaceName.split(/\s+/)[0];

  // method library
  const methodFiles = await safeList(vault, METHOD_DIR);
  let cocreate: NoteExcerpt | null = null;
  let intent: NoteExcerpt | null = null;
  const otherMethods: string[] = [];
  const methodLinks: string[] = [];
  for (const f of methodFiles) {
    const name = f.name.replace(/\.md$/, '');
    methodLinks.push(wikiLinkTo(f.path, name));
    if (!cocreate && /workplan|共创/.test(name)) cocreate = await excerpt(vault, f.path, 14000);
    else if (!intent && /comment|意图/i.test(name)) intent = await excerpt(vault, f.path, 9000);
    else otherMethods.push(name);
  }

  // project
  const projectNotePath = `${projectPath}/项目.md`;
  const projectNote = (await vault.exists(projectNotePath)) ? (await vault.read(projectNotePath)).note : null;
  const project = projectNote?.type === 'project' ? projectNote : null;
  const wsLinkPath = `${workspacePath}/workspace`;
  const roadmapTopic =
    project?.roadmap?.find((r) => r.workspaces.some((l) => parseWikiLink(l)?.target === wsLinkPath))?.topic ?? null;

  // 高层指示 (meetings), newest first
  const meetings = (await safeList(vault, `${projectPath}/会议`)).sort((a, b) => b.name.localeCompare(a.name)).slice(0, 3);
  const directives = await Promise.all(
    meetings.map((m) => excerpt(vault, m.path, 1800, (n) => (n.data.simulated ? '模拟的会议转写稿' : '会议记录'))),
  );

  // confirmed decisions
  const decisionFiles = await safeList(vault, `${projectPath}/决策`);
  const decisions: NoteExcerpt[] = [];
  for (const f of decisionFiles) {
    const n = await vault.read(f.path);
    if (n.note?.type === 'decision' && n.note.status === '已确认') {
      decisions.push(await excerpt(vault, f.path, 800, () => `决定人：${n.note?.type === 'decision' ? n.note.decided_by : ''}`));
    }
  }

  // hypotheses of this workspace
  const hypFiles = await safeList(vault, `${projectPath}/假设`);
  const hypotheses: WorkplanContext['hypotheses'] = [];
  let maxHyp = 0;
  for (const f of hypFiles) {
    const n = await vault.read(f.path);
    if (n.note?.type !== 'hypothesis' || parseWikiLink(n.note.workspace)?.target !== wsLinkPath) continue;
    const name = f.name.replace(/\.md$/, '');
    const num = Number(new RegExp(`^${wsCode}-H(\\d+)`).exec(name)?.[1] ?? 0);
    maxHyp = Math.max(maxHyp, num);
    hypotheses.push({ path: f.path, name, link: wikiLinkTo(f.path, name), statement: n.note.statement, status: n.note.status });
  }

  const [workplans, reviews, comments, log] = await Promise.all([
    listWorkplans(vault, workspacePath),
    listReviews(vault, workspacePath),
    listCommentRefs(vault, workspacePath),
    vault.readLog(ctx.logPath),
  ]);
  const latest = workplans[workplans.length - 1] ?? null;
  const redoPending = isRedoPending(log);
  let lockedReason: string | null = null;
  if (latest?.note.approved_at) lockedReason = `已由 ${latest.note.approved_by} 看过`;
  for (const r of reviews) {
    if (lockedReason || !latest || !r.note.derived_from[0]) continue;
    const subject = await vault.resolveLink(r.note.derived_from[0], r.path);
    if (subject.ok && subject.path === latest.path) lockedReason = `已经送审过（${r.name}）`;
  }
  if (!lockedReason && latest && latest.note.author !== 'AI') lockedReason = `这一版是 ${latest.note.author} 手改的，不能覆盖`;
  // A pending redo makes the latest behave like a locked version for version / previous
  // purposes (write vN+1), but it never replaces an approval/submission reason.
  if (redoPending && latest && !lockedReason) lockedReason = '你要求重新做一版，旧版本保留';
  const targetVersion = !latest ? 1 : lockedReason ? latest.version + 1 : latest.version;
  const previous = workplans.find((w) => w.version === targetVersion - 1);
  const composeActive = isFirstCocreate(ctx.workspace, workplans.length, redoPending);
  const reviewerHistory = await listReviewerHistory(vault, projectPath, workspacePath, ctx.workspace.reviewer);

  return {
    role: { name: ctx.role.name, kind: ctx.role.kind },
    today: localDate(ctx.now()),
    workspacePath,
    workspaceName,
    wsCode,
    workspace: ctx.workspace,
    project,
    roadmapTopic,
    links: {
      project: wikiLinkTo(projectNotePath, '项目'),
      workspace: wikiLinkTo(`${workspacePath}/workspace.md`, workspaceName),
      methods: methodLinks,
      latestWorkplan: latest ? wikiLinkTo(latest.path, `workplan v${latest.version}`) : null,
    },
    skills: { cocreate, intent },
    otherMethods,
    directives,
    decisions,
    hypotheses,
    nextHypothesisNumber: maxHyp + 1,
    workplans,
    latest,
    nextVersion: (latest?.version ?? 0) + 1,
    writeTarget: {
      version: targetVersion,
      overwrite: Boolean(latest && !lockedReason),
      previousLink: previous ? wikiLinkTo(previous.path, `workplan v${previous.version}`) : null,
      lockedReason,
    },
    redoPending,
    reviews,
    comments,
    reviewerHistory,
    log: log.slice(-12),
    conclusions: await confirmedConclusions(vault, workspacePath),
    opinions: await ownerOpinions(vault, workspacePath),
    cocreateAsks: countCocreateAsks(log),
    compose: { active: composeActive, state: composeActive ? await readState(vault, workspacePath) : null },
  };
}

export { workplanPath };
