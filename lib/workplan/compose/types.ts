/**
 * The data of the workplan decomposition pipeline (D-61): what is asked first (the decision contract), what the code
 * finds first (the pack), the free-form holistic judgment and its strategic evaluation, and the tree as JSON. Every shape the model fills is a zod schema here, so the code, not the prompt, decides what
 * is valid. Pure; no I/O.
 */
import { z } from 'zod';

// ── ② the decision contract: six slots, empty string = not filled yet ───────────────────────────────

export const SLOT_KEYS = ['question', 'decision', 'scope', 'success', 'known', 'bar'] as const;
export type SlotKey = (typeof SLOT_KEYS)[number];

export const SLOT_LABELS: Record<SlotKey, string> = {
  question: '要回答的问题',
  decision: '要支撑的决策',
  scope: '范围和时间',
  success: '成功的样子',
  known: '已知的事实和判断',
  bar: '证据要多强才能拍板',
};

export const frameSchema = z.object({
  question: z.string().trim().default(''),
  decision: z.string().trim().default(''),
  scope: z.string().trim().default(''),
  success: z.string().trim().default(''),
  known: z.string().trim().default(''),
  bar: z.string().trim().default(''),
});
export type Frame = z.infer<typeof frameSchema>;

export const emptyFrame = (): Frame => ({ question: '', decision: '', scope: '', success: '', known: '', bar: '' });

/** The slots that are still empty, in the order they are asked. */
export const emptySlots = (f: Frame): SlotKey[] => SLOT_KEYS.filter((k) => f[k].trim() === '');

// ── ① the pack: what the code found, with stable ids ────────────────────────────────────────────────

/** `directive` = a leadership meeting, `decision` = a confirmed decision, `policy` = a company policy line; the rest are not marked against the user's direction. */
export const PACK_KINDS = ['directive', 'decision', 'policy', 'method', 'reference'] as const;
export type PackKind = (typeof PACK_KINDS)[number];

export const packItemSchema = z.object({
  /** `K1`, `K2`, ... stable inside one Workspace's pack. The model cites these, never paths. */
  id: z.string().regex(/^K\d+$/),
  kind: z.enum(PACK_KINDS),
  /** What the user sees: the note's title. */
  title: z.string().min(1),
  /** Vault path of the note (for the code; never shown in chat). */
  path: z.string().min(1),
  /** A block anchor such as `^m1` when the item is one block of a note. */
  block: z.string().regex(/^\^[A-Za-z0-9-]+$/).optional(),
  /** One sentence: what this item says. */
  gist: z.string().default(''),
  /** `已确认` / `推断` ... for decisions. */
  status: z.string().optional(),
});
export type PackItem = z.infer<typeof packItemSchema>;

/** The kinds the user's direction is checked against. */
export const MARKED_KINDS: readonly PackKind[] = ['directive', 'decision', 'policy'];
export const isMarkable = (i: PackItem): boolean => MARKED_KINDS.includes(i.kind);

// ── ② marks: for every directive / decision / policy item, does the user's direction agree? ────────

export const VERDICTS = ['一致', '冲突', '无关'] as const;
export type Verdict = (typeof VERDICTS)[number];

export const directiveMarkSchema = z.object({
  /** A pack item id. */
  ref: z.string().regex(/^K\d+$/),
  verdict: z.enum(VERDICTS),
  /** One sentence: why. */
  note: z.string().trim().min(1),
  /** Only for a conflict: what the user chose after being told. */
  resolution: z.enum(['按指示', '按用户的想法']).optional(),
});
export type DirectiveMark = z.infer<typeof directiveMarkSchema>;

// ── ⑥ the tree as JSON ──────────────────────────────────────────────────────────────────────────────

export const toVerifySchema = z.object({
  /** What has to be found out. */
  what: z.string().trim().min(1),
  /** A pack item id (a reference note to read), or the literal `上网`. */
  where: z.string().regex(/^(K\d+|上网)$/),
  /** What would count as support. */
  support: z.string().trim().min(1),
  /** Where to look for evidence against. */
  counter: z.string().trim().min(1),
});
export type ToVerify = z.infer<typeof toVerifySchema>;

export const hypothesisSchema = z.object({
  /** A falsifiable sentence: direction, condition, threshold. */
  statement: z.string().trim().min(1),
  /** The evidence that would make it wrong (not "if the data does not support it"). */
  falsifier: z.string().trim().min(1),
  /** The 2–3 conditions that must hold. */
  conditions: z.array(z.string().trim().min(1)).min(1).max(3),
  /** Pack ids of the notes that already support part of it (the code checks they exist). */
  known_by: z.array(z.string().regex(/^K\d+$/)).default([]),
  to_verify: z.array(toVerifySchema).default([]),
  /** A short name for the hypothesis note. */
  short: z.string().trim().min(1).max(30),
});
export type Hypothesis = z.infer<typeof hypothesisSchema>;

export const leafSchema = z.object({
  question: z.string().trim().min(1),
  hypothesis: hypothesisSchema,
  /** D-64 T21 (step 3 排优先级): a key question (K1–K4) — a bad answer changes the decision. */
  knockout: z.boolean().optional(),
  /** What a bad answer changes (required on a key question). */
  ifBad: z.string().trim().optional(),
});
export type Leaf = z.infer<typeof leafSchema>;

export const branchSchema = z.object({
  question: z.string().trim().min(1),
  children: z.array(leafSchema).min(2),
});
export type Branch = z.infer<typeof branchSchema>;

export const nodeSchema = z.union([branchSchema, leafSchema]);
export type TreeNode = Branch | Leaf;
export const isBranch = (n: TreeNode): n is Branch => 'children' in n;

export const treeSchema = z.object({
  core_question: z.string().trim().min(1),
  /** All options of the decision (e.g. which layer to bet on, how to get it). */
  decision_options: z.string().trim().min(1),
  /** One sentence with a judgement, marked as a hypothesis. */
  day1_answer: z.string().trim().min(1),
  /** Why these parts are enough and do not overlap. */
  split_basis: z.string().trim().min(1),
  subquestions: z.array(nodeSchema).min(2).max(6),
  /** One sentence: the key message the answers add up to. */
  key_message: z.string().trim().min(1),
  /** What is most likely to overturn it, and what the Senior should judge. */
  risks: z.array(z.string().trim().min(1)).min(1),
  /** Who does what next. */
  next_actions: z.array(z.string().trim().min(1)).min(1),
});
export type Tree = z.infer<typeof treeSchema>;

// ── ② the strategic evaluator: six questions, each answered against a concrete item of the draft ────

export const EVAL_QUESTIONS = [
  '有没有漏掉重要的竞争解释',
  '有没有把低价值的问题当成核心',
  '有没有表面 MECE、实际重叠',
  '关键假设有没有区分度：什么证据能推翻它',
  '有没有"验证成功了也不改变决策"的研究',
  '有没有成本更低、信息价值更高的证伪办法',
] as const;

export const evalAnswerSchema = z.object({
  /** 1..6: which of EVAL_QUESTIONS. */
  q: z.number().int().min(1).max(EVAL_QUESTIONS.length),
  verdict: z.enum(['有问题', '没问题']),
  /** A phrase copied word for word from the draft: the item this answer is about (code checks it is there). */
  target: z.string().trim().default(''),
  /** A concrete case where the item fails. For 没问题: why the draft is safe on this question. */
  counterexample: z.string().trim().default(''),
  /** What to change in the draft. */
  fix: z.string().trim().default(''),
});
export type EvalAnswer = z.infer<typeof evalAnswerSchema>;

export const evaluationSchema = z.object({ answers: z.array(evalAnswerSchema).min(1).max(18) });

// ── the state file of one Workspace ─────────────────────────────────────────────────────────────────

/** How big the question is: a small one (a concrete thing to find out) gets a small tree, a bet gets a big one. The model says it, the code holds the tree to it. */
export const SIZES = ['小题', '大题'] as const;

/** What the team can actually do to verify (D-61): the default unless the user changed it on the confirm card. Methods outside it are refused by code (tree.ts). */
export const DEFAULT_RESOURCES = '内部资料、参考库和上网检索；访谈只作为建议列出，不在这一版里做；不做实验、试点或问卷';
export type Size = (typeof SIZES)[number];

export const composeStateSchema = z.object({
  version: z.literal(1),
  /** The user's first message about the topic (for the record and the keyword search). */
  topic: z.string().default(''),
  frame: frameSchema,
  /** The user said "split it like this" on the confirm card. */
  confirmed: z.boolean().default(false),
  size: z.enum(SIZES).default('大题'),
  resources: z.string().trim().min(1).default(DEFAULT_RESOURCES),
  pack: z.array(packItemSchema).default([]),
  /** The pack is final (taken when composing starts); before that it may grow. */
  pack_frozen: z.boolean().default(false),
  marks: z.array(directiveMarkSchema).default([]),
  tree: treeSchema.optional(),
  /** The holistic judgment (D-61): the first draft, what the evaluator found, the revision and what the revision could not fix. */
  judgment: z
    .object({
      draft: z.string(),
      evaluation: z.array(evalAnswerSchema).default([]),
      revised: z.string(),
      /** Evaluator findings the revision did not (or could not) take in; they go into 风险和待确认. */
      open: z.array(z.string()).default([]),
      /** Model tokens spent on the whole workplan segment of this run. */
      tokens: z.number().int().default(0),
    })
    .optional(),
  updated: z.string().default(''),
});
export type ComposeState = z.infer<typeof composeStateSchema>;

export const newState = (): ComposeState => composeStateSchema.parse({ version: 1, frame: emptyFrame() });

// ── small pure helpers shared by the steps ──────────────────────────────────────────────────────────

/** The display labels of a tree in reading order: top-level `Q1`, `Q2`, children `Q2-1`, `Q2-2`. */
export function labelsOf(tree: Pick<Tree, 'subquestions'>): { label: string; node: TreeNode; parent: string | null }[] {
  const out: { label: string; node: TreeNode; parent: string | null }[] = [];
  tree.subquestions.forEach((n, i) => {
    const label = `Q${i + 1}`;
    out.push({ label, node: n, parent: null });
    if (isBranch(n)) n.children.forEach((c, j) => out.push({ label: `${label}-${j + 1}`, node: c, parent: label }));
  });
  return out;
}

/** The lowest-level questions (leaves), in reading order. */
export const leavesOf = (tree: Pick<Tree, 'subquestions'>) => labelsOf(tree).filter((x) => !isBranch(x.node)) as { label: string; node: Leaf; parent: string | null }[];
