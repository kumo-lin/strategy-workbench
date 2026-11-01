/** JSON shapes the orchestrated model steps must return (see lib/harness/prompts/research-execute.ts). */
import { z } from 'zod';
import { normalizeVerdict, VERDICTS } from '@/lib/notes/schema';

/** A list longer than allowed is cut, not refused: one extra line must not throw away a whole model answer. */
const cut = (max: number) => (v: unknown) => (Array.isArray(v) ? v.slice(0, max) : v);
const strs = (max: number) => z.preprocess(cut(max), z.array(z.string().min(1)).max(max)).default([]);

/** Extra queries are cut, not a reason to drop the sub-question (D-21: 6 kb_queries failed C2-Q4's whole query plan). */
const atMost = (n: number) => (v: unknown) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string' && x.trim()).slice(0, n) : v);

export const queryPlanSchema = z.object({
  /** Vault keyword queries: each is 1–3 short keywords; a note must contain ALL of them. */
  kb_queries: z.preprocess(atMost(5), z.array(z.string().min(1)).min(1).max(5)),
  /** Natural-language web search queries. */
  web_queries: z.preprocess(atMost(3), z.array(z.string().min(1)).min(1).max(3)),
});
export type QueryPlan = z.infer<typeof queryPlanSchema>;

export const extractionSchema = z.object({
  claims: z.preprocess(cut(10), z.array(z.object({ quote: z.string(), location: z.string().default('') })).max(10)),
});

export const stanceSchema = z.enum(['supports', 'refutes', 'irrelevant']);
export const evaluationSchema = z.object({
  items: z.array(
    z.object({
      id: z.number().int(),
      stance: stanceSchema,
      reason: z.string().default(''),
      core: z.boolean().default(false),
      partial: z.boolean().default(false),
    }),
  ),
});

/** What a challenge does to the hypothesis (D-39 用词对照表). */
export const EFFECTS = ['推翻了假设', '假设要改', '不影响判断'] as const;
/** The words an older judgment used. */
const OLD_EFFECTS: Record<string, (typeof EFFECTS)[number]> = { 推翻: '推翻了假设', 收窄: '假设要改', 推不翻: '不影响判断' };

/** The evidence keys a challenge response answers ("E4", or "E29,E30" for one row answering several). */
export const responseKeys = (c: { key: string }): string[] => c.key.match(/E\d+/g) ?? [];

/** What one plan condition comes to (D-48): only these three. */
export const CONDITION_STATUSES = ['成立', '不成立', '证据不足'] as const;
export type ConditionStatus = (typeof CONDITION_STATUSES)[number];

export const judgmentSchema = z.object({
  verdict: z.preprocess(normalizeVerdict, z.enum(VERDICTS)),
  /** Evidence ids (`E3`) of refutes the model argues are overturned. */
  rebutted: z.array(z.string()).default([]),
  /** Required when verdict = 需要修改. */
  revised_statement: z.string().nullable().default(null),
  /**
   * 需要修改 only: the revised statement split into its core assertions, each with the evidence keys it rests on.
   * Code checks each against the 成立 bar; those that fail are 待验证 (and become questions for experts).
   */
  revised_assertions: z.preprocess(
    (v) => (Array.isArray(v) ? v.slice(0, 6) : v),
    z.array(z.object({ text: z.string().min(1), keys: z.preprocess((x) => (typeof x === 'string' ? x.match(/E\d+/g) ?? [] : x), z.array(z.string())).catch([]).default([]) })),
  ).catch([]).default([]),
  /** Each line must carry [E#] references. */
  support_lines: strs(8),
  counter_lines: strs(8),
  /** Why the evidence leads to the verdict; may cite [E#]. */
  reasoning: z.string().min(1),
  /**
   * One entry per refute listed to the model (all of them; the challenges are mandatory): what it challenges,
   * the answer, and what it does to the claim. Rendered by code as the "反证和挑战（逐条回应）" table.
   */
  challenge_responses: z
    .array(
      z.object({
        /** The challenge's evidence key ("E4"); several challenges that say the same thing may share a row ("E29,E30"; D-39). */
        key: z.preprocess((v) => (Array.isArray(v) ? v.join(',') : v), z.string()),
        challenge: z.string().min(1),
        response: z.string().min(1),
        effect: z.preprocess((v) => (typeof v === 'string' ? (OLD_EFFECTS[v] ?? v) : v), z.enum(EFFECTS)).catch('不影响判断'),
      }),
    )
    .default([]), // one per refute shown, and every challenge is shown: no cap (D-21 live run: 11 responses)
  model_knowledge: strs(5),
  so_what: strs(5),
  gaps: strs(6),
  expert_questions: strs(6),
  // D-48 (报告新写法). Every field has a default: a judgment without them is judged the old way.
  /** The plan's conditions one by one; n counts from 1 in the plan's order, the skipped criterion lines included. */
  conditions: z
    .array(
      z.object({
        n: z.coerce.number().int(),
        status: z.enum(CONDITION_STATUSES),
        keys: z.preprocess((x) => (typeof x === 'string' ? x.match(/E\d+/g) ?? [] : x), z.array(z.string())).catch([]),
        note: z.string().catch(''),
      }),
    )
    .catch([]),
  /** The sub-question's answer, filling its blank (≤ 50 字); may cite [E#]. The fallback when answer_segments is empty. */
  answer: z.string().catch(''),
  /**
   * D-48 第 4 轮 S1: the answer in pieces, one per condition it rests on: `text` without any key, `cond` its label
   * ("①"), `keys` the evidence that piece stands on ("E3"). The renderer (M4) keeps only the condition's own keys,
   * says a 证据不足 piece softly, puts the footnotes after each piece and joins them with "；".
   */
  answer_segments: z
    .array(
      z.object({
        text: z.string(),
        cond: z.string().catch(''),
        keys: z.preprocess((x) => (typeof x === 'string' ? x.match(/E\d+/g) ?? [] : x), z.array(z.string())).catch([]),
        /** 第 5 轮: this piece says the other side ("但 / 不过 / 然而……") and cites a refute; the renderer (M4) allows refutes only here and in a 不成立 condition's piece. */
        contrast: z.preprocess((x) => (x === 'true' ? true : x), z.boolean()).optional().catch(undefined),
      }),
    )
    .catch([]),
  /** At most 3 reasons, one fact each (≤ 40 字), each with [E#]. */
  reasons: z.preprocess(cut(3), z.array(z.string())).catch([]),
  /** "改了什么" (≤ 40 字): 没改 / what it now says / which premise fell / 还判断不了，缺 X. */
  changed: z.string().catch(''),
  /** The hypothesis in a few words, for the Summary table (≤ 20 字). */
  short_statement: z.string().catch(''),
});
export type Judgment = z.infer<typeof judgmentSchema>;

/** One batch of responses, when the judgment is split (responsesPrompt). */
export const responsesSchema = z.object({ challenge_responses: judgmentSchema.shape.challenge_responses });

export const RECOMMENDATION_KINDS = ['自研', '合作', '收购', '其他'] as const;

/** The parts of a recommendation a follow-up decides on one by one (the alternatives also row by row). */
export const REC_FIELDS = ['decision_answer', 'directive_response', 'action', 'scale', 'metrics', 'alternatives', 'change_if'] as const;
export type RecField = (typeof REC_FIELDS)[number];
const recChange = z.object({ changed: z.boolean().catch(false), why: z.string().catch('').default('') });

const kindIn = (text: string) => (RECOMMENDATION_KINDS.find((k) => k !== '其他' && text.includes(k)) ?? '其他');

/**
 * Which dimension of the decision an alternative is, when the model did not say: "押…" (another layer) is a layer
 * choice; an option with a build / partner / buy kind is another way to get the same layer.
 */
function dimensionOf(option: string, kind: string): 'layer' | 'acquire' {
  if (/^\s*押|层/.test(option)) return 'layer';
  return kind === '其他' ? 'layer' : 'acquire';
}

/**
 * Alternatives come back in a few shapes (live run 10/25: plain strings in a repair answer; `name` / `reason`
 * instead of `option` / `why_not`). Each shape is mapped to {option, kind, why_not}; the kind is read from the
 * text when it is missing.
 */
function normalizeAlternative(v: unknown): unknown {
  if (typeof v === 'string') {
    const [option, ...rest] = v.split(/[：:]/);
    const whyNot = rest.join('：').replace(/^\s*不选[，,]?\s*/, '').trim();
    return { option: option.trim(), kind: kindIn(v), why_not: whyNot || v.trim(), dimension: dimensionOf(option, kindIn(v)) };
  }
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    const pick = (...keys: string[]) => keys.map((k) => o[k]).find((x) => typeof x === 'string' && x.trim()) as string | undefined;
    const option = pick('option', 'name', 'title', '选项', 'alternative');
    const whyNot = pick('why_not', 'whyNot', 'reason', 'why', '理由', '不选的理由');
    const kind = o.kind ?? kindIn(`${option ?? ''} ${whyNot ?? ''}`);
    return { ...o, option, why_not: whyNot, kind, dimension: o.dimension ?? dimensionOf(option ?? '', String(kind)) };
  }
  return v;
}

/** A text field that came back as an object or a list (live run 10/25: `scale` as {range, basis}): its values joined. */
const looseText = (v: unknown): unknown =>
  v && typeof v === 'object' ? (Array.isArray(v) ? v : Object.values(v)).filter((x) => typeof x === 'string' || typeof x === 'number').join('；') : v;
/** A list that came back as one string. */
const looseList = (v: unknown): unknown => (typeof v === 'string' ? v.split(/[；;\n]+/).map((x) => x.trim()).filter(Boolean) : v);

export const recommendationSchema = z.object({
  /** The one-line answer to the business decision the project supports (项目.md 支撑的决策 / D1). */
  decision_answer: z.preprocess(looseText, z.string()).catch('').default(''),
  /** 怎么回应高层指示：调查结果对起点的高层指示是支持、修正还是推翻，引用 [M#]（以及相关决定 [W#]）. */
  directive_response: z.preprocess(looseText, z.string()).catch('').default(''),
  /** 做什么：联想的一个具体业务动作，谁来做 (never a research step). */
  action: z.preprocess(looseText, z.string().min(1)),
  /** Which build / partner / buy path the action itself is. */
  action_kind: z.enum(RECOMMENDATION_KINDS).catch('其他'),
  /** 量级多大：投入、规模或时间的大概范围（区间）. */
  scale: z.preprocess(looseText, z.string().min(1)),
  /** True when no evidence backs the scale: it is an estimate (rendered "推断"). */
  scale_inferred: z.boolean().catch(true).default(true),
  /** 怎么估的 (required when scale_inferred). */
  scale_basis: z.preprocess(looseText, z.string()).catch('').default(''),
  /** 看什么指标：做对了 / 做错了会看到什么、什么时候看. */
  metrics: z.preprocess((v) => cut(6)(looseList(v)), z.array(z.preprocess(looseText, z.string().min(1))).min(1).max(6)),
  /** 其他选项和不选的理由（含自研 / 合作 / 收购这一维）; a missing why_not is flagged by the self-check, not dropped. */
  alternatives: z.preprocess(cut(8), z.array(z.preprocess(normalizeAlternative, z.object({ dimension: z.enum(['layer', 'acquire']).catch('acquire'), option: z.string().min(1), kind: z.enum(RECOMMENDATION_KINDS).catch('其他'), why_not: z.string().catch('').default(''),
    /** A follow-up's rewrite only: did THIS row change, and why (the alternatives are decided row by row). */
    changed: z.boolean().optional().catch(undefined), why_changed: z.string().optional().catch(undefined) }))).min(1).max(8)),
  /** 什么情况下要改. */
  change_if: z.preprocess((v) => cut(6)(looseList(v)), z.array(z.preprocess(looseText, z.string().min(1))).min(1).max(6)),
  /** A follow-up's rewrite only: per part, did it change and why (a part left out counts as unchanged). */
  changes: z
    .object(Object.fromEntries(REC_FIELDS.map((f) => [f, recChange.optional()])) as Record<RecField, z.ZodOptional<typeof recChange>>)
    .partial()
    .optional()
    .catch(undefined),
  /**
   * A follow-up's rewrite only: the re-judged claim's new "理由" for the Summary table, and the new 一句话答案 when
   * vN's conflicts with a judgment this version changed ('' = keep vN's).
   */
  summary_update: z.object({ reason: z.preprocess(looseText, z.string()).catch('').default(''), so_what: z.preprocess(looseText, z.string()).catch('').default('') }).optional().catch(undefined),
});
export type Recommendation = z.infer<typeof recommendationSchema>;

export const BASIS_KINDS = ['事实', '推断', '访谈支持'] as const;
export type BasisKind = (typeof BASIS_KINDS)[number];
const reasonSchema = z.object({
  title: z.preprocess(looseText, z.string().min(1)),
  basis: z.preprocess(
    (v) => (Array.isArray(v) ? v : []),
    z.array(
      z.object({
        text: z.preprocess(looseText, z.string().min(1)),
        kind: z.enum(BASIS_KINDS).catch('推断'),
        /** The source's display name: "Pew 2026", "访谈-重度用户". */
        source: z.preprocess(looseText, z.string()).catch('').default(''),
        /** Evidence keys (E3) this basis cites. */
        refs: z.preprocess(looseList, z.array(z.string())).catch([]).default([]),
      }),
    ),
  ),
});
const gapSchema = z.object({ question: z.preprocess(looseText, z.string()), missing: z.preprocess(looseText, z.string()).catch('').default(''), how: z.preprocess(looseText, z.string()).catch('').default('') });
const recommendationItemSchema = z.object({
  title: z.preprocess(looseText, z.string().min(1)),
  how: z.preprocess(looseText, z.string()).catch('').default(''),
  refs: z.preprocess(looseList, z.array(z.string())).catch([]).default([]),
});
export type ReportReason = z.infer<typeof reasonSchema>;
export type ReportGap = z.infer<typeof gapSchema>;
export type ReportRecommendation = z.infer<typeof recommendationItemSchema>;

export const summarySchema = z.object({
  /** One or two sentences: the answer to the question (a question tree's: assembled from the sub-questions' answers). May cite [E#]. */
  so_what: z.string().min(1),
  /** D-39, a question tree only: one answer per top-level sub-question (`Q2`), assembled from its hypotheses' judgments. */
  answers: z.preprocess((v) => (Array.isArray(v) ? v : []), z.array(z.object({ id: z.string(), answer: z.preprocess(looseText, z.string()).catch('') }).catch({ id: '', answer: '' }))).default([]),
  /** D-39: why these answers are enough to answer the question, and that none of them can be left out. */
  sufficiency: z.preprocess(looseText, z.string()).catch('').default(''),
  /** One line per hypothesis: `H1 → 成立（提议）…`. */
  results: z.array(z.string().min(1)).min(1),
  workplan_impact: strs(8),
  /** "AI 的推荐判断（提议，待你拍板）" — 方法库 so what 提炼 第 4 步. Rendered by code at the end of Summary. */
  recommendation: recommendationSchema.optional(),
  /** D-48: how the core question is split, one sentence (≤ 40 字), before the tree line of "问题树". Optional in the type: code-built summaries (fallbackSummary, a follow-up's) have none. */
  split_basis: z.preprocess(looseText, z.string()).catch('').optional(),
  /**
   * D-64 T23 (D63 §3.2): the report's fixed structure. A summary with `reasons` is a new report (renderReportV2); one
   * without (an older `.judgment.json`, a code-built summary) keeps the old renderer.
   */
  reasons: z.preprocess(cut(3), z.array(reasonSchema).max(3)).optional().catch(undefined),
  gaps: z.preprocess((v) => (Array.isArray(v) ? v : []), z.array(gapSchema.catch({ question: '', missing: '', how: '' }))).optional(),
  /** Replaces the single `recommendation` on the page; `refs`: the judgments (H1, K3) it stands on (T21's check). */
  recommendations: z.preprocess((v) => (Array.isArray(v) ? v : []), z.array(recommendationItemSchema)).optional().catch(undefined),
});
export type SummaryDraft = z.infer<typeof summarySchema>;
