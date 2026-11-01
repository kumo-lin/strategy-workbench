/**
 * The plan as the editor sees it (PRD §6.3 步骤 3–4): structured fields only.
 * Pure — safe to import from client components.
 */
import type { ResearchPlanNote } from '@/lib/notes/schema';
import { conditionText, questionTreeOf, subQuestionLabel, type PlanCondition, type TreeLeaf } from './question-tree';

export const RESEARCH_METHOD_LIST = ['知识库', '网络', '专家访谈'] as const;
export type ResearchMethodName = (typeof RESEARCH_METHOD_LIST)[number];

export interface EditableSubQuestion {
  /** `C1-Q2` */
  id: string;
  question: string;
  methods: ResearchMethodName[];
  /** Team perspectives (90_配置/团队.md) this sub-question looks from; not edited in the UI, carried through. */
  perspective?: string[];
}

export interface EditableClaim {
  /** `C1` */
  id: string;
  statement: string;
  /** `[[假设]]` link or null — not editable in the UI, carried through. */
  hypothesis: string | null;
  /** D-39: the lowest-level sub-question this hypothesis answers, and the top-level one it was split from. */
  question?: string;
  parent?: string | null;
  /** A sentence, or { text, evidence_needed, where } (D-39); edit the words with withConditionText. */
  conditions: PlanCondition[];
  sub_questions: EditableSubQuestion[];
  counter_search: string;
  /** Team perspectives this claim looks from; not edited in the UI, carried through. */
  perspective?: string[];
  /** D63: the key question (K1–K4) and what changes if the result is bad; not edited in the UI, carried through (T36). */
  key?: 'K1' | 'K2' | 'K3' | 'K4';
  if_bad?: string;
}

export interface EditablePlan {
  question: string;
  purpose: string;
  claims: EditableClaim[];
  /** Team perspectives the plan does not look at, with why (D-32). */
  perspectives_skipped?: { perspective: string; reason: string }[];
  /** D-39: the split top-level sub-questions, and the AI's MECE check. */
  question_tree?: { id: string; question: string }[];
  mece_check?: string;
}

export function toEditable(note: Pick<ResearchPlanNote, 'question' | 'purpose' | 'claims'> & Pick<EditablePlan, 'perspectives_skipped' | 'question_tree' | 'mece_check'>): EditablePlan {
  return {
    question: note.question,
    purpose: note.purpose,
    claims: note.claims.map((c) => ({
      id: c.id,
      statement: c.statement,
      hypothesis: c.hypothesis ?? null,
      ...(c.question ? { question: c.question } : {}),
      ...(c.parent ? { parent: c.parent } : {}),
      conditions: c.conditions.map((x) => (typeof x === 'string' ? x : { ...x })),
      sub_questions: c.sub_questions.map((q) => ({ id: q.id, question: q.question, methods: [...q.methods], ...(q.perspective?.length ? { perspective: [...q.perspective] } : {}) })),
      counter_search: c.counter_search,
      ...(c.perspective?.length ? { perspective: [...c.perspective] } : {}),
      ...(c.key ? { key: c.key } : {}),
      ...(c.if_bad ? { if_bad: c.if_bad } : {}),
    })),
    ...(note.perspectives_skipped?.length ? { perspectives_skipped: note.perspectives_skipped.map((x) => ({ ...x })) } : {}),
    ...(note.question_tree?.length ? { question_tree: note.question_tree.map((x) => ({ ...x })) } : {}),
    ...(note.mece_check ? { mece_check: note.mece_check } : {}),
  };
}

/** Markdown body for a plan saved from the editor (the structured fields, in the shape the AI-written plans use). */
export function renderPlanBody(plan: EditablePlan, title: string): string {
  if (questionTreeOf(plan).format === 'question_tree') return renderTreePlanBody(plan, title);
  const lines = [`# ${title}`, '', '## 调查什么 / 为什么', `- 要回答的问题：${plan.question}`, `- 为什么查：${plan.purpose}`, ''];
  for (const c of plan.claims) {
    lines.push(`## 论点 ${c.id}：${c.statement}`);
    if (c.hypothesis) lines.push(`- 对应假设：${c.hypothesis}`);
    if (c.perspective?.length) lines.push(`- 视角：${c.perspective.join('、')}`);
    lines.push('- 成立的条件：', ...c.conditions.map((x) => `  - ${conditionText(x)}`));
    lines.push('- 子问题：', ...c.sub_questions.map((q) => `  - ${q.id} ${q.question}（查法：${q.methods.join('、')}）`));
    lines.push(`- 怎么找反证：${c.counter_search}`, '');
  }
  if (plan.perspectives_skipped?.length) lines.push('## 这次不查的视角', ...plan.perspectives_skipped.map((x) => `- ${x.perspective}：${x.reason}`), '');
  return lines.join('\n');
}

const cell = (s: string | undefined) => (s?.trim() ? s.trim().replace(/\|/g, '\\|').replace(/\n/g, ' ') : '—');

/** A question-tree plan (D-39), in the shape of the sample plan: core question, the tree, each hypothesis and its verification plan, the MECE check. */
function renderTreePlanBody(plan: EditablePlan, title: string): string {
  const tree = questionTreeOf(plan);
  if (tree.format !== 'question_tree') return '';
  const lines = [`# ${title}`, '', '## 这次调查要回答什么', `- 核心问题：${plan.question}`, `- 为什么查：${plan.purpose}`, ''];
  lines.push('## 问题树', '', '```', `核心问题：${plan.question}`);
  tree.roots.forEach((r, i) => {
    const last = i === tree.roots.length - 1;
    lines.push(`${last ? '└─' : '├─'} ${r.qid} ${r.question}`);
    r.children.forEach((c, j) => lines.push(`${last ? '    ' : '│   '}${j === r.children.length - 1 ? '└─' : '├─'} ${c.qid} ${c.question}`));
  });
  lines.push('```', '', '## 每个子问题的假设和验证计划', '');
  const hypothesis = (leaf: TreeLeaf, heading: string) => {
    const c = plan.claims.find((x) => x.id === leaf.claimId);
    if (!c) return;
    lines.push(`${heading} ${leaf.qid} ${leaf.question}`, '', `**假设 ${leaf.label}**：${c.statement}`);
    const about = [c.perspective?.length ? `视角：${c.perspective.join('、')}` : '', c.hypothesis ? `对应假设笔记 ${c.hypothesis}` : ''].filter(Boolean);
    if (about.length) lines.push(`${about.join('。')}。`);
    lines.push('', '| 必须成立的条件 | 要什么证据 | 去哪里查 |', '|---|---|---|');
    c.conditions.forEach((x, k) => lines.push(`| ${k + 1}. ${cell(conditionText(x))} | ${cell(typeof x === 'string' ? '' : x.evidence_needed)} | ${cell(typeof x === 'string' ? '' : x.where)} |`));
    lines.push('', '要查的问题：', ...c.sub_questions.map((q) => `- ${subQuestionLabel(plan, c.id, q.id)} ${q.question}（查法：${q.methods.join('、')}${q.perspective?.length ? `；视角：${q.perspective.join('、')}` : ''}）`));
    lines.push('', `**怎么找反证**：${c.counter_search}`, '');
  };
  for (const r of tree.roots) {
    if (r.leaf) hypothesis(r.leaf, '###');
    else {
      lines.push(`### ${r.qid} ${r.question}`, '');
      for (const c of r.children) hypothesis(c, '####');
    }
  }
  if (plan.mece_check?.trim()) lines.push('## MECE 和充分必要的自检', '', plan.mece_check.trim(), '');
  if (plan.perspectives_skipped?.length) lines.push('## 这次不查的视角', ...plan.perspectives_skipped.map((x) => `- ${x.perspective}：${x.reason}`), '');
  return lines.join('\n');
}

/**
 * A quote that was shortened with an ellipsis ("cited by 59% … security benefits at 35%") is not a verbatim
 * quote, and must not look like one in front of a block link: it is marked 『…』, which check_citations does
 * not read as a quotation. Quotes without an ellipsis are left alone (and checked).
 */
export function markExcerptQuotes(text: string): string {
  return text.replace(/[「“]([^」”]*(?:…|\.\.\.)[^」”]*)[」”](?=\s*(?:[（(][^）)]*[）)])?\s*\[\[[^\]]*#\^)/g, '『$1』');
}

export function markExcerptsInPlan(plan: EditablePlan): EditablePlan {
  const m = markExcerptQuotes;
  return {
    ...plan,
    question: m(plan.question),
    purpose: m(plan.purpose),
    claims: plan.claims.map((c) => ({
      ...c,
      statement: m(c.statement),
      ...(c.question !== undefined ? { question: m(c.question) } : {}),
      conditions: c.conditions.map((x) => (typeof x === 'string' ? m(x) : { ...x, text: m(x.text), ...(x.evidence_needed !== undefined ? { evidence_needed: m(x.evidence_needed) } : {}), ...(x.where !== undefined ? { where: m(x.where) } : {}) })),
      sub_questions: c.sub_questions.map((q) => ({ ...q, question: m(q.question) })),
      counter_search: m(c.counter_search),
    })),
    ...(plan.question_tree ? { question_tree: plan.question_tree.map((n) => ({ ...n, question: m(n.question) })) } : {}),
    ...(plan.mece_check !== undefined ? { mece_check: m(plan.mece_check) } : {}),
  };
}
