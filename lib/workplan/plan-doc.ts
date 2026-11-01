/**
 * D-64 T35 (ui-2): a research plan as the page shows it — the question, the decision, the first answer, and the tree:
 * each branch (分支) with its sub-questions (子问题), each sub-question with its initial hypothesis and, for a key
 * question, its K number and what changes if the answer is bad. The displayed version follows its body, including
 * revisions written by write_draft without a compose sidecar; an incomplete older note keeps its text view.
 */
import { isBranch, labelsOf, type Tree } from './compose/types';
import { parseWorkplanTree, sectionBody, TREE_SECTION, workplanTreeProblems } from './workplan-tree';

export interface PlanLeaf {
  label: string;
  question: string;
  hypothesis: string;
  key?: string;
  ifBad?: string;
}
export interface PlanBranch {
  label: string;
  question: string;
  /** A top-level question that was not split is its own only sub-question. */
  children: PlanLeaf[];
}
export interface PlanDoc {
  question: string;
  decision: string;
  day1: string;
  keyLine: string | null;
  branches: PlanBranch[];
}

export function planDocOf(tree: Tree): PlanDoc {
  const all = labelsOf(tree);
  const keyOf = new Map(all.filter(({ node }) => !isBranch(node) && node.knockout).map(({ label }, i) => [label, `K${i + 1}`]));
  const leaf = (label: string, node: (typeof all)[number]['node']): PlanLeaf => {
    if (isBranch(node)) throw new Error('not a leaf');
    const key = keyOf.get(label);
    return { label, question: node.question, hypothesis: node.hypothesis.statement, ...(key ? { key, ...(node.ifBad ? { ifBad: node.ifBad } : {}) } : {}) };
  };
  const branches = all
    .filter(({ parent }) => parent === null)
    .map(({ label, node }) => ({
      label,
      question: node.question,
      children: isBranch(node) ? all.filter((x) => x.parent === label).map((x) => leaf(x.label, x.node)) : [leaf(label, node)],
    }));
  return {
    question: tree.core_question,
    decision: tree.decision_options,
    day1: tree.day1_answer,
    keyLine: keyOf.size ? `关键问题：${[...keyOf].map(([label, k]) => `${k} ${all.find((x) => x.label === label)!.node.question}`).join(' · ')}` : null,
    branches,
  };
}

/** Read the format written by renderWorkplan. The body is the only display source, never a possibly stale sidecar. */
export function planDocFromBody(body: string): PlanDoc | null {
  const section = sectionBody(body, TREE_SECTION);
  if (section === null || workplanTreeProblems(body).length) return null;
  const plain = (s: string) => s.replace(/\[\[[^\]]*\]\]/g, '').replace(/〔m\d+〕/g, '').trim();
  const frame = sectionBody(body, '要回答的问题与要支撑的决策') ?? '';
  const question = plain(/^核心问题：(.*)$/m.exec(frame)?.[1] ?? '');
  const decision = plain(/^决策的全部选项：(.*)$/m.exec(frame)?.[1] ?? '');
  const day1 = plain((sectionBody(body, 'Day-1 answer') ?? '').trim().replace(/^（假设，不是结论）/, ''));
  if (!question || !decision || !day1) return null;

  const blocks = new Map<string, string>();
  let qid = '';
  for (const line of section.split(/\r?\n/)) {
    const heading = /^#{3,4}\s+(Q\d+(?:-\d+)?)\s/.exec(line);
    if (heading) { qid = heading[1]; blocks.set(qid, ''); }
    else if (qid) blocks.set(qid, `${blocks.get(qid)}\n${line}`);
  }
  const parsed = parseWorkplanTree(body);
  const leaves = new Map<string, PlanLeaf>();
  for (const leaf of parsed.leaves) {
    const block = blocks.get(leaf.qid) ?? '';
    const hypothesis = /^\*\*假设 (H\d+(?:-\d+)?)\*\*：[ \t]*(.+)$/m.exec(block);
    if (!hypothesis || hypothesis[1] !== leaf.label || !plain(hypothesis[2])) return null;
    const key = /^\*\*(K[1-4])\*\* Knock-out（P0）：结果不理想就会改变 2027 年产品战略(?:（(.*)）)?[ \t]*$/m.exec(plain(block));
    if (block.includes('Knock-out（P0）') && !key) return null;
    leaves.set(leaf.qid, { label: leaf.qid, question: plain(leaf.question), hypothesis: plain(hypothesis[2]), ...(key ? { key: key[1], ...(key[2] ? { ifBad: plain(key[2]) } : {}) } : {}) });
  }
  if (!leaves.size) return null;
  const keys = [...leaves.values()].filter((l) => l.key);
  if (new Set(keys.map((l) => l.key)).size !== keys.length) return null;
  const keyLine = keys.length ? `关键问题：${keys.map((l) => `${l.key} ${l.question}`).join(' · ')}` : null;
  const writtenKeys = /^关键问题：(.*)$/m.exec(section);
  if (keyLine !== (writtenKeys ? plain(writtenKeys[0]) : null)) return null;
  return {
    question, decision, day1, keyLine,
    branches: parsed.roots.map((r) => ({ label: r.qid, question: plain(r.question), children: (r.leaf ? [r.leaf] : r.children).map((l) => leaves.get(l.qid)!) })),
  };
}
