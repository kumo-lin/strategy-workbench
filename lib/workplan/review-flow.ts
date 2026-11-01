/**
 * G1 review flow, server side (PRD §6.4, docs/CONTRACTS.md §4.3, dev plan 3-d).
 *
 * Each function is what one button does. They all take the acting human
 * (`Role`, read from the cookie by the route, never from the request body):
 *
 *   requestReview   Junior clicks "提交给 Senior" → review note + `review.request`
 *   addComment      someone but the requester leaves a comment on a pending review
 *   decideReview    the reviewer clicks 通过 / 打回 → `review.approve` / `review.reject`
 *   recordAnswer    Junior answers an ask_user card → one log row
 *
 * Permission is checked by `planApprovalEvent` (owner / reviewer), before any
 * side effect is written. No AI tool calls these.
 */
import path from 'node:path';
import type { Role } from '@/lib/config/roles';
import { ApprovalDenied, applyApprovalEvent, eventReads, planApprovalEvent, type ApprovalEvent } from '@/lib/harness/events';
import type { Gate, ReviewNote } from '@/lib/notes/schema';
import { parseWikiLink, toWikiLink, VaultError, type Vault } from '@/lib/vault';
import { appendCommentLine, formatCommentLine, nextCommentNumber, parseComments, commentLink, sanitizeCommentText } from './comments';
import { latestWorkplan, listReviews, reviewDir, workspaceOfReview } from './state';
import { localDate } from '@/lib/local-date';

export class ReviewFlowError extends Error {
  name = 'ReviewFlowError';
}

const today = localDate;

/** Dry-run an approval event: throws ApprovalDenied if the actor may not do it now. */
export async function preflightEvent(vault: Vault, event: ApprovalEvent, now = new Date()): Promise<void> {
  const state: Record<string, import('@/lib/notes/schema').NoteFrontmatter | undefined> = {};
  for (const p of eventReads(event)) if (await vault.exists(p)) state[p] = (await vault.read(p)).note ?? undefined;
  const plan = planApprovalEvent(event, state, now.toISOString());
  if (!plan.ok) throw new ApprovalDenied(plan.reason);
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ── request ──────────────────────────────────────────────────────────────────

export interface RequestReviewInput {
  vault: Vault;
  actor: Role;
  workspacePath: string;
  gate: Gate;
  /** Vault path of the workplan being submitted. Must be the latest version. */
  subject: string;
  /** What the AI prepared with `submit_for_review`; shown to the reviewer. */
  summary: string;
  focus: string[];
  now?: Date;
}

export async function requestReview(input: RequestReviewInput): Promise<{ reviewPath: string }> {
  const { vault, actor, workspacePath, gate, subject, summary, focus } = input;
  const now = input.now ?? new Date();
  if (gate !== 'G1' && gate !== '结论') {
    throw new ReviewFlowError(`目前只支持 G1 和 结论 两道审批（收到 ${gate}）`);
  }

  const workspacePathNote = `${workspacePath}/workspace.md`;
  const ws = await vault.readTyped(workspacePathNote, 'workspace');
  if (gate === 'G1') {
    const latest = await latestWorkplan(vault, workspacePath);
    if (!latest || latest.path !== subject) {
      throw new ReviewFlowError(`送审的必须是最新版本${latest ? `（${latest.path}）` : ''}，收到 ${subject}`);
    }
  } else {
    const reportPath = new RegExp(`^${escapeRegExp(workspacePath)}/调查/[^/]+/报告 v\\d+\\.md$`);
    if (!reportPath.test(subject) || !(await vault.exists(subject))) {
      throw new ReviewFlowError(`送审的必须是这个 Workspace 里已交付的报告，收到 ${subject}`);
    }
    const { data } = await vault.read(subject);
    if (data.type !== 'report') throw new ReviewFlowError(`送审的必须是这个 Workspace 里已交付的报告，收到 ${subject}`);
    if (data.delivery === '草稿') throw new ReviewFlowError('这份报告还是草稿（自检没有通过），不能提交');
    if (data.delivery !== '已交付') throw new ReviewFlowError(`送审的必须是这个 Workspace 里已交付的报告，收到 ${subject}`);
  }
  const open = (await listReviews(vault, workspacePath)).some((r) => r.note.gate === gate && r.note.result === null);
  if (open) {
    throw new ReviewFlowError(
      gate === '结论' ? '上一份报告还在等 Senior 确认，确认或打回之后才能再提交。' : '上一份征求意见还在等 Senior 回复，回复之后才能再发。',
    );
  }
  const event: ApprovalEvent = { type: 'review.request', actor, workspace: workspacePathNote, gate, subject };
  await preflightEvent(vault, event, now);

  const date = today(now);
  let name = `${gate} ${date}`;
  for (let i = 2; await vault.exists(`${reviewDir(workspacePath)}/${name}.md`); i++) name = `${gate} ${date} (${i})`;
  const reviewPath = `${reviewDir(workspacePath)}/${name}.md`;

  const subjectLink = toWikiLink(subject.replace(/\.md$/, ''), { alias: path.posix.basename(subject, '.md') });
  const body = [
    `# ${gate} 审批 ${date}`,
    '',
    `> 提交人：${actor.name}　审批人：${ws.note.reviewer}　送审：${subjectLink}`,
    '',
    '## 提交说明',
    '',
    summary.trim(),
    '',
    '## 请重点看',
    '',
    ...(focus.length ? focus.map((f) => `- ${f.trim()}`) : ['- （未指定）']),
    '',
    '## Comment',
    '',
  ].join('\n');

  await vault.write(reviewPath, {
    frontmatter: {
      id: `${ws.note.id}-review-${slug(gate)}-${date}${name.includes('(') ? `-${name.match(/\((\d+)\)/)![1]}` : ''}`,
      type: 'review',
      status: '进行中',
      created: now.toISOString(),
      updated: now.toISOString(),
      author: actor.name,
      derived_from: [toWikiLink(subject.replace(/\.md$/, ''), { alias: path.posix.basename(subject, '.md') })],
      relates_to: [toWikiLink(workspacePathNote.replace(/\.md$/, ''), { alias: path.posix.basename(workspacePath) })],
      requester: actor.name,
      reviewer: ws.note.reviewer,
      result: null,
      gate,
    },
    body,
  });
  await vault.appendLog(`${workspacePath}/日志.md`, {
    time: now.toISOString(),
    actor: actor.name,
    action: `write:review/${name}`,
    change: `新建 ${name}（送审 ${path.posix.basename(subject, '.md')}）`,
    reason: '提交给 Senior 审批',
  });
  await applyApprovalEvent(vault, event, { now, logPath: `${workspacePath}/日志.md`, reason: `${actor.name} 点了"提交给 Senior"` });
  return { reviewPath };
}

// ── comment ──────────────────────────────────────────────────────────────────

export interface AddCommentInput {
  vault: Vault;
  actor: Role;
  reviewPath: string;
  text: string;
  /** Which part of the workplan this is about, e.g. a heading. */
  target?: string;
  now?: Date;
}

async function readPendingReview(vault: Vault, reviewPath: string) {
  if (!reviewPath.includes('/review/') || !(await vault.exists(reviewPath))) throw new ReviewFlowError(`找不到审批笔记 ${reviewPath}`);
  const r = await vault.readTyped(reviewPath, 'review');
  return r;
}

export async function addComment(input: AddCommentInput): Promise<{ id: string; link: string }> {
  const { vault, actor, reviewPath } = input;
  const now = input.now ?? new Date();
  const text = sanitizeCommentText(input.text);
  if (!text) throw new ReviewFlowError('comment 不能为空');
  if (text.length > 2000) throw new ReviewFlowError('comment 太长（最多 2000 字）');
  const review = await readPendingReview(vault, reviewPath);
  if (review.note.result !== null) throw new ReviewFlowError('这次审批已经有结论，不能再加 comment');
  if (actor.name === review.note.requester) throw new ReviewFlowError('不能给自己提交的审批留 comment');

  const n = nextCommentNumber(review.body);
  const id = `m${n}`;
  const body = appendCommentLine(review.body, formatCommentLine({ n, author: actor.name, text, target: input.target }));
  await vault.write(reviewPath, { frontmatter: { ...review.data, updated: now.toISOString() }, body }, { overwrite: true });
  const workspacePath = workspaceOfReview(reviewPath);
  await vault.appendLog(`${workspacePath}/日志.md`, {
    time: now.toISOString(),
    actor: actor.name,
    action: `comment:${path.posix.basename(reviewPath, '.md')}`,
    change: `留下 ${id}：${text.length > 60 ? `${text.slice(0, 60)}…` : text}`,
    reason: '审批 comment',
  });
  return { id, link: commentLink(reviewPath, id) };
}

// ── decide ───────────────────────────────────────────────────────────────────

export interface DecideReviewInput {
  vault: Vault;
  actor: Role;
  reviewPath: string;
  decision: 'approve' | 'reject';
  now?: Date;
}

export async function decideReview(input: DecideReviewInput): Promise<{ summary: string }> {
  const { vault, actor, reviewPath, decision } = input;
  const now = input.now ?? new Date();
  const review = await readPendingReview(vault, reviewPath);
  if (review.note.result !== null) throw new ReviewFlowError('这次审批已经有结论了');
  const subjectLink = review.note.derived_from[0];
  const resolved = subjectLink ? await vault.resolveLink(parseWikiLink(subjectLink)!, reviewPath) : null;
  if (!resolved?.ok) throw new ReviewFlowError(`找不到这次审批送审的${review.note.gate === '结论' ? '报告' : ' workplan'}`);
  if (decision === 'reject' && parseComments(review.body).length === 0) {
    throw new ReviewFlowError('打回之前至少留一条 comment，说明哪里要改');
  }
  const workspacePath = workspaceOfReview(reviewPath);
  const event: ApprovalEvent = {
    type: decision === 'approve' ? 'review.approve' : 'review.reject',
    actor,
    workspace: `${workspacePath}/workspace.md`,
    gate: review.note.gate,
    subject: resolved.path,
  };
  await preflightEvent(vault, event, now);
  const applied = await applyApprovalEvent(vault, event, {
    now,
    logPath: `${workspacePath}/日志.md`,
    reason: `${actor.name} 点了"${decision === 'approve' ? '看过了' : '有意见'}"`,
  });
  const result: NonNullable<ReviewNote['result']> = decision === 'approve' ? '通过' : '打回';
  const body = `${review.body.replace(/\s+$/, '')}\n\n## 审批结果\n\n${actor.name}：${result}（${now.toISOString()}）\n`;
  await vault.write(
    reviewPath,
    { frontmatter: { ...review.data, result, status: '已确认', updated: now.toISOString() }, body },
    { overwrite: true },
  );
  return { summary: applied.summary };
}

// ── answers ──────────────────────────────────────────────────────────────────

/** The human half of an ask_user call. (The AI half is logged by the runner.) */
export async function recordAnswer(input: {
  vault: Vault;
  actor: Role;
  workspacePath: string;
  question: string;
  answer: string;
  /** The card was sent back to the model (not answered by the human): logged as the AI's, not the human's. */
  rejected?: boolean;
  now?: Date;
}): Promise<void> {
  const { vault, actor, workspacePath } = input;
  const logPath = `${workspacePath}/日志.md`;
  if (!(await vault.exists(logPath))) throw new VaultError('not_found', `no log at ${logPath}`);
  const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);
  if (input.rejected) {
    await vault.appendLog(logPath, {
      time: (input.now ?? new Date()).toISOString(),
      actor: 'AI',
      action: 'reject:ask_user',
      change: `提问卡被退回：${clip(input.answer, 200)}`,
      reason: `提问：${clip(input.question, 120)}`,
    });
    return;
  }
  await vault.appendLog(logPath, {
    time: (input.now ?? new Date()).toISOString(),
    actor: actor.name,
    action: 'answer:ask_user',
    change: `回答：${clip(input.answer, 200)}`,
    reason: `回答 AI 的提问：${clip(input.question, 120)}`,
  });
}
