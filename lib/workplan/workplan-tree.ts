/**
 * The question tree of a workplan (D-39, P3). A workplan is read by people (Senior reviews it at G1), so the tree is
 * written as headings, not frontmatter: every node is a heading the "关于" list can point at.
 *
 *   ## 问题树与假设
 *   ### Q1 <问句>                       a top-level sub-question that is not split: its own hypothesis
 *   **假设 H1**：<可证伪的一句话> [[WS-A-H1 …]]
 *   ### Q2 <问句>                       a split one: two or more `####` under it, no hypothesis of its own
 *   #### Q2-1 <问句>
 *   **假设 H2-1**：… [[WS-A-H2 …]]
 *   #### Q2-2 <问句>
 *   **假设 H2-2**：… [[WS-A-H3 …]]
 *
 * Numbers are by reading order (the same labels the research plan shows, lib/research/question-tree.ts). Which plan a
 * workplan follows is its own: a workplan without the section is the older format and is not judged.
 * Pure — safe to import from client components.
 */
import { isQuestion } from '@/lib/research/question-tree';

/** Shown above a workplan written before the question tree, when the project has one (display only). */
export const LEGACY_WORKPLAN_NOTE = '这是改成问题树之前的版本';

export const TREE_SECTION = '问题树与假设';
export const MECE_SECTION = 'MECE 和充分必要的自检';

/** The sections of a question-tree workplan, in order (each a `## ` heading). */
export const WORKPLAN_SECTIONS = [
  '要回答的问题与要支撑的决策',
  '前提',
  'Day-1 answer',
  TREE_SECTION,
  MECE_SECTION,
  '每个假设怎么验证',
  '金字塔骨架',
  '风险和待确认',
  'next action',
] as const;

export interface WorkplanLeaf {
  /** `Q1`, `Q2-1` */
  qid: string;
  /** `H1`, `H2-1` */
  label: string;
  question: string;
  /** The `[[…]]` of its hypothesis line, null when it has none. */
  hypothesis: string | null;
  /** The top-level sub-question it was split from, or null. */
  parent: string | null;
}

export interface WorkplanRoot {
  qid: string;
  question: string;
  leaf: WorkplanLeaf | null;
  children: WorkplanLeaf[];
}

export interface WorkplanTree {
  roots: WorkplanRoot[];
  leaves: WorkplanLeaf[];
}

/** The body of a `## title` section (to the next `## `), or null when the section is not there. */
export function sectionBody(body: string, title: string): string | null {
  const lines = body.split(/\r?\n/);
  const at = lines.findIndex((l) => new RegExp(`^##\\s+${title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`).test(l));
  if (at < 0) return null;
  const rest = lines.slice(at + 1);
  const end = rest.findIndex((l) => /^##\s/.test(l));
  return (end < 0 ? rest : rest.slice(0, end)).join('\n');
}

/** A workplan is in the question-tree format when it has the tree section. */
export const hasQuestionTree = (body: string): boolean => sectionBody(body, TREE_SECTION) !== null;

const HYPOTHESIS_LINE = /^\s*(?:[-*]\s*)?(?:\*\*)?假设\s*H(\d+(?:-\d+)?)\s*(?:\*\*)?\s*[：:]/;
const LINK = /\[\[[^\]]+\]\]/;

interface RawNode {
  level: 3 | 4 | 5;
  id: string;
  question: string;
  lines: string[];
}

/** Headings of the tree section with the lines under each; anything before the first heading is ignored. */
function rawNodes(section: string): RawNode[] {
  const out: RawNode[] = [];
  let cur: RawNode | null = null;
  for (const line of section.split(/\r?\n/)) {
    const h = /^(#{3,6})\s+(.*)$/.exec(line);
    if (h) {
      const level = Math.min(h[1].length, 5) as 3 | 4 | 5;
      const m = /^(Q\d+(?:-\d+)?(?:-\d+)*)\s*(.*)$/.exec(h[2].trim());
      cur = { level, id: m ? m[1] : '', question: (m ? m[2] : h[2]).trim(), lines: [] };
      out.push(cur);
    } else cur?.lines.push(line);
  }
  return out;
}

const hypothesesOf = (n: RawNode): { label: string; link: string | null }[] =>
  n.lines.flatMap((l) => {
    const m = HYPOTHESIS_LINE.exec(l);
    return m ? [{ label: `H${m[1]}`, link: LINK.exec(l)?.[0] ?? null }] : [];
  });

/** The tree as written (what the headings say; problems are reported by `workplanTreeProblems`). */
export function parseWorkplanTree(body: string): WorkplanTree {
  const section = sectionBody(body, TREE_SECTION) ?? '';
  const roots: WorkplanRoot[] = [];
  for (const n of rawNodes(section)) {
    const hyp = hypothesesOf(n)[0];
    const leaf = (qid: string, parent: string | null): WorkplanLeaf => ({
      qid,
      label: `H${qid.slice(1)}`,
      question: n.question,
      hypothesis: hyp?.link ?? null,
      parent,
    });
    if (n.level === 3) roots.push({ qid: n.id, question: n.question, leaf: leaf(n.id, null), children: [] });
    else if (n.level === 4 && roots.length) {
      const root = roots[roots.length - 1];
      root.children.push(leaf(n.id, root.qid));
      root.leaf = null;
    }
  }
  return { roots, leaves: roots.flatMap((r) => (r.leaf ? [r.leaf] : r.children)) };
}

/**
 * What stops a question-tree workplan from being written (structure only): the sections, the tree's shape (at most
 * two levels, a split has two or more parts, numbered in reading order), one hypothesis per lowest-level sub-question,
 * and the MECE check written. Wording (is it a question, is it MECE) is the model's and the reviewer's to judge.
 */
export function workplanTreeProblems(body: string): string[] {
  const problems: string[] = [];
  const missing = WORKPLAN_SECTIONS.filter((t) => sectionBody(body, t) === null);
  if (missing.length) {
    problems.push(`缺少这些小节（标题要照抄，用 \`## \` 开头）：${missing.map((t) => `「${t}」`).join('、')}。`);
  }
  const mece = sectionBody(body, MECE_SECTION);
  if (mece !== null && !mece.trim()) problems.push(`「${MECE_SECTION}」是空的：写出怎么拆的、为什么不重叠、为什么不遗漏、少了每个子问题会答不了什么。`);

  const section = sectionBody(body, TREE_SECTION);
  if (section === null) return problems;
  const nodes = rawNodes(section);
  if (!nodes.length) {
    problems.push(`「${TREE_SECTION}」里没有子问题：用 \`### Q1 <问句>\` 写第一个子问题，往下拆的用 \`#### Q2-1 <问句>\`。`);
    return problems;
  }

  let top = 0;
  let sub = 0;
  let open: { id: string; children: number } | null = null;
  const closeOpen = () => {
    if (open && open.children === 1) problems.push(`${open.id} 只拆出 1 个下一级子问题：只拆出 1 个就不算拆，把它直接写成一级子问题。`);
    open = null;
  };
  nodes.forEach((n, i) => {
    if (n.level === 5) {
      problems.push(`「${n.id || n.question.slice(0, 12)}」是第三层：子问题最多两层（\`###\` 一级、\`####\` 二级），第三层通常是把"要查的问题"当成了子问题，放进"每个假设怎么验证"里。`);
      return;
    }
    const hyps = hypothesesOf(n);
    if (n.level === 3) {
      closeOpen();
      top += 1;
      sub = 0;
      const want = `Q${top}`;
      if (n.id !== want) problems.push(`第 ${top} 个一级子问题的标题要写成 \`### ${want} <问句>\`，现在是「${n.id || '没有编号'}」。编号按顺序，从 Q1 开始。`);
      open = { id: want, children: 0 };
    } else {
      if (!open) {
        problems.push(`\`#### ${n.id}\` 前面没有一级子问题：二级子问题要写在 \`### Q<n>\` 下面。`);
        return;
      }
      sub += 1;
      open.children += 1;
      const want = `${open.id}-${sub}`;
      if (n.id !== want) problems.push(`${open.id} 下面第 ${sub} 个二级子问题的标题要写成 \`#### ${want} <问句>\`，现在是「${n.id || '没有编号'}」。`);
    }
    const id = n.id || '这个子问题';
    const next = nodes.slice(i + 1).find((m) => m.level < 5);
    if (n.level === 3 && next?.level === 4) {
      if (hyps.length) problems.push(`${id} 往下拆了，它自己不挂假设：把假设写在它的二级子问题下面。`);
      return;
    }
    // a lowest-level sub-question: exactly one hypothesis, with a link
    const label = `H${(n.id || '').slice(1)}`;
    if (hyps.length === 0) problems.push(`${id} 下面没有假设：每个最底层的子问题有且只有一个假设，写成一行 \`**假设 ${label}**：<可证伪的一句话> [[<假设笔记>]]\`。`);
    else if (hyps.length > 1) problems.push(`${id} 下面有 ${hyps.length} 个假设：一个子问题想写两个假设，说明它还能再拆。`);
    else {
      if (!hyps[0].link) problems.push(`${id} 的假设没有链接：假设行后面要带 [[假设笔记]] 的链接。`);
      if (n.id && hyps[0].label !== label) problems.push(`${id} 的假设应该叫 ${label}，现在写的是 ${hyps[0].label}（假设的编号和子问题的编号一一对应）。`);
    }
  });
  closeOpen();
  return problems;
}

/** What is worth telling the model but not worth stopping the write for. */
export function workplanTreeWarnings(body: string): string[] {
  const section = sectionBody(body, TREE_SECTION);
  if (section === null) return [];
  const out: string[] = [];
  const nodes = rawNodes(section).filter((n) => n.level < 5);
  for (const n of nodes) {
    if (n.question && !isQuestion(n.question)) out.push(`${n.id || '一个子问题'}「${n.question.slice(0, 24)}」不像问句：子问题要写成问句，判断句是假设。`);
  }
  const top = nodes.filter((n) => n.level === 3).length;
  if (top > 5) out.push(`一级子问题有 ${top} 个：超过 5 个通常是没想清楚哪个最关键。`);
  if (!/凭什么|为什么是联想|为什么是我们|最强的对手|交给/.test(section + (sectionBody(body, MECE_SECTION) ?? ''))) {
    out.push('没有看到"凭什么是我们"：要么有一个子问题拿最强的对手比，要么写明这一问交给了哪个 Workspace。');
  }
  return out;
}
