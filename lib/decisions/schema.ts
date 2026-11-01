/** What the AI hands to `propose_decision`. The note's text, quotes and links are assembled from this by code (./propose.ts). */
import { z } from 'zod';

const list = (describe: string) => z.array(z.string().trim().min(1)).describe(describe);

export const decisionReasonSchema = z.object({
  kind: z.enum(['事实', '推断']).describe('事实 = the report states it with a citation; 推断 = your reading of those facts.'),
  text: z.string().trim().min(1).describe('One argument, in your words. No numbers or claims the report does not make.'),
  cites: z
    .array(z.string().trim().min(1))
    .min(1)
    .describe('Block links "[[资料名#^c1]]" copied from the report. Each must be a block the report itself cites; the system writes the quote.'),
});

export const proposeDecisionParameters = z.object({
  report: z.string().trim().min(1).describe('Vault path of the delivered report this decision is drafted from, e.g. "20_项目/…/调查/…/报告 v1.md".'),
  name: z.string().trim().min(1).max(60).describe('Note name without .md, e.g. "W1决定-AI PC渗透不作为付费意愿证据".'),
  decision: z.string().trim().min(1).describe('The decision itself: what we do or no longer do, and what it answers in the project question.'),
  reason: z.string().trim().min(1).describe('The reasoning in one sentence (frontmatter).'),
  scope: z.string().trim().min(1).describe('适用边界: where this decision holds and where it does not (market, user group, time). Required.'),
  reasons: z.array(decisionReasonSchema).min(1).describe('Every reason, each with block citations.'),
  counter: list('Counter-evidence and what weakens the decision. Say "报告没有找到反证" if none.'),
  gaps: list('What is still missing (evidence not found, questions for experts).'),
  reconsider: list('What would make us reconsider this decision.').min(1),
  affects: list('Links "[[…]]" to the Workspaces / hypotheses / project this decision constrains.'),
});

export type ProposeDecisionArgs = z.infer<typeof proposeDecisionParameters>;
