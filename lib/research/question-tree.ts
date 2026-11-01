/**
 * The question tree of a research plan (D-39): core question → sub-questions (questions, MECE, split at most one level
 * further) → one hypothesis per lowest-level sub-question → its verification plan (conditions, where to look, how to
 * find counter-evidence).
 *
 * Stored as the plan already was, plus a few fields (CONTRACT-CHANGE-M3-1): a claim is a lowest-level sub-question and
 * its hypothesis (`question` = the sub-question, `statement` = the hypothesis); a claim split from a top-level
 * sub-question names it in `parent`; `question_tree` holds the top-level sub-questions that are split (their question
 * text). The labels readers see (Q2-1, H2-1, 要查的问题 Q2-1.1) come from the order of the claims; the stored ids (C2,
 * C2-Q1) do not change.
 *
 * A plan without any `question` on its claims is the older format (论点 → 子问题): it keeps its H1, H2… labels.
 * Pure — safe to import from client components.
 */
import type { z } from 'zod';
import type { researchConditionSchema } from '@/lib/notes/schema';

export type PlanCondition = z.infer<typeof researchConditionSchema>;

/** The words of a condition, whichever way it was written. */
export function conditionText(c: PlanCondition): string {
  return typeof c === 'string' ? c : c.text;
}

/** The condition with new words, its evidence / where kept. */
export function withConditionText(c: PlanCondition, text: string): PlanCondition {
  return typeof c === 'string' ? text : { ...c, text };
}

/** Trimmed, empty ones dropped (what a saved plan keeps). */
export function cleanConditions(cs: PlanCondition[]): PlanCondition[] {
  return cs.map((c) => withConditionText(c, conditionText(c).trim())).filter((c) => conditionText(c));
}

/** The fields of a plan the tree is read from (a ResearchPlanNote, an EditablePlan). */
export interface TreePlan {
  claims: {
    id: string;
    statement: string;
    question?: string;
    parent?: string | null;
    conditions: PlanCondition[];
    sub_questions: { id: string }[];
    counter_search: string;
  }[];
  question_tree?: { id: string; question: string }[];
  mece_check?: string;
}

/** A lowest-level sub-question and its hypothesis. */
export interface TreeLeaf {
  /** `Q1`, `Q2-1` */
  qid: string;
  /** `H1`, `H2-1` */
  label: string;
  question: string;
  claimId: string;
  /** The top-level sub-question it was split from (`Q2`), or null. */
  parent: string | null;
}

/** A top-level sub-question: a leaf itself, or split into two or more leaves. */
export interface TreeRoot {
  qid: string;
  question: string;
  /** Set when this sub-question is not split: its own hypothesis. */
  leaf: TreeLeaf | null;
  /** The question_tree id it is stored under (a split sub-question), or null. */
  node: string | null;
  children: TreeLeaf[];
}

export type QuestionTree = { format: 'question_tree'; roots: TreeRoot[]; leaves: TreeLeaf[]; byClaim: Map<string, TreeLeaf> } | { format: 'legacy' };

export const isTreePlan = (plan: Pick<TreePlan, 'claims'>): boolean => plan.claims.some((c) => Boolean(c.question?.trim()));

/**
 * The tree, numbered by the order of the claims: a top-level sub-question takes the next number when its first claim
 * appears (Q1, Q2…); the leaves under it are numbered in order (Q2-1, Q2-2). treeChecks reports a question_tree id
 * that does not match its place.
 */
export function questionTreeOf(plan: TreePlan): QuestionTree {
  if (!isTreePlan(plan)) return { format: 'legacy' };
  const nodes = new Map((plan.question_tree ?? []).map((n) => [n.id, n]));
  const roots: TreeRoot[] = [];
  const byParent = new Map<string, TreeRoot>();
  for (const c of plan.claims) {
    const parent = c.parent?.trim() || null;
    if (parent) {
      let root = byParent.get(parent);
      if (!root) {
        root = { qid: `Q${roots.length + 1}`, question: nodes.get(parent)?.question ?? '', leaf: null, node: parent, children: [] };
        byParent.set(parent, root);
        roots.push(root);
      }
      const qid = `${root.qid}-${root.children.length + 1}`;
      root.children.push({ qid, label: `H${qid.slice(1)}`, question: c.question?.trim() ?? '', claimId: c.id, parent: root.qid });
    } else {
      const qid = `Q${roots.length + 1}`;
      roots.push({ qid, question: c.question?.trim() ?? '', leaf: { qid, label: `H${qid.slice(1)}`, question: c.question?.trim() ?? '', claimId: c.id, parent: null }, node: null, children: [] });
    }
  }
  const leaves = roots.flatMap((r) => (r.leaf ? [r.leaf] : r.children));
  return { format: 'question_tree', roots, leaves, byClaim: new Map(leaves.map((l) => [l.claimId, l])) };
}

/** The label a claim's hypothesis is shown with: H2-1 in a tree, H{n} (claims order) in the older format. */
export function hypothesisLabel(plan: TreePlan, claimId: string): string {
  const tree = questionTreeOf(plan);
  if (tree.format === 'question_tree') {
    const leaf = tree.byClaim.get(claimId);
    if (leaf) return leaf.label;
  }
  return `H${plan.claims.findIndex((c) => c.id === claimId) + 1}`;
}

/** The claim ids in reading order (the tree's, depth first; the claims' own order in the older format). */
export function treeOrder(plan: TreePlan): string[] {
  const tree = questionTreeOf(plan);
  return tree.format === 'question_tree' ? tree.leaves.map((l) => l.claimId) : plan.claims.map((c) => c.id);
}

/** What a 要查的问题 is shown as: "Q2-1.1" (the stored id C2-Q1 in the older format). */
export function subQuestionLabel(plan: TreePlan, claimId: string, subId: string): string {
  const tree = questionTreeOf(plan);
  const leaf = tree.format === 'question_tree' ? tree.byClaim.get(claimId) : undefined;
  const claim = plan.claims.find((c) => c.id === claimId);
  const at = claim?.sub_questions.findIndex((q) => q.id === subId) ?? -1;
  return leaf && at >= 0 ? `${leaf.qid}.${at + 1}` : subId;
}

const QUESTION_WORDS = /吗|多大|多少|哪些|哪个|哪一|哪里|什么|为什么|是否|怎么|如何|谁|几/;

/** A sub-question must be a question (a rule, only to send the plan back to the model). */
export function isQuestion(text: string): boolean {
  const t = text.trim();
  return /[？?]$/.test(t) || QUESTION_WORDS.test(t);
}

export interface TreeProblem {
  code: 'not_tree' | 'unknown_parent' | 'single_child' | 'unused_node' | 'tree_order' | 'not_question' | 'no_conditions' | 'no_counter_search' | 'no_mece_check';
  message: string;
}

/**
 * The deterministic checks of a question-tree plan (D-39): each lowest-level sub-question has exactly one hypothesis
 * (by structure: a claim is one), each hypothesis has a verification plan, the tree is at most two levels and every
 * split has at least two parts, the sub-questions are questions, and the AI wrote its MECE check. Whether the split is
 * MECE and sufficient is the AI's argument (mece_check), read by the person who approves. An older-format plan has none.
 */
export function treeChecks(plan: TreePlan): TreeProblem[] {
  if (!isTreePlan(plan)) return [];
  const out: TreeProblem[] = [];
  const tree = questionTreeOf(plan);
  if (tree.format !== 'question_tree') return out;
  const nodes = plan.question_tree ?? [];
  const nodeIds = new Set(nodes.map((n) => n.id));
  for (const c of plan.claims) {
    const label = tree.byClaim.get(c.id)?.label ?? c.id;
    if (!c.question?.trim()) out.push({ code: 'not_tree', message: `${c.id}（${c.statement.slice(0, 20)}）没有写它回答的子问题（question）：问题树里每个假设都要挂在一个子问题下面` });
    else if (!isQuestion(c.question)) out.push({ code: 'not_question', message: `${label} 的子问题“${c.question.slice(0, 30)}”不是问句：子问题要写成问句` });
    if (c.parent && !nodeIds.has(c.parent)) out.push({ code: 'unknown_parent', message: `${label} 的 parent 是 ${c.parent}，但 question_tree 里没有这个子问题` });
    if (!c.conditions.some((x) => conditionText(x).trim())) out.push({ code: 'no_conditions', message: `假设 ${label} 没有写必须成立的条件（验证计划的一部分）` });
    if (!c.counter_search.trim()) out.push({ code: 'no_counter_search', message: `假设 ${label} 没有写怎么找反证（验证计划的一部分）` });
  }
  const used = new Map<string, number>();
  for (const c of plan.claims) if (c.parent) used.set(c.parent, (used.get(c.parent) ?? 0) + 1);
  for (const n of nodes) {
    const count = used.get(n.id) ?? 0;
    if (count === 0) out.push({ code: 'unused_node', message: `question_tree 里的 ${n.id}“${n.question.slice(0, 30)}”下面没有假设：没有往下拆的子问题直接写在假设的 question 上` });
    else if (count === 1) out.push({ code: 'single_child', message: `${n.id} 只拆出 1 个下一级子问题：只拆出 1 个就不算拆，把它直接写成一级子问题` });
    if (!isQuestion(n.question)) out.push({ code: 'not_question', message: `${n.id} 的子问题“${n.question.slice(0, 30)}”不是问句：子问题要写成问句` });
  }
  // the stored ids must match the reading order (labels come from the order of the claims)
  for (const root of tree.roots) {
    if (root.node && nodeIds.has(root.node) && root.node !== root.qid) out.push({ code: 'tree_order', message: `question_tree 里的 ${root.node} 按假设的顺序排在第 ${root.qid.slice(1)} 个：编号要和顺序一致（改成 ${root.qid}，或者调整假设的顺序）` });
  }
  if (!plan.mece_check?.trim()) out.push({ code: 'no_mece_check', message: '没有写 mece_check：子问题为什么不重叠、合起来没有漏、少了哪一个就答不了核心问题，要逐条写出理由' });
  return out;
}
