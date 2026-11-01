/**
 * Serializable view models for the Workspace page, built on the server from
 * the vault and passed to client components as props.
 */
import { planDocFromBody, type PlanDoc } from './plan-doc';
import type { NoteStatus, ReviewNote } from '@/lib/notes/schema';
import type { Vault } from '@/lib/vault';
import { parseWikiLink } from '@/lib/vault';
import type { ReviewComment } from './comments';
import { projectHasQuestionTree } from './legacy-note';
import { hasQuestionTree } from './workplan-tree';
import {
  listCommentRefs,
  listReviews,
  listWorkplans,
  normalizeCommentLink,
  type CommentRef,
  type ReviewEntry,
} from './state';

// ── view types ───────────────────────────────────────────────────────────────

export interface CommentView {
  id: string;
  /** `[[…/review/G1 2026-10-24#^m1]]` */
  link: string;
  text: string;
  author: string;
  target?: string;
  reviewPath: string;
  reviewName: string;
  gate: ReviewNote['gate'];
  /** null while the review is pending. */
  result: ReviewNote['result'];
  /** Workplan versions whose `changes` point at this comment. */
  handledIn: number[];
}

export interface WorkplanChangeView {
  /** The link stored in `changes[].comment`. */
  comment: string;
  /** `m1`; null when the link does not point at a comment block. */
  commentId: string | null;
  commentText: string | null;
  commentAuthor: string | null;
  reviewName: string | null;
  /** Intent we understood behind the comment. */
  intent: string;
  /** What changed. */
  change: string;
  /** False when the link does not resolve to an existing comment. */
  traced: boolean;
}

export interface WorkplanVersionView {
  version: number;
  path: string;
  status: NoteStatus;
  author: string;
  created: string;
  approvedBy: string | null;
  approvedAt: string | null;
  body: string;
  changes: WorkplanChangeView[];
  /** 0-based indexes of lines in `body` that are new or reworded compared with the previous version. */
  changedLines: number[];
  /** The version is not a question-tree workplan and the project has one elsewhere: the page says it predates the tree (D-39). */
  beforeQuestionTree: boolean;
  /** D-64 T35: the plan as a document, read from this version's body (absent for an incomplete older workplan). */
  tree?: PlanDoc;
}

export interface ReviewView {
  path: string;
  name: string;
  gate: ReviewNote['gate'];
  result: ReviewNote['result'];
  requester: string;
  reviewer: string;
  created: string;
  /** workplan version under review, if it can be told. */
  version: number | null;
  summary: string;
  focus: string[];
  comments: CommentView[];
}

// ── diff ─────────────────────────────────────────────────────────────────────

/** Indexes (0-based) of lines in `next` that have no equal line in `prev`, via LCS. */
export function addedLines(prev: string, next: string): number[] {
  const a = prev.split(/\r?\n/).map((l) => l.trim());
  const b = next.split(/\r?\n/);
  const bt = b.map((l) => l.trim());
  const n = a.length;
  const m = bt.length;
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i][j] = a[i] === bt[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }
  const added: number[] = [];
  let i = 0;
  let j = 0;
  while (j < m) {
    if (i < n && a[i] === bt[j]) {
      i++;
      j++;
    } else if (i < n && lcs[i + 1][j] >= lcs[i][j + 1]) {
      i++;
    } else {
      if (bt[j] !== '') added.push(j);
      j++;
    }
  }
  return added;
}

// ── builders ─────────────────────────────────────────────────────────────────

function commentView(c: CommentRef): CommentView {
  return {
    id: c.id,
    link: c.link,
    text: c.text,
    author: c.author,
    ...(c.target ? { target: c.target } : {}),
    reviewPath: c.reviewPath,
    reviewName: c.reviewName,
    gate: c.gate,
    result: c.result,
    handledIn: c.handledIn,
  };
}

export async function buildCommentViews(vault: Vault, workspacePath: string): Promise<CommentView[]> {
  return (await listCommentRefs(vault, workspacePath)).map(commentView);
}

export async function buildWorkplanViews(vault: Vault, workspacePath: string): Promise<WorkplanVersionView[]> {
  const [workplans, refs] = await Promise.all([listWorkplans(vault, workspacePath), listCommentRefs(vault, workspacePath)]);
  const byLink = new Map(refs.map((r) => [normalizeCommentLink(r.link), r]));
  const projectMoved = workplans.some((w) => !hasQuestionTree(w.body)) && (await projectHasQuestionTree(vault, workspacePath));
  const trees = workplans.map((w) => planDocFromBody(w.body));
  return workplans.map((w, idx) => ({
    ...(trees[idx] ? { tree: trees[idx] } : {}),
    version: w.version,
    path: w.path,
    status: w.note.status,
    author: w.note.author,
    created: w.note.created,
    approvedBy: w.note.approved_by,
    approvedAt: w.note.approved_at,
    body: w.body,
    beforeQuestionTree: projectMoved && !hasQuestionTree(w.body),
    changedLines: idx === 0 ? [] : addedLines(workplans[idx - 1].body, w.body),
    changes: w.note.changes.map((c) => {
      const ref = byLink.get(normalizeCommentLink(c.comment));
      return {
        comment: c.comment,
        commentId: ref?.id ?? null,
        commentText: ref?.text ?? null,
        commentAuthor: ref?.author || null,
        reviewName: ref?.reviewName ?? null,
        intent: c.intent,
        change: c.change,
        traced: Boolean(ref),
      };
    }),
  }));
}

/** `## 提交说明` and `## 请重点看` sections of a review note written by `requestReview`. */
export function parseReviewBody(body: string): { summary: string; focus: string[] } {
  const section = (title: string) => {
    const m = new RegExp(`^## ${title}\\s*\\n([\\s\\S]*?)(?=^## |(?![\\s\\S]))`, 'm').exec(body);
    return m ? m[1].trim() : '';
  };
  return {
    summary: section('提交说明'),
    focus: section('请重点看')
      .split('\n')
      .map((l) => l.replace(/^-\s*/, '').trim())
      .filter(Boolean),
  };
}

function reviewView(r: ReviewEntry, refs: CommentRef[]): ReviewView {
  const subject = r.note.derived_from[0] ? parseWikiLink(r.note.derived_from[0])?.target : undefined;
  const v = subject ? /workplan v(\d+)$/.exec(subject)?.[1] : undefined;
  return {
    path: r.path,
    name: r.name,
    gate: r.note.gate,
    result: r.note.result,
    requester: r.note.requester,
    reviewer: r.note.reviewer,
    created: r.note.created,
    version: v ? Number(v) : null,
    ...parseReviewBody(r.body),
    comments: refs.filter((c) => c.reviewPath === r.path).map(commentView),
  };
}

/** Newest first. */
export async function buildReviewViews(vault: Vault, workspacePath: string): Promise<ReviewView[]> {
  const [reviews, refs] = await Promise.all([listReviews(vault, workspacePath), listCommentRefs(vault, workspacePath)]);
  return reviews.map((r) => reviewView(r, refs)).reverse();
}

export type { ReviewComment };
