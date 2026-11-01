/**
 * Write-time checks on AI drafts that need to read the vault (PRD §7 rule 4,
 * M1 acceptance: every workplan change traces to an existing comment).
 *
 * `write_draft` calls `checkDraft` just before it writes (CONTRACT-CHANGE m1-1).
 * Failures throw a plain Error: the registry logs it and the model sees the
 * message, so every message says what is missing and what to write instead.
 *
 * Workplan version rules
 * ──────────────────────
 * Two kinds of write, told apart by whether the file already exists:
 *
 *   overwrite vN   revise the latest, not-yet-submitted draft (e.g. the Junior asks
 *                  for an edit in chat). Allowed only for the latest version that the
 *                  AI wrote, never for a version a person edited by hand, never for a
 *                  version already sent to review.
 *                  Comment entries already in its `changes` must be kept (the
 *                  comment trail cannot silently disappear); new entries may be added.
 *                  Edits that come from the chat, not from a comment, need no entry.
 *
 *   new v(N+1)     must be exactly latest + 1 and list vN in `derived_from`.
 *                  If vN went through a decided review that left comments no
 *                  version has acted on yet, this version must act on at least one
 *                  of them (an entry may record "未修改：<理由>"). Otherwise
 *                  (e.g. G1 passed and the Junior updates scope after research)
 *                  `changes` may be empty.
 *
 * Always: every `changes[].comment` resolves to an existing `^mN` block in a review
 * note of THIS workspace.
 */
import path from 'node:path';
import { z } from 'zod';
import { workplanChangeSchema, type NoteType } from '@/lib/notes/schema';
import { parseWikiLink } from '@/lib/vault';
import type { ToolContext } from '@/lib/harness/types';
import { checkPlanDraft } from '@/lib/research/plan-checks';
import { hasQuestionTree, workplanTreeProblems, workplanTreeWarnings } from './workplan-tree';
import { inlineCommentExists, parseInlineCommentLink } from './inline-comments';
import { listCommentRefs, listReviews, listWorkplans, normalizeCommentLink, reviewDir, workplanPath } from './state';

export interface DraftCheckOptions {
  /** Vault path the draft will be written to. */
  path: string;
  /** True when the file already exists (write_draft overwrites only unapproved AI drafts). */
  overwriting: boolean;
}

export type DraftCheckContext = Pick<ToolContext, 'vault' | 'workspacePath' | 'workspace'>;

const LINK_FORMAT = '[[<review 笔记的完整路径，不带 .md>#^m<编号>]]，例如 [[20_项目/个人AI战略/WS-A 买方/review/G1 2026-10-24#^m1]]';

export async function checkDraft(
  type: NoteType,
  frontmatter: Record<string, unknown>,
  body: string,
  ctx: DraftCheckContext,
  opts: DraftCheckOptions,
): Promise<string[] | void> {
  // M2: a research plan's citations are checked at write time, like a report's (lib/research/plan-checks.ts).
  if (type === 'research_plan') return checkPlanDraft(body, ctx, frontmatter);
  if (type !== 'workplan') return;
  await checkWorkplanDraft(frontmatter, body, ctx, opts);
  return hasQuestionTree(body) ? workplanTreeWarnings(body) : [];
}

async function checkWorkplanDraft(fm: Record<string, unknown>, body: string, ctx: DraftCheckContext, opts: DraftCheckOptions): Promise<void> {
  const { vault, workspacePath } = ctx;
  const version = fm.version;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    throw new Error('frontmatter 缺少 version，或不是正整数。写 workplan v<N> 时要带 `version: <N>`。');
  }
  const fileVersion = /^workplan v(\d+)\.md$/.exec(path.posix.basename(opts.path))?.[1];
  if (Number(fileVersion) !== version) {
    throw new Error(`文件名是 workplan v${fileVersion}，frontmatter 却是 version: ${version}。两者要一致。`);
  }

  const changes = z.array(workplanChangeSchema).safeParse(fm.changes ?? []);
  if (!changes.success) {
    throw new Error(
      `changes 格式不对：${changes.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; ')}。每一项要写成 { comment: "[[…/review/G1 <日期>#^mN]]", intent: "理解到的意图", change: "改了什么" }；没有因 comment 而改的地方就写 changes: []。`,
    );
  }
  // Traceability first: a made-up link is the most useful thing to tell the model about.
  const reviewPrefix = `${reviewDir(workspacePath)}/`;
  const bad: string[] = [];
  for (const c of changes.data) {
    // a comment written on a workplan version (评论/workplan v<N>.json) is cited as [[…/评论/workplan v<N>#cN]]
    if (parseInlineCommentLink(c.comment)) {
      if (!(await inlineCommentExists(vault, workspacePath, c.comment))) bad.push(`${c.comment}（本 Workspace 的 评论/ 里没有这条）`);
      continue;
    }
    const check = await vault.checkCitation(c.comment, { fromPath: opts.path });
    if (!check.ok || !check.path?.startsWith(reviewPrefix)) {
      const why = check.ok ? '不在本 Workspace 的 review/ 下' : check.error === 'block_not_found' ? '没有这个 ^m 块' : check.error === 'ambiguous' ? '链接有歧义，要写完整路径' : '找不到这条笔记';
      bad.push(`${c.comment}（${why}）`);
    }
  }
  if (bad.length) {
    throw new Error(`这些 changes 追溯不到存在的 comment：${bad.join('、')}。comment 必须写成 ${LINK_FORMAT}，原样复制 comment 列表里给出的链接。`);
  }

  const entryLinks = changes.data.map((c) => normalizeCommentLink(c.comment));

  const existing = await listWorkplans(vault, workspacePath);
  const latest = existing[existing.length - 1];
  const latestVersion = latest?.version ?? 0;

  // D-39: a workplan is a question tree when it is the first one of its Workspace or the version it builds on (or revises) was; an older-format
  // Workspace keeps its format (nothing migrates, nothing is judged by the new rules).
  // (`latest` is the version being revised or built on, so both cases read the same one.)
  if (!latest || hasQuestionTree(latest.body)) {
    const problems = workplanTreeProblems(body);
    if (problems.length) {
      throw new Error(`workplan 的问题树不合格，要改：\n${problems.map((p) => `- ${p}`).join('\n')}\n\n正文的结构见系统提示里"workplan 的写法"；标题照抄，编号按顺序。`);
    }
  }

  if (opts.overwriting) {
    if (version !== latestVersion) {
      throw new Error(`workplan v${version} 不是最新版本（最新是 v${latestVersion}），旧版本不能改。要改就写 workplan v${latestVersion + 1}。`);
    }
    const current = await vault.read(opts.path);
    const author = String(current.data.author ?? '');
    if (author !== 'AI') {
      throw new Error(`workplan v${version} 是 ${author} 手改的，AI 不能覆盖。请写 workplan v${version + 1}，derived_from 里写上一版。`);
    }
    for (const r of await listReviews(vault, workspacePath)) {
      const subject = r.note.derived_from[0] ? await vault.resolveLink(r.note.derived_from[0], r.path) : null;
      if (subject?.ok && subject.path === opts.path) {
        throw new Error(`workplan v${version} 已经送审过（${r.name}），送审过的版本不能再改。请写 workplan v${version + 1}，derived_from 里写上一版。`);
      }
    }
    const kept = new Set(entryLinks);
    const dropped = latest!.note.changes.map((c) => c.comment).filter((l) => !kept.has(normalizeCommentLink(l)));
    if (dropped.length) {
      throw new Error(
        `改草稿时不能删掉已有的 changes 记录，这些 comment 的记录不见了：${dropped.join('、')}。原样保留它们（可以改 intent/change 的措辞，或写成 "未修改：<理由>"），再加新的。`,
      );
    }
  } else {
    if (version !== latestVersion + 1) {
      throw new Error(`下一个版本应该是 workplan v${latestVersion + 1}（现在最新是 v${latestVersion}），不能写 v${version}。`);
    }
    if (latest) {
      const previousLink = `[[${workplanPath(workspacePath, latestVersion).replace(/\.md$/, '')}|workplan v${latestVersion}]]`;
      const derived = await Promise.all(
        ((fm.derived_from as unknown[]) ?? []).map(async (l) => {
          const parsed = typeof l === 'string' ? parseWikiLink(l) : null;
          const r = parsed ? await vault.resolveLink(parsed, opts.path) : null;
          return r?.ok ? r.path : null;
        }),
      );
      if (!derived.includes(latest.path)) throw new Error(`derived_from 要包含上一版：${previousLink}`);

      const pending = await pendingCommentsOn(ctx, latest.path);
      if (pending.length && !pending.some((p) => entryLinks.includes(normalizeCommentLink(p)))) {
        throw new Error(
          `workplan v${latestVersion} 的审批留下了还没处理的 comment：${pending.join('、')}。新版本的 changes 至少要对应其中一条（{ comment, intent, change }；Junior 决定不改的，change 写 "未修改：<理由>"）。`,
        );
      }
    }
  }

}

/** Comment links on decided reviews of `subjectPath` that no workplan version has acted on. */
async function pendingCommentsOn(ctx: DraftCheckContext, subjectPath: string): Promise<string[]> {
  const reviews = await listReviews(ctx.vault, ctx.workspacePath);
  const decidedOnSubject = new Set<string>();
  for (const r of reviews) {
    if (r.note.result === null || !r.note.derived_from[0]) continue;
    const s = await ctx.vault.resolveLink(r.note.derived_from[0], r.path);
    if (s.ok && s.path === subjectPath) decidedOnSubject.add(r.path);
  }
  const refs = await listCommentRefs(ctx.vault, ctx.workspacePath);
  return refs.filter((c) => decidedOnSubject.has(c.reviewPath) && c.handledIn.length === 0).map((c) => c.link);
}
