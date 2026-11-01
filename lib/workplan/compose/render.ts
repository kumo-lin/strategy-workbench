/**
 * The tree as a workplan note (D-56 ③ v2): the code writes the markdown, the model never does. The sections and the
 * heading shapes are exactly what `workplanTreeProblems` and `parseWorkplanTree` read, so everything downstream of
 * the note (the page, G1, the research plan) is unchanged. Pure; no I/O.
 */
import { isBranch, labelsOf, SLOT_KEYS, SLOT_LABELS, type ComposeState, type Hypothesis, type Leaf, type PackItem, type Tree } from './types';

export interface RenderInput {
  tree: Tree;
  state: Pick<ComposeState, 'frame' | 'marks' | 'pack'> & Partial<Pick<ComposeState, 'resources'>>;
  /** `WS-A` etc.: the prefix of the hypothesis note names. */
  wsCode: string;
  /** The number of the first hypothesis note (the next free one in this project). */
  firstHypothesisNumber: number;
  /** What the evaluation found and the revision could not fix: one sentence each, under 风险和待确认. */
  openIssues?: string[];
}

export interface RenderedHypothesis {
  /** Display label of the sub-question: Q1, Q2-1. */
  qid: string;
  /** `H1`, `H2-1`. */
  label: string;
  /** Note name without `.md`: `WS-A-H3 短述`. */
  name: string;
  leaf: Leaf;
}

export interface Rendered {
  body: string;
  hypotheses: RenderedHypothesis[];
}

/** An ellipsis anywhere in a sentence (… or ...): the model cut it off or left a placeholder. */
export const hasEllipsis = (text: string): boolean => /…|\.{3,}/.test(text);

/** `[[标题#^块]]`: how a pack item is linked from a workplan note. */
export function packLink(i: PackItem): string {
  return `[[${i.title}${i.block ? `#${i.block}` : ''}]]`;
}

/** The pack gist is a cut of the note's own text: drop its bold marks so the workplan reads as plain sentences. */
const itemLine = (i: PackItem) => `${packLink(i)}${i.gist ? `：${i.gist.replace(/\*\*/g, '')}` : ''}`;

/** A hypothesis note's file name must be a plain name: no path separators, nothing that breaks a [[link]]. */
export function noteNamePart(short: string): string {
  const clean = short.replace(/[\\/:*?"<>|#^[\]]+/g, ' ').replace(/\s+/g, ' ').trim();
  return clean || '假设';
}

function hypothesisNotes(tree: Tree, wsCode: string, first: number): RenderedHypothesis[] {
  return labelsOf(tree)
    .filter((x) => !isBranch(x.node))
    .map((x, i) => ({
      qid: x.label,
      label: `H${x.label.slice(1)}`,
      name: `${wsCode}-H${first + i} ${noteNamePart((x.node as Leaf).hypothesis.short)}`,
      leaf: x.node as Leaf,
    }));
}

function premises(input: RenderInput): string {
  const lines: string[] = [];
  const byId = new Map(input.state.pack.map((i) => [i.id, i]));
  for (const m of input.state.marks) {
    const item = byId.get(m.ref);
    if (!item || m.verdict === '无关') continue;
    const kind = item.kind === 'directive' ? '高层指示' : item.kind === 'decision' ? '已确认的决定' : '公司业务方针';
    const state = item.status && item.status !== '已确认' ? `，状态“${item.status}”，还没确认` : '';
    if (m.verdict === '一致') lines.push(`- ${kind}（一致）：${itemLine(item)}${state}${/[…。]$/.test(`${itemLine(item)}${state}`) ? '' : '。'}${m.note}`);
    else lines.push(`- ${kind}（**和用户的方向不一致**，${m.resolution ? `处理：${m.resolution}` : '处理待定'}）：${itemLine(item)}${state}${/[…。]$/.test(`${itemLine(item)}${state}`) ? '' : '。'}${m.note}`);
  }
  return lines.length ? lines.join('\n') : '（资料里没有对这件事的指示或已确认的决定）';
}

function verification(h: RenderedHypothesis, byId: Map<string, PackItem>): string {
  const hyp: Hypothesis = h.leaf.hypothesis;
  const known = hyp.known_by.map((id) => byId.get(id)).filter((i): i is PackItem => Boolean(i));
  const lines = [
    `### ${h.label}`,
    '',
    `必须成立的条件：${hyp.conditions.map((c, i) => `（${i + 1}）${c}`).join('；')}`,
    `看到什么就算它错了：${hyp.falsifier}`,
    '',
    '已经知道的（有资料撑着，不用再查）：',
    ...(known.length ? known.map((i) => `- ${itemLine(i)}`) : ['- 参考库里还没有直接撑它的资料']),
    '',
    '还要去证实的：',
    ...(hyp.to_verify.length
      ? hyp.to_verify.map((v) => {
          const where = v.where === '上网' ? '上网查' : (byId.get(v.where) ? `读 ${packLink(byId.get(v.where)!)}` : v.where);
          return `- ${v.what}。去哪里查：${where}。什么能证明：${v.support}。反证去哪里找：${v.counter}。`;
        })
      : ['- 现有资料已经够支撑，不需要再查']),
  ];
  return lines.join('\n');
}

export function renderWorkplan(input: RenderInput): Rendered {
  const { tree, state } = input;
  const byId = new Map(state.pack.map((i) => [i.id, i]));
  const hyps = hypothesisNotes(tree, input.wsCode, input.firstHypothesisNumber);
  const hypByQid = new Map(hyps.map((h) => [h.qid, h]));

  // D-64 T21: the key questions K1–K4, in reading order
  const keyOf = new Map(labelsOf(tree).filter(({ node }) => !isBranch(node) && node.knockout).map(({ label }, i) => [label, `K${i + 1}`]));
  const treeLines: string[] = [];
  if (keyOf.size) {
    treeLines.push(`关键问题：${labelsOf(tree).filter(({ label }) => keyOf.has(label)).map(({ label, node }) => `${keyOf.get(label)} ${node.question}`).join(' · ')}`, '');
  }
  labelsOf(tree).forEach(({ label, node, parent }) => {
    treeLines.push(`${parent ? '####' : '###'} ${label} ${node.question}`);
    if (!isBranch(node)) {
      const h = hypByQid.get(label)!;
      treeLines.push(`**假设 ${h.label}**：${node.hypothesis.statement} [[${h.name}]]`);
      if (node.knockout) treeLines.push(`**${keyOf.get(label)}** Knock-out（P0）：结果不理想就会改变 2027 年产品战略${node.ifBad ? `（${node.ifBad}）` : ''}`);
    }
    treeLines.push('');
  });

  const frameLines = SLOT_KEYS.filter((k) => k !== 'question').map((k) => `${SLOT_LABELS[k]}：${state.frame[k]}`);
  // a risk sentence with an ellipsis is a cut-off or a placeholder: it is dropped whole, and a fixed line stands in when none is left
  const own = tree.risks.filter((r) => !hasEllipsis(r) && r.replace(/[^\p{L}\p{N}]/gu, '').length >= 6);
  const risks = [...(own.length ? own : ['主要风险待你补充']), ...(input.openIssues ?? [])];

  const body = [
    `# ${input.wsCode} workplan`,
    '',
    '## 要回答的问题与要支撑的决策',
    `核心问题：${tree.core_question}`,
    '',
    ...frameLines.map((l) => `${l}`),
    ...(state.resources ? [`研究资源：${state.resources}`] : []),
    `决策的全部选项：${tree.decision_options}`,
    '',
    '## 前提',
    premises(input),
    '',
    '## Day-1 answer',
    `（假设，不是结论）${tree.day1_answer}`,
    '',
    '## 问题树与假设',
    ...treeLines,
    '## MECE 和充分必要的自检',
    '怎么选的：先整体判断核心问题、竞争假设和关键的不确定性，经独立评估、修订一轮后，只为答案会改变决策的几件事编子问题。',
    tree.split_basis,
    '',
    '## 每个假设怎么验证',
    ...hyps.flatMap((h) => [verification(h, byId), '']),
    '## 金字塔骨架',
    `key message：${tree.key_message}`,
    `结构：核心问题的回答由${labelsOf(tree).filter((x) => !x.parent).map((x) => x.label).join('、')}的回答组装，每个回答落在它的假设和证据上。`,
    '',
    '## 风险和待确认',
    ...risks.map((r) => `- ${r}`),
    '',
    '## next action',
    ...tree.next_actions.map((a) => `- ${a}`),
    '',
  ].join('\n');

  return { body, hypotheses: hyps };
}
