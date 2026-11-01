/**
 * Read-side helpers for a Workspace's workplan versions, review notes and
 * comments. Everything here only reads the vault.
 */
import path from 'node:path';
import type { ReviewNote, WorkplanNote } from '@/lib/notes/schema';
import type { Vault } from '@/lib/vault';
import { commentLink, parseComments, type ReviewComment } from './comments';

export interface WorkplanVersion {
  version: number;
  path: string;
  note: WorkplanNote;
  body: string;
}

export interface ReviewEntry {
  path: string;
  /** File name without `.md`, e.g. `G1 2026-10-24`. */
  name: string;
  note: ReviewNote;
  body: string;
  comments: ReviewComment[];
}

/** A comment together with where it lives and whether a workplan version has acted on it. */
export interface CommentRef extends ReviewComment {
  /** `[[…/review/G1 2026-10-24#^m1]]` */
  link: string;
  reviewPath: string;
  reviewName: string;
  gate: ReviewNote['gate'];
  /** null while the review is pending. */
  result: ReviewNote['result'];
  /** Workplan versions whose `changes` point at this comment. */
  handledIn: number[];
}

export function workplanPath(workspacePath: string, version: number): string {
  return `${workspacePath}/workplan v${version}.md`;
}

export function reviewDir(workspacePath: string): string {
  return `${workspacePath}/review`;
}

/** Workspace folder a review note path belongs to (`…/<Workspace>/review/<x>.md` → `…/<Workspace>`). */
export function workspaceOfReview(reviewPath: string): string {
  return path.posix.dirname(path.posix.dirname(reviewPath));
}

async function listDir(vault: Vault, dir: string) {
  try {
    return await vault.list(dir);
  } catch {
    return [];
  }
}

/** All `workplan vN.md` of a Workspace, oldest first. Notes that fail validation are skipped. */
export async function listWorkplans(vault: Vault, workspacePath: string): Promise<WorkplanVersion[]> {
  const out: WorkplanVersion[] = [];
  for (const e of await listDir(vault, workspacePath)) {
    const m = /^workplan v(\d+)\.md$/.exec(e.name);
    if (e.kind !== 'file' || !m) continue;
    const n = await vault.read(e.path);
    if (n.note?.type !== 'workplan') continue;
    out.push({ version: Number(m[1]), path: e.path, note: n.note, body: n.body });
  }
  return out.sort((a, b) => a.version - b.version);
}

export async function latestWorkplan(vault: Vault, workspacePath: string): Promise<WorkplanVersion | null> {
  const all = await listWorkplans(vault, workspacePath);
  return all[all.length - 1] ?? null;
}

/** All review notes of a Workspace, oldest first (by file name, which starts with gate and date). */
export async function listReviews(vault: Vault, workspacePath: string): Promise<ReviewEntry[]> {
  const out: ReviewEntry[] = [];
  for (const e of await listDir(vault, reviewDir(workspacePath))) {
    if (e.kind !== 'file') continue;
    const n = await vault.read(e.path);
    if (n.note?.type !== 'review') continue;
    out.push({ path: e.path, name: e.name.replace(/\.md$/, ''), note: n.note, body: n.body, comments: parseComments(n.body) });
  }
  return out.sort((a, b) => a.note.created.localeCompare(b.note.created) || a.name.localeCompare(b.name));
}

/** Every comment of every review of this Workspace, with the workplan versions that handled it. */
export async function listCommentRefs(vault: Vault, workspacePath: string): Promise<CommentRef[]> {
  const [reviews, workplans] = await Promise.all([listReviews(vault, workspacePath), listWorkplans(vault, workspacePath)]);
  const handled = new Map<string, number[]>();
  for (const wp of workplans) {
    for (const c of wp.note.changes) {
      const key = normalizeCommentLink(c.comment);
      handled.set(key, [...new Set([...(handled.get(key) ?? []), wp.version])]);
    }
  }
  const out: CommentRef[] = [];
  for (const r of reviews) {
    for (const c of r.comments) {
      const link = commentLink(r.path, c.id);
      out.push({
        ...c,
        link,
        reviewPath: r.path,
        reviewName: r.name,
        gate: r.note.gate,
        result: r.note.result,
        handledIn: handled.get(normalizeCommentLink(link)) ?? [],
      });
    }
  }
  return out;
}

/** `[[a/b#^m1|别名]]` → `a/b#^m1`, so two spellings of the same comment compare equal. */
export function normalizeCommentLink(link: string): string {
  return link.replace(/^\[\[/, '').replace(/\]\]$/, '').replace(/\|.*$/, '').replace(/\.md(?=#)/, '').trim();
}

/** Earlier comments by the same reviewer in other Workspaces of the project (inputs to intent reading, PRD §6.2 step 3). */
export async function listReviewerHistory(
  vault: Vault,
  projectPath: string,
  excludeWorkspacePath: string,
  reviewer: string,
): Promise<{ reviewPath: string; workspace: string; comments: ReviewComment[] }[]> {
  const out: { reviewPath: string; workspace: string; comments: ReviewComment[] }[] = [];
  for (const e of await listDir(vault, projectPath)) {
    if (e.kind !== 'dir' || e.path === excludeWorkspacePath) continue;
    for (const r of await listReviews(vault, e.path)) {
      if (r.note.reviewer !== reviewer || r.comments.length === 0) continue;
      out.push({ reviewPath: r.path, workspace: e.name, comments: r.comments });
    }
  }
  return out;
}
