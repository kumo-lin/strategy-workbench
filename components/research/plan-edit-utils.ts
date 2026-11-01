import { conditionText, isTreePlan, questionTreeOf, subQuestionLabel, type PlanCondition } from '@/lib/research/question-tree';
import type {
  EditableClaim,
  EditablePlan,
  EditableSubQuestion,
  ResearchMethodName,
} from '@/lib/research/plan-types';

/** Every freshly created sub-question starts with the knowledge base enabled. */
const DEFAULT_METHODS: readonly ResearchMethodName[] = ['知识库'];

function defaultMethods(): ResearchMethodName[] {
  return [...DEFAULT_METHODS];
}

/**
 * `C1-Q{n}` where n is one past the highest existing suffix — not the count,
 * because ids must stay stable when a middle sub-question is removed.
 */
export function nextSubQuestionId(claim: EditableClaim): string {
  const prefix = `${claim.id}-Q`;
  let max = 0;
  for (const sub of claim.sub_questions) {
    if (!sub.id.startsWith(prefix)) continue;
    const n = Number.parseInt(sub.id.slice(prefix.length), 10);
    if (Number.isInteger(n) && n > max) max = n;
  }
  return `${prefix}${max + 1}`;
}

/** `C{n}` one past the highest existing claim number. */
export function nextClaimId(plan: EditablePlan): string {
  let max = 0;
  for (const claim of plan.claims) {
    const match = /^C(\d+)$/.exec(claim.id);
    if (!match) continue;
    const n = Number.parseInt(match[1], 10);
    if (Number.isInteger(n) && n > max) max = n;
  }
  return `C${max + 1}`;
}

export function addSubQuestion(plan: EditablePlan, claimId: string, question = ''): EditablePlan {
  let changed = false;
  const claims = plan.claims.map((claim) => {
    if (claim.id !== claimId) return claim;
    changed = true;
    const sub: EditableSubQuestion = {
      id: nextSubQuestionId(claim),
      question,
      methods: defaultMethods(),
    };
    return { ...claim, sub_questions: [...claim.sub_questions, sub] };
  });
  return changed ? { ...plan, claims } : plan;
}

export function removeSubQuestion(plan: EditablePlan, claimId: string, subId: string): EditablePlan {
  const claim = plan.claims.find((c) => c.id === claimId);
  if (!claim) return plan;
  // A claim always keeps at least one sub-question; refuse instead of guessing.
  if (claim.sub_questions.length <= 1) return plan;
  if (!claim.sub_questions.some((q) => q.id === subId)) return plan;
  const claims = plan.claims.map((c) =>
    c.id === claimId ? { ...c, sub_questions: c.sub_questions.filter((q) => q.id !== subId) } : c,
  );
  return { ...plan, claims };
}

export function updateSubQuestion(
  plan: EditablePlan,
  subId: string,
  patch: Partial<Pick<EditableSubQuestion, 'question' | 'methods' | 'perspective'>>,
): EditablePlan {
  let changed = false;
  const claims = plan.claims.map((claim) => {
    if (!claim.sub_questions.some((q) => q.id === subId)) return claim;
    changed = true;
    return {
      ...claim,
      sub_questions: claim.sub_questions.map((sub) => {
        if (sub.id !== subId) return sub;
        const next: EditableSubQuestion = { ...sub, methods: [...sub.methods] };
        if (patch.question !== undefined) next.question = patch.question;
        if (patch.methods !== undefined) next.methods = [...patch.methods];
        if ('perspective' in patch) {
          if (patch.perspective?.length) next.perspective = [...patch.perspective];
          else delete next.perspective;
        }
        return next;
      }),
    };
  });
  return changed ? { ...plan, claims } : plan;
}

export function addClaim(plan: EditablePlan): EditablePlan {
  const id = nextClaimId(plan);
  const claim: EditableClaim = {
    id,
    statement: '',
    hypothesis: null,
    conditions: [''],
    sub_questions: [{ id: `${id}-Q1`, question: '', methods: defaultMethods() }],
    counter_search: '',
  };
  return { ...plan, claims: [...plan.claims, claim] };
}

export function removeClaim(plan: EditablePlan, claimId: string): EditablePlan {
  if (plan.claims.length <= 1) return plan;
  if (!plan.claims.some((c) => c.id === claimId)) return plan;
  return { ...plan, claims: plan.claims.filter((c) => c.id !== claimId) };
}

// ── the question tree (D-39) ──────────────────────────────────────────────
//
// A claim is a lowest-level sub-question and its hypothesis; a split top-level sub-question is a `question_tree` node
// its claims name in `parent`. Labels (Q2-1, H2-1) come from the claims' order, so every change keeps the children of a
// node next to each other and renumbers the node ids to their place (treeChecks reports an id out of place).

/** An empty condition row of the three-column table. */
export const emptyCondition = (): PlanCondition => ({ text: '', evidence_needed: '', where: '' });

function emptyLeaf(id: string, parent: string | null): EditableClaim {
  return { id, question: '', parent, statement: '', hypothesis: null, conditions: [emptyCondition()], sub_questions: [{ id: `${id}-Q1`, question: '', methods: defaultMethods() }], counter_search: '' };
}

/**
 * The tree of a plan being edited. A question cleared while typing must not turn the plan into the older format (which
 * is read from "some claim has a question"), so empty questions stand in as "？" here; the inputs read the plan itself.
 */
export function editorTree(plan: EditablePlan) {
  const tree = questionTreeOf({ ...plan, claims: plan.claims.map((c) => ({ ...c, question: c.question?.trim() ? c.question : '？' })) });
  if (tree.format !== 'question_tree') throw new Error('unreachable: every claim has a question');
  return tree;
}

/** Node ids renumbered to their place (Q1, Q2… by first appearance in the claims); nodes no claim names are dropped. */
function renumber(plan: EditablePlan): EditablePlan {
  const ids = new Map<string, string>();
  let n = 0;
  for (const c of plan.claims) {
    if (!c.parent) n += 1;
    else if (!ids.has(c.parent)) ids.set(c.parent, `Q${++n}`);
  }
  const nodes = (plan.question_tree ?? []).filter((x) => ids.has(x.id)).map((x) => ({ ...x, id: ids.get(x.id)! }));
  nodes.sort((a, b) => Number(a.id.slice(1)) - Number(b.id.slice(1)));
  return { ...plan, claims: plan.claims.map((c) => (c.parent ? { ...c, parent: ids.get(c.parent)! } : c)), question_tree: nodes };
}

/** A new top-level sub-question at the end, with an empty hypothesis card. */
export function addTopQuestion(plan: EditablePlan): EditablePlan {
  return renumber({ ...plan, claims: [...plan.claims, emptyLeaf(nextClaimId(plan), null)] });
}

/**
 * Split a top-level sub-question one level further: its question becomes the node's, its hypothesis the first part
 * (whose question is to be written), and a second, empty part follows — a split has at least two parts. Parts are
 * not split again (two levels at most).
 */
export function splitQuestion(plan: EditablePlan, claimId: string): EditablePlan {
  const at = plan.claims.findIndex((c) => c.id === claimId);
  const claim = plan.claims[at];
  if (!claim || claim.parent) return plan;
  const node = `Q${(plan.question_tree ?? []).reduce((m, x) => Math.max(m, Number(x.id.slice(1)) || 0), 0) + 100}`; // renumbered below
  const second = emptyLeaf(nextClaimId(plan), node);
  const claims = [...plan.claims.slice(0, at), { ...claim, question: '', parent: node }, second, ...plan.claims.slice(at + 1)];
  return renumber({ ...plan, claims, question_tree: [...(plan.question_tree ?? []), { id: node, question: claim.question ?? '' }] });
}

/** One more part under a split sub-question, after its last part. */
export function addChildQuestion(plan: EditablePlan, nodeId: string): EditablePlan {
  const last = plan.claims.map((c) => c.parent).lastIndexOf(nodeId);
  if (last < 0) return plan;
  const claims = [...plan.claims.slice(0, last + 1), emptyLeaf(nextClaimId(plan), nodeId), ...plan.claims.slice(last + 1)];
  return renumber({ ...plan, claims });
}

/** Remove a lowest-level sub-question and its hypothesis (one is always kept). A split left with one part is reported by treeChecks. */
export function removeQuestion(plan: EditablePlan, claimId: string): EditablePlan {
  if (plan.claims.length <= 1 || !plan.claims.some((c) => c.id === claimId)) return plan;
  return renumber({ ...plan, claims: plan.claims.filter((c) => c.id !== claimId) });
}

/** Remove a split sub-question with all its parts (unless nothing would be left). */
export function removeTreeNode(plan: EditablePlan, nodeId: string): EditablePlan {
  const claims = plan.claims.filter((c) => c.parent !== nodeId);
  if (!claims.length || claims.length === plan.claims.length) return plan;
  return renumber({ ...plan, claims });
}

export function updateClaimQuestion(plan: EditablePlan, claimId: string, question: string): EditablePlan {
  return { ...plan, claims: plan.claims.map((c) => (c.id === claimId ? { ...c, question } : c)) };
}

export function updateTreeNode(plan: EditablePlan, nodeId: string, question: string): EditablePlan {
  return { ...plan, question_tree: (plan.question_tree ?? []).map((x) => (x.id === nodeId ? { ...x, question } : x)) };
}

/** One cell of a condition row; a condition written as a sentence becomes a row when its other cells are filled. */
export function updateCondition(c: PlanCondition, field: 'text' | 'evidence_needed' | 'where', value: string): PlanCondition {
  const row = typeof c === 'string' ? { text: c } : { ...c };
  return { ...row, [field]: value };
}

function validateTreePlan(plan: EditablePlan): string[] {
  const errors: string[] = [];
  if (!plan.question.trim()) errors.push('核心问题不能为空');
  if (!plan.purpose.trim()) errors.push('调查目的不能为空');
  const tree = editorTree(plan);
  for (const r of tree.roots) if (r.node && !(plan.question_tree ?? []).find((x) => x.id === r.node)?.question.trim()) errors.push(`${r.qid}：子问题的问句不能为空`);
  const subIds = new Set<string>();
  for (const c of plan.claims) {
    const leaf = tree.byClaim.get(c.id);
    const label = leaf?.label ?? c.id;
    if (!c.question?.trim()) errors.push(`${leaf?.qid ?? c.id}：子问题的问句不能为空`);
    if (!c.statement.trim()) errors.push(`假设 ${label}：假设不能为空`);
    if (!c.conditions.some((x) => conditionText(x).trim())) errors.push(`假设 ${label}：至少需要一条必须成立的条件`);
    if (!c.counter_search.trim()) errors.push(`假设 ${label}：缺少“怎么找反证”`);
    if (c.sub_questions.length === 0) errors.push(`假设 ${label}：至少需要 1 个要查的问题`);
    for (const q of c.sub_questions) {
      const ql = subQuestionLabel(plan, c.id, q.id);
      if (subIds.has(q.id)) errors.push(`要查的问题 id 重复：${q.id}`);
      subIds.add(q.id);
      if (!q.question.trim()) errors.push(`要查的问题 ${ql}：问法不能为空`);
      if (q.methods.length === 0) errors.push(`要查的问题 ${ql}：至少选一种查法`);
    }
  }
  return errors;
}

/**
 * Chinese, position-tagged messages. Empty array means the plan is approvable. `tree`: the editor's format, fixed when
 * the plan was loaded (default: read from the plan).
 */
export function validatePlan(plan: EditablePlan, tree = isTreePlan(plan)): string[] {
  if (tree) return validateTreePlan(plan);
  const errors: string[] = [];

  if (!plan.question.trim()) errors.push('调查问题不能为空');
  if (!plan.purpose.trim()) errors.push('调查目的不能为空');

  if (plan.claims.length === 0) {
    errors.push('至少需要 1 个论点');
    return errors;
  }

  const claimIds = new Set<string>();
  const subIds = new Set<string>();

  for (const claim of plan.claims) {
    if (claimIds.has(claim.id)) errors.push(`论点 id 重复：${claim.id}`);
    claimIds.add(claim.id);
  }

  for (const claim of plan.claims) {
    if (!claim.statement.trim()) errors.push(`${claim.id}：论点陈述不能为空`);
    if (!claim.counter_search.trim()) errors.push(`${claim.id}：缺少“怎么找反证”`);
    if (!claim.conditions.some((condition) => conditionText(condition).trim())) {
      errors.push(`${claim.id}：至少需要一条成立条件`);
    }
    if (claim.sub_questions.length === 0) errors.push(`${claim.id}：至少需要 1 个子问题`);

    for (const sub of claim.sub_questions) {
      if (subIds.has(sub.id)) errors.push(`子问题 id 重复：${sub.id}`);
      subIds.add(sub.id);
      if (!sub.question.trim()) errors.push(`${sub.id}：问法不能为空`);
      if (sub.methods.length === 0) errors.push(`${sub.id}：至少选一种查法`);
    }
  }

  return errors;
}

/** Content comparison (the editor only ever holds plain JSON-shaped data). */
export function planEquals(a: EditablePlan, b: EditablePlan): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** A perspective ticked or unticked; none left = no field (the plan stays as an old one would). */
export function togglePerspective(list: string[] | undefined, perspective: string): string[] | undefined {
  const next = list?.includes(perspective) ? list.filter((p) => p !== perspective) : [...(list ?? []), perspective];
  return next.length ? next : undefined;
}
