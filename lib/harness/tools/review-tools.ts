/**
 * submit_for_review (OWNER: M1), propose_decision / propose_knowledge (OWNER: M3).
 * The AI can PREPARE a review request or a proposal; the gate itself moves
 * only on a human ApprovalEvent (../events.ts). submit_for_review prepares the
 * material and the UI shows a confirm card; the Junior's click calls
 * POST /api/workspace/review/request (dev plan 3-d).
 */
import { z } from 'zod';
import { gateSchema, type Gate } from '@/lib/notes/schema';
import { proposeDecisionParameters } from '@/lib/decisions/schema';
import { proposeDecision, type ProposeDecisionResult } from '@/lib/decisions/propose';
import { latestWorkplan, listReviews } from '@/lib/workplan/state';
import { extractWikiLinks, parseWikiLink } from '@/lib/vault';
import { hasQuestionTree, parseWorkplanTree } from '@/lib/workplan/workplan-tree';
import type { ToolSpec } from '../types';

export const submitForReviewParameters = z.object({
  gate: gateSchema,
  subject: z.string().describe('Vault path of what is being reviewed (workplan vN / report vN), e.g. "20_项目/…/workplan v1.md".'),
  summary: z.string().trim().min(1).describe('What the reviewer should look at: the question, the arguments, what was decided with the Junior.'),
  focus: z
    .array(z.string().trim().min(1))
    .min(1)
    .max(5)
    .describe('2–4 specific things the Senior should check first (where the Junior is least sure, or what the Senior asked for before).'),
});

export interface SubmitForReviewResult {
  /** Always true: this only prepares the material. Nothing has been sent. */
  prepared: true;
  gate: Gate;
  subject: string;
  version: number;
  summary: string;
  focus: string[];
  /** Hypothesis notes the submitted workplan links to. */
  hypotheses: string[];
  /** What the UI shows next to the confirm button. */
  next: string;
}

/** `workplan v1`, `workplan v1.md` or a full path → full vault path. */
function normalizeSubject(subject: string, workspacePath: string): string {
  const s = subject.trim().replace(/^\[\[|\]\]$/g, '');
  const withExt = s.endsWith('.md') ? s : `${s}.md`;
  return withExt.includes('/') ? withExt : `${workspacePath}/${withExt}`;
}

export const submitForReviewTool: ToolSpec<typeof submitForReviewParameters, SubmitForReviewResult> = {
  name: 'submit_for_review',
  description:
    'Prepare the review request for the Junior: a summary and what the Senior should look at first (发给 Senior 征求意见). This does NOT send anything: the Junior sees a confirmation card and clicks "提交给 Senior" themselves. Call it only after the workplan and its hypothesis notes are written and the Junior agrees they are ready.',
  parameters: submitForReviewParameters,
  owner: 'M1',
  implemented: true,
  async execute(args, ctx) {
    if (args.gate !== 'G1') throw new Error(`目前只能为 G1（workplan 审批）准备送审材料，不支持 ${args.gate}`);
    if ((await listReviews(ctx.vault, ctx.workspacePath)).some((r) => r.note.gate === 'G1' && r.note.result === null)) {
      throw new Error('上一份征求意见还在等 Senior 回复，回复之后才能再发。');
    }
    const subject = normalizeSubject(args.subject, ctx.workspacePath);
    const latest = await latestWorkplan(ctx.vault, ctx.workspacePath);
    if (!latest) throw new Error('还没有 workplan：先用 write_draft 写出 workplan v1');
    if (latest.path !== subject) throw new Error(`送审的必须是最新版本 ${latest.path}，收到 ${subject}`);

    const hypotheses: string[] = [];
    for (const link of extractWikiLinks(latest.body)) {
      const r = await ctx.vault.resolveLink(link, latest.path);
      if (!r.ok || hypotheses.includes(r.path)) continue;
      if ((await ctx.vault.read(r.path)).note?.type === 'hypothesis') hypotheses.push(r.path);
    }
    // D-39: in a question-tree workplan every lowest-level sub-question's hypothesis is a note that exists.
    if (hasQuestionTree(latest.body)) {
      const missing: string[] = [];
      for (const leaf of parseWorkplanTree(latest.body).leaves) {
        const link = leaf.hypothesis ? parseWikiLink(leaf.hypothesis) : null;
        const r = link ? await ctx.vault.resolveLink(link, latest.path) : null;
        if (!r?.ok || (await ctx.vault.read(r.path)).note?.type !== 'hypothesis') missing.push(`${leaf.label}（${leaf.qid}）${leaf.hypothesis ?? '没有链接'}`);
      }
      if (missing.length) {
        throw new Error(`这些假设还没有写成假设笔记，或者 workplan 里的链接对不上：${missing.join('、')}。每个最底层子问题的假设都要用 write_draft（note_type = hypothesis）单独写一条，名字和 workplan 里的链接一致。`);
      }
    }
    if (hypotheses.length === 0) {
      throw new Error('workplan 里还没有链接到任何假设笔记：每个假设要用 write_draft 单独写成 hypothesis，并在 workplan 里用 [[…]] 链接');
    }
    return {
      prepared: true,
      gate: args.gate,
      subject,
      version: latest.version,
      summary: args.summary,
      focus: args.focus,
      hypotheses,
      next: `等 ${ctx.workspace.owner} 确认后点"提交给 ${ctx.workspace.reviewer}"，才会真正发给 Senior 征求意见。`,
    };
  },
  summarize: (a, r) => `准备 ${a.gate} 送审材料：${r ? `workplan v${r.version}，${r.hypotheses.length} 个假设` : a.subject}（未发送，等 Junior 确认）`,
};

export { proposeDecisionParameters };

export const proposeDecisionTool: ToolSpec<typeof proposeDecisionParameters, ProposeDecisionResult> = {
  name: 'propose_decision',
  description:
    'Draft a "决定 + 理由" from a delivered report for the Senior to confirm. Only a Senior can request it. The note is always saved as 推断 with decided_by empty; every reason must cite blocks that the report itself cites. You propose, the Senior decides.',
  parameters: proposeDecisionParameters,
  owner: 'M3',
  implemented: true,
  execute: proposeDecision,
  summarize: (a, r) => `起草决定「${a.name}」（推断，${a.reasons.length} 条理由，等 Senior 确认）${r?.replaced ? '，替换了之前的草稿' : ''}${r?.model ? ` · 模型：${r.model}` : ''}`,
};

export const proposeKnowledgeParameters = z.object({
  kind: z.enum(['method', 'best-practice', 'exec-logic', 'expert-input']),
  name: z.string(),
  body: z.string(),
  derived_from: z.array(z.string()).min(1),
  relates_to: z.array(z.string()).min(1),
});

export const proposeKnowledgeTool: ToolSpec<typeof proposeKnowledgeParameters> = {
  name: 'propose_knowledge',
  description: 'Propose a reusable method / best practice for the Senior to approve into team knowledge.',
  parameters: proposeKnowledgeParameters,
  owner: 'M3',
  implemented: false,
};
