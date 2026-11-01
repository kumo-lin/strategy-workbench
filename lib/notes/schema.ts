/**
 * Note frontmatter schemas — PRD §9.2 (fields), §9.3 (links), §9.4 (status values).
 *
 * Every note in the vault is markdown + YAML frontmatter. The frontmatter is
 * validated by `noteSchema` (a discriminated union on `type`). Extra keys are
 * allowed (Obsidian adds `tags`, `aliases`, …) but every key listed here is
 * typed.
 *
 * CONTRACT (frozen after M0): change only via docs/CONTRACTS.md change request.
 */
import { z } from 'zod';
import { parseWikiLink } from '@/lib/vault/links';

// ── Primitives ───────────────────────────────────────────────────────────────

/** A single `[[wikilink]]` string, as stored in YAML (quoted). */
export const wikiLinkSchema = z
  .string()
  .refine((v) => parseWikiLink(v) !== null, { message: 'must be a single [[wikilink]]' });

/** `YYYY-MM-DD` or a full ISO-8601 datetime. Stored as string (YAML timestamps are not parsed). */
export const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/, 'must be YYYY-MM-DD or ISO datetime');

/** Stable machine id: lowercase ascii slug. */
export const noteIdSchema = z.string().regex(/^[a-z0-9][a-z0-9._-]*$/, 'id must be a lowercase ascii slug');

/** Role display name from 90_配置/角色.md (e.g. `Senior`, `Junior A`), or `AI`. */
export const authorSchema = z.string().min(1);
export const AI_AUTHOR = 'AI' as const;

// ── Enumerations (PRD §9.4, §6.6) ────────────────────────────────────────────

export const NOTE_TYPES = [
  'source',
  'project',
  'workspace',
  'hypothesis',
  'workplan',
  'research_plan',
  'report',
  'decision',
  'meeting',
  'review',
  'log',
  'knowledge',
  'config',
  'contract',
] as const;
export type NoteType = (typeof NOTE_TYPES)[number];

/** Content status (§9.4). `已确认` / `已否决` are human-only (§7 rule 11). */
export const NOTE_STATUSES = ['进行中', '推断', '已确认', '已否决', '探索性'] as const;
export const noteStatusSchema = z.enum(NOTE_STATUSES);
export type NoteStatus = z.infer<typeof noteStatusSchema>;
/** Statuses an AI-authored write may carry. */
export const AI_WRITABLE_STATUSES: readonly NoteStatus[] = ['进行中', '推断', '探索性'];

/** `访谈支持` (D63 §3): public sources fall short of 成立, but at least one interview supports it and nothing refutes it. */
export const VERDICTS = ['成立', '不成立', '需要修改', '访谈支持', '证据不足'] as const;
/** The verdict an older note may still carry, read as today's word (CONTRACT-CHANGE-M3-1 B: 需要修正 → 需要修改). */
export function normalizeVerdict(v: unknown): unknown {
  return v === '需要修正' ? '需要修改' : v;
}
export const verdictSchema = z.preprocess(normalizeVerdict, z.enum(VERDICTS));
export type Verdict = z.infer<typeof verdictSchema>;

export const SOURCE_GRADES = ['A', 'B', 'C'] as const;
export const sourceGradeSchema = z.enum(SOURCE_GRADES);

/** Workspace stages (§6.6). */
export const WORKSPACE_STAGES = [
  '拆题中',
  'workplan待审',
  '执行中',
  '结论待审',
  '骨架待审',
  '撰写中',
  '终稿待审',
  '完成',
] as const;
export const workspaceStageSchema = z.enum(WORKSPACE_STAGES);
export type WorkspaceStage = z.infer<typeof workspaceStageSchema>;

export const WORKSPACE_FLAGS = ['返工中', '延迟', '重大问题'] as const;

/** Review gates (§6.4). `结论` = conclusion review (not in §9.2's list; see CONTRACTS deviations). */
export const GATES = ['G1', '结论', 'G2', 'G3'] as const;
export const gateSchema = z.enum(GATES);
export type Gate = z.infer<typeof gateSchema>;

export const KNOWLEDGE_KINDS = ['method', 'best-practice', 'exec-logic', 'expert-input'] as const;

export const RESEARCH_METHODS = ['知识库', '网络', '专家访谈'] as const;

/** Week label on the roadmap: `W2`, or a range `W6-W7`. */
const weekSchema = z.string().regex(/^W\d+(-W\d+)?$/);

// ── Common fields (§9.2: all notes) ──────────────────────────────────────────

export const commonFields = {
  id: noteIdSchema,
  status: noteStatusSchema,
  created: dateSchema,
  updated: dateSchema,
  author: authorSchema,
  /** What this note was produced from (§9.3). Write requires ≥1. */
  derived_from: z.array(wikiLinkSchema),
  /** Which work / judgement / document this note concerns (§9.3). Write requires ≥1. */
  relates_to: z.array(wikiLinkSchema),
};

const nullableLink = wikiLinkSchema.nullable();

// ── Per-type schemas ─────────────────────────────────────────────────────────

export const sourceSchema = z.looseObject({
  ...commonFields,
  type: z.literal('source'),
  /** null for offline material with no URL. */
  url: z.url().nullable(),
  publisher: z.string().min(1),
  published: dateSchema.nullable(),
  retrieved: dateSchema,
  origin: z.enum(['预置', '网络']),
  grade: sourceGradeSchema,
  graded_by: z.enum(['AI', '人']),
  /** DeepSeek Search `authority` (integer) when origin = 网络; null otherwise. */
  authority: z.number().nullable(),
  link_checked: z.boolean(),
  /**
   * Whether the source itself holds up (set by a person who checked it): `disproven` = it is not what it claims
   * (e.g. a "regulator guideline" that does not exist) and is never offered as evidence again; `unverified` = still
   * usable, marked in reports. Absent = not looked at (treated as ok).
   */
  reliability: z.enum(['ok', 'unverified', 'disproven']).optional(),
  reliability_note: z.string().optional(),
  /** D63: the investigation folder whose web search fetched this source (`20_项目/<项目>/<WS>/调查/<名字>`). */
  fetched_in: z.string().min(1).optional(),
});

/** D63 §1.2: the project's issue tree. Item status is derived from the workspace stage and `waits_for`, never stored. */
export const issueTreeSchema = z.object({
  question: z.string().min(1),
  lines: z.array(
    z.object({
      id: z.string().min(1),
      title: z.string().min(1),
      question: z.string().min(1),
      /** Role id (`junior-a`). */
      owner: z.string().min(1).nullable(),
      items: z.array(
        z.object({
          id: z.string().min(1),
          title: z.string().min(1),
          /** Workspace folder name; null = not started. */
          workspace: z.string().min(1).nullable(),
          waits_for: z.array(z.string().min(1)).default([]),
        }),
      ),
    }),
  ),
});
export type IssueTree = z.infer<typeof issueTreeSchema>;

export const projectSchema = z.looseObject({
  ...commonFields,
  type: z.literal('project'),
  owner: authorSchema,
  sponsor: z.string().min(1),
  core_question: z.string().min(1),
  /** D63: optional (projects with an issue_tree have none). */
  roadmap: z
    .array(
      z.object({
        week: weekSchema,
        topic: z.string().min(1),
        workspaces: z.array(wikiLinkSchema).default([]),
      }),
    )
    .optional(),
  dependencies: z.array(z.object({ from: wikiLinkSchema, to: wikiLinkSchema, reason: z.string().optional() })).optional(),
  issue_tree: issueTreeSchema.optional(),
});

export const workspaceSchema = z.looseObject({
  ...commonFields,
  type: z.literal('workspace'),
  /** D63: optional; the issue tree replaced the weekly roadmap. */
  week: weekSchema.optional(),
  /** D63: the issue-tree item this workspace works on (`M1`). */
  item: z.string().min(1).optional(),
  owner: authorSchema,
  reviewer: authorSchema,
  stage: workspaceStageSchema,
  flags: z.array(z.enum(WORKSPACE_FLAGS)),
  depends_on: z.array(wikiLinkSchema),
});

export const hypothesisSchema = z.looseObject({
  ...commonFields,
  type: z.literal('hypothesis'),
  workspace: wikiLinkSchema,
  statement: z.string().min(1),
  /** AI's proposal (§6.3.1 step 8). */
  verdict_proposed: verdictSchema.nullable(),
  /** Human decision. AI must never set this. */
  verdict: verdictSchema.nullable(),
  /** Block refs `[[资料#^cN]]`. */
  evidence: z.array(wikiLinkSchema),
  counter_evidence: z.array(wikiLinkSchema),
});

export const workplanChangeSchema = z.object({
  /** Link to the comment block, e.g. `[[…/review/G1 2026-10-24#^m1]]`. */
  comment: wikiLinkSchema,
  /** The intent we understood behind the comment. */
  intent: z.string().min(1),
  /** What changed, in one line. */
  change: z.string().min(1),
});

export const workplanSchema = z.looseObject({
  ...commonFields,
  type: z.literal('workplan'),
  version: z.number().int().positive(),
  approved_by: authorSchema.nullable(),
  approved_at: dateSchema.nullable(),
  changes: z.array(workplanChangeSchema),
});

/** One or more of the team's perspectives; a single name written as a string is read as a list of one. */
const perspectiveListSchema = z.preprocess((v) => (typeof v === 'string' ? [v] : v), z.array(z.string().min(1))).optional();

export const researchSubQuestionSchema = z.object({
  /** Unique within the plan, e.g. `C1-Q2`. web_search must cite one of these. */
  id: z.string().regex(/^C\d+-Q\d+$/),
  question: z.string().min(1),
  methods: z.array(z.enum(RESEARCH_METHODS)).min(1),
  /** Which of the team's perspectives (90_配置/团队.md) this sub-question looks from. Optional: older plans have none. */
  perspective: perspectiveListSchema,
});

/**
 * One thing that must be true for the claim to hold (D-39): a sentence, or the sentence with the evidence it needs and
 * where to look (the plan's three-column table). Read its words with conditionText (lib/research/question-tree.ts).
 */
export const researchConditionSchema = z.union([
  z.string().min(1),
  z.object({ text: z.string().min(1), evidence_needed: z.string().optional(), where: z.string().optional() }),
]);

export const researchClaimSchema = z.object({
  /** `C1`, `C2`, … (stored id; pages show the question-tree label H1 / H2-1, D-39) */
  id: z.string().regex(/^C\d+$/),
  /** The hypothesis: the claim to test. */
  statement: z.string().min(1),
  /** The hypothesis note this claim tests, if any. */
  hypothesis: nullableLink.default(null),
  /** D-39: the lowest-level sub-question (a question) this hypothesis answers. Optional: older plans have none. */
  question: z.string().min(1).optional(),
  /** D-39: the top-level sub-question (`question_tree` id, `Q2`) this one was split from; null / absent = top level. */
  parent: z.string().regex(/^Q\d+$/).nullable().optional(),
  /** What must be true for the claim to hold. */
  conditions: z.array(researchConditionSchema),
  sub_questions: z.array(researchSubQuestionSchema).min(1),
  /** How we will look for counter-evidence (mandatory, §6.3.1 step 6). */
  counter_search: z.string().min(1),
  /** Which of the team's perspectives (90_配置/团队.md) this claim looks from. Optional: older plans have none. */
  perspective: perspectiveListSchema,
  /** D63: the key question (K1–K4 of the workplan) this hypothesis belongs to. */
  key: z.enum(['K1', 'K2', 'K3', 'K4']).optional(),
  /** D63: which decision changes if the result is bad. */
  if_bad: z.string().min(1).optional(),
});

export const researchPlanSchema = z.looseObject({
  ...commonFields,
  type: z.literal('research_plan'),
  version: z.number().int().positive(),
  question: z.string().min(1),
  purpose: z.string().min(1),
  claims: z.array(researchClaimSchema).min(1),
  /** Workspace owner who approved. Set only by the approval event. */
  approved_by_owner: authorSchema.nullable(),
  approved_at: dateSchema.nullable(),
  /** True when run before G1 (§6.2 step 1, D-8). */
  exploratory: z.boolean(),
  /** Perspectives of the team list this plan deliberately does not look at, each with why (D-32). */
  perspectives_skipped: z.array(z.object({ perspective: z.string().min(1), reason: z.string() })).optional(),
  /** D-39: the top-level sub-questions that are split one level further (`Q2`, its question); the leaves are the claims. */
  question_tree: z.array(z.object({ id: z.string().regex(/^Q\d+$/), question: z.string().min(1) })).optional(),
  /** D-39: the AI's own check that the sub-questions are MECE and together sufficient and each necessary, with why. */
  mece_check: z.string().optional(),
});

/** A cited source found to be wrong after the report was written; pages flag its footnotes, the report text stays as written. */
export const sourceWarningSchema = z.object({
  /** Footnote ids in the report (`[^36]` → "36"). */
  footnotes: z.array(z.string().min(1)).min(1),
  /** The source note's [[wikilink]] or URL. */
  source: z.string().min(1),
  problem: z.string().min(1),
  action: z.string().min(1),
  found_by: z.string().min(1),
  found_on: dateSchema,
});

/**
 * A note a person added after checking the report by hand (`review_notes`): a footnote that cites the wrong document,
 * two places that say different things — not a problem with the source (that is source_warnings). Display only.
 */
export const reportReviewNoteSchema = z.object({
  /** Footnote ids (`[^30]` → "30", plain mode `[3]` → "3"); none or empty: the note is about a passage (`where`). */
  footnotes: z.array(z.string().min(1)).optional(),
  /** The passage it is about, by its heading: "Q3 的回答", "推荐判断 · 量级" (most specific last). */
  where: z.string().min(1).optional(),
  note: z.string().min(1),
  found_by: z.string().min(1),
  found_on: dateSchema,
});

export const reportSchema = z.looseObject({
  ...commonFields,
  type: z.literal('report'),
  version: z.number().int().positive(),
  /** The plan version this report executed. null for baseline mode (no plan). */
  research_plan: nullableLink,
  /** team = our workflow; baseline = plain mode via API; web_baseline = a consumer chat app's answer saved by hand (D-22). */
  mode: z.enum(['team', 'baseline', 'web_baseline']),
  exploratory: z.boolean(),
  source_warnings: z.array(sourceWarningSchema).optional(),
  review_notes: z.array(reportReviewNoteSchema).optional(),
  /** D63: published as a company asset. Set only by a person's publish event. */
  published_by: authorSchema.nullable().optional(),
  published_at: dateSchema.nullable().optional(),
});

export const decisionSchema = z.looseObject({
  ...commonFields,
  type: z.literal('decision'),
  /** null while status = 推断 (AI draft); set by the confirm event. */
  decided_by: authorSchema.nullable(),
  /** Gate review or meeting that triggered this decision. */
  trigger: wikiLinkSchema,
  reason: z.string().min(1),
  affects: z.array(wikiLinkSchema),
  /** D63: 适用边界. Optional here so older decisions read; proposeDecision requires it. */
  scope: z.string().min(1).optional(),
  published_by: authorSchema.nullable().optional(),
  published_at: dateSchema.nullable().optional(),
});

export const meetingSchema = z.looseObject({
  ...commonFields,
  type: z.literal('meeting'),
  date: dateSchema,
  attendees: z.array(z.string().min(1)),
  simulated: z.boolean(),
  decisions: z.array(wikiLinkSchema),
  /** D63: an interview record is a meeting of kind 访谈 (`20_项目/<项目>/访谈/<名字>.md`); absent = 会议. */
  kind: z.enum(['会议', '访谈']).default('会议'),
});

export const reviewSchema = z.looseObject({
  ...commonFields,
  type: z.literal('review'),
  requester: authorSchema,
  reviewer: authorSchema,
  /** null while the review is pending. */
  result: z.enum(['通过', '打回']).nullable(),
  gate: gateSchema,
});

export const logSchema = z.looseObject({
  ...commonFields,
  type: z.literal('log'),
});

export const knowledgeSchema = z.looseObject({
  ...commonFields,
  type: z.literal('knowledge'),
  kind: z.enum(KNOWLEDGE_KINDS),
  approved_by: authorSchema.nullable(),
  origin_project: nullableLink,
});

/** D63 §1.1: the decision contract (`20_项目/<项目>/决策契约.md`), drafted from the six frame slots. */
export const contractSchema = z.looseObject({
  ...commonFields,
  type: z.literal('contract'),
  question: z.string().min(1),
  original_question: z.string().nullable().optional(),
  decision: z.string().min(1),
  decision_owner: z.string().min(1),
  horizon: z.string().min(1),
  geography: z.string().min(1),
  product_scope: z.string().min(1),
  out_of_scope: z.array(z.string().min(1)),
  success: z.string().min(1),
  known: z.array(z.string().min(1)),
  bar: z.string().min(1),
  /** Set only by the Senior's confirm event. */
  approved_by: authorSchema.nullable().default(null),
  approved_at: dateSchema.nullable().default(null),
});

/** Config notes define their own extra fields (§9.2); see lib/config/*. */
export const configSchema = z.looseObject({
  ...commonFields,
  type: z.literal('config'),
});

export const noteSchema = z.discriminatedUnion('type', [
  sourceSchema,
  projectSchema,
  workspaceSchema,
  hypothesisSchema,
  workplanSchema,
  researchPlanSchema,
  reportSchema,
  decisionSchema,
  meetingSchema,
  reviewSchema,
  logSchema,
  knowledgeSchema,
  configSchema,
  contractSchema,
]);

export type NoteFrontmatter = z.infer<typeof noteSchema>;
export type SourceNote = z.infer<typeof sourceSchema>;
export type ProjectNote = z.infer<typeof projectSchema>;
export type WorkspaceNote = z.infer<typeof workspaceSchema>;
export type HypothesisNote = z.infer<typeof hypothesisSchema>;
export type WorkplanNote = z.infer<typeof workplanSchema>;
export type ResearchPlanNote = z.infer<typeof researchPlanSchema>;
export type ReportNote = z.infer<typeof reportSchema>;
export type SourceWarning = z.infer<typeof sourceWarningSchema>;
export type ReportReviewNote = z.infer<typeof reportReviewNoteSchema>;
export type DecisionNote = z.infer<typeof decisionSchema>;
export type MeetingNote = z.infer<typeof meetingSchema>;
export type ReviewNote = z.infer<typeof reviewSchema>;
export type LogNote = z.infer<typeof logSchema>;
export type KnowledgeNote = z.infer<typeof knowledgeSchema>;
export type ConfigNote = z.infer<typeof configSchema>;
export type ContractNote = z.infer<typeof contractSchema>;

export type NoteOfType<T extends NoteType> = Extract<NoteFrontmatter, { type: T }>;

export const schemaByType: { [T in NoteType]: z.ZodType<NoteOfType<T>> } = {
  source: sourceSchema,
  project: projectSchema,
  workspace: workspaceSchema,
  hypothesis: hypothesisSchema,
  workplan: workplanSchema,
  research_plan: researchPlanSchema,
  report: reportSchema,
  decision: decisionSchema,
  meeting: meetingSchema,
  review: reviewSchema,
  log: logSchema,
  knowledge: knowledgeSchema,
  config: configSchema,
  contract: contractSchema,
} as never;
