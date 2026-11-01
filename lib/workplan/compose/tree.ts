/**
 * Step 6 (D-61): compile the revised holistic judgment into the tree, once, as JSON: the key uncertainties become the
 * sub-questions, each lowest one with a falsifiable hypothesis. The model writes content; this file's code
 * decides what is acceptable: every cited id must be in the pack, a note already cited as "known" cannot also be a
 * thing "to go and read", a falsifier must say something, sub-questions must be questions. A draft that fails goes
 * back once with the problems in one block; what still fails after that is an error the caller reports.
 */
import { loadPerspectives } from '@/lib/config/perspectives';
import type { ToolContext } from '@/lib/harness/types';
import { LlmJsonError, LlmTruncatedError } from '@/lib/research/llm';
import { composeJson, composeModel } from './llm';
import { DEFAULT_RESOURCES, isMarkable, labelsOf, leavesOf, SLOT_KEYS, SLOT_LABELS, treeSchema, type ComposeState, type PackItem, type Size, type Tree } from './types';

export interface TreeCheck {
  /** Stop the draft: the model must fix these. */
  errors: string[];
  /** Worth telling, not worth stopping. */
  warnings: string[];
}

/** A falsifier that says nothing ("如果数据不支持", "证据不足时"): the C-eval's known empty sentences. */
const EMPTY_FALSIFIER = /^(如果|要是|若)?(数据|证据|资料|调研)?(不支持|不足|没有|找不到|不成立)(的话|时)?[。.]?$/;
const MIN_FALSIFIER = 8;

/** Character-bigram overlap of two sentences, 0..1: a cheap "these two ask the same thing" signal. */
export function overlap(a: string, b: string): number {
  const grams = (s: string) => {
    const t = s.replace(/[\s，。？?、：:；;（）()"“”]/g, '');
    return new Set(Array.from({ length: Math.max(0, t.length - 1) }, (_, i) => t.slice(i, i + 2)));
  };
  const ga = grams(a);
  const gb = grams(b);
  if (ga.size === 0 || gb.size === 0) return 0;
  let both = 0;
  for (const g of ga) if (gb.has(g)) both += 1;
  return both / Math.min(ga.size, gb.size);
}

/** More than this and nobody can check it all: a tree that big has not decided what matters most. A small question gets a small tree. */
export const MAX_FIRST_LEVEL = 5;
/** D-64 T21: 12 (the M1 tree is four lifecycle branches of three). */
export const MAX_LEAVES = 12;
/** D-64 T21: at most this many key questions (knockout). */
export const MAX_KEY_QUESTIONS = 4;
export const LIMITS: Record<Size, { firstLevel: number; leaves: number }> = {
  大题: { firstLevel: MAX_FIRST_LEVEL, leaves: MAX_LEAVES },
  小题: { firstLevel: 3, leaves: 4 },
};

/** Methods a desk-research team cannot run in one workplan; refused unless the research resources name them. */
const OUT_OF_REACH: { pattern: RegExp; allowedBy: RegExp }[] = [
  { pattern: /A\s*\/\s*B|随机(分组|对照|分配)|实验/, allowedBy: /实验|A\s*\/\s*B/ },
  { pattern: /试点/, allowedBy: /试点/ },
  { pattern: /问卷/, allowedBy: /问卷/ },
];

/** The clauses of the resources that allow something (a clause that says 不做 / 不用 / 不在 allows nothing). */
const allowingClauses = (resources: string): string => resources.split(/[；;。，,\n]/).filter((c) => !/不做|不用|不在|不能|不许/.test(c)).join('；');

/** The texts of a tree that describe what to do (where a method would be named). */
function methodTexts(tree: Tree): { where: string; text: string }[] {
  const out = tree.next_actions.map((text, i) => ({ where: `next_actions 第 ${i + 1} 条`, text }));
  for (const { label, node } of leavesOf(tree)) {
    for (const v of node.hypothesis.to_verify) out.push({ where: `${label} 的 to_verify`, text: `${v.what} ${v.support} ${v.counter}` });
  }
  return out;
}

export function checkTree(tree: Tree, pack: PackItem[], size: Size = '大题', resources: string = DEFAULT_RESOURCES): TreeCheck {
  const errors: string[] = [];
  const warnings: string[] = [];
  const ids = new Map(pack.map((i) => [i.id, i]));
  const labelled = labelsOf(tree);

  for (const { label, node } of labelled) {
    // D-64 T21: a sub-question ends with ？ (was a warning)
    if (!/[？?]$/.test(node.question.trim())) errors.push(`${label}「${node.question.slice(0, 24)}」不是问句：子问题要写成问句、以“？”结尾，判断句是假设。`);
  }
  for (const { label, node } of leavesOf(tree)) {
    const h = node.hypothesis;
    if (h.falsifier.length < MIN_FALSIFIER || EMPTY_FALSIFIER.test(h.falsifier.trim())) {
      errors.push(`${label} 的"看到什么就算错"是空话（"${h.falsifier}"）：写具体的证据，例如"采购文件里把可管理性排在价格之后"。`);
    }
    for (const id of h.known_by) {
      const kind = ids.get(id)?.kind;
      if (kind && kind !== 'reference') errors.push(`${label} 的 known_by 里的 ${id}（《${ids.get(id)!.title}》）是${kind === 'directive' ? '会议上的指示' : kind === 'policy' ? '公司方针' : '内部的决定和方法'}，只能当边界，不能当"已经知道的"依据：只用参考资料。`);
      if (!ids.has(id)) errors.push(`${label} 的 known_by 里的 ${id} 不在资料包里：只能用资料包里有的编号。`);
    }
    for (const v of h.to_verify) {
      if (v.where !== '上网' && !ids.has(v.where)) errors.push(`${label} 的 to_verify 里的 ${v.where} 不在资料包里：去哪查只能填资料包的编号或"上网"。`);
      if (h.known_by.includes(v.where)) errors.push(`${label}：${v.where}（《${ids.get(v.where)?.title ?? v.where}》）已经写在"已经知道的"里，不能再写成"还要去读它"。`);
    }
    if (h.known_by.length === 0 && h.to_verify.length === 0) errors.push(`${label} 的假设既没有"已经知道的"，也没有"还要去证实的"：至少写一边。`);
  }
  // a placeholder where a sentence belongs ("…") is a draft that did not finish
  const hollow = (t: string) => t.replace(/[^\p{L}\p{N}]/gu, '').length < 6;
  tree.risks.forEach((r, i) => { if (hollow(r)) errors.push(`risks 第 ${i + 1} 条是空的占位（"${r}"）：写成一句完整的话，或者删掉这一条。`); });
  // The library had material on this question: a tree that uses none of it has not looked.
  if (ids.size > 0 && [...ids.values()].some((i) => i.kind === 'reference') && !leavesOf(tree).some((l) => l.node.hypothesis.known_by.length > 0)) {
    errors.push('资料包里有参考资料，但没有一个假设用上它：把资料包里真正撑得住某个假设的资料编号写进它的 known_by（撑得住才写）。');
  }
  // the tree's top level and each branch: siblings that read as the same question
  const groups: { label: string; question: string }[][] = [labelled.filter((x) => !x.parent).map((x) => ({ label: x.label, question: x.node.question }))];
  for (const { label, node } of labelled) if ('children' in node) groups.push(node.children.map((c, j) => ({ label: `${label}-${j + 1}`, question: c.question })));
  for (const g of groups) {
    for (let i = 0; i < g.length; i++) for (let j = i + 1; j < g.length; j++) if (overlap(g[i].question, g[j].question) >= 0.7) warnings.push(`${g[i].label} 和 ${g[j].label} 的问句几乎一样，可能重叠。`);
  }
  const allowed = allowingClauses(resources);
  for (const { where, text } of methodTexts(tree)) {
    const hit = OUT_OF_REACH.find((m) => m.pattern.test(text) && !m.allowedBy.test(allowed));
    if (hit) errors.push(`${where}的方法超出了研究资源（${resources}）：「${text.slice(0, 30)}」改成读资料或上网查；要找人谈的，写成访谈建议。`);
  }
  const limit = LIMITS[size];
  const why = size === '小题' ? '这是一个小题，树要小' : '一份 workplan 查不了这么多';
  if (tree.subquestions.length > limit.firstLevel) errors.push(`一级子问题有 ${tree.subquestions.length} 个，最多 ${limit.firstLevel} 个（${why}）：合并相近的，删掉最不要紧的。`);
  // D-64 T21 (step 3): 1–4 key questions, each saying what a bad answer changes
  const keys = leavesOf(tree).filter((l) => l.node.knockout);
  if (keys.length === 0) errors.push(`没有标出关键问题：在 1 到 ${MAX_KEY_QUESTIONS} 个最底层子问题上写 "knockout": true（结果不理想就会改变决策的那几个），并写 ifBad。`);
  if (keys.length > MAX_KEY_QUESTIONS) errors.push(`关键问题有 ${keys.length} 个，最多 ${MAX_KEY_QUESTIONS} 个：只留结果不理想就会改变决策的。`);
  for (const k of keys) if (!k.node.ifBad?.trim()) errors.push(`${k.label} 是关键问题，但没有写 ifBad（结果不理想会改变什么决定）。`);
  const leafCount = leavesOf(tree).length;
  if (leafCount > limit.leaves) errors.push(`最底层子问题有 ${leafCount} 个，最多 ${limit.leaves} 个（${why}）：保留最可能推翻答案的。`);
  return { errors, warnings };
}

const SYSTEM = [
  '你是战略部的拆题顾问。问题已经问清楚，整体判断也已经写好并经过独立评估和修订，现在把它编成 workplan 的问题树。只输出 JSON。',
  '规矩：',
  '1. 子问题写成问句，不写话题，也不写判断句；一级最多 5 个，最多两层；往下拆的至少拆出 2 个；按"最可能推翻答案的、最不确定的"排前面。树的大小按"题目大小"那一行：小题一级最多 3 个、最底层最多 4 个；大题一级最多 5 个、最底层最多 12 个。每个子问题以"？"结尾。',
  '1a. 关键问题：在最底层子问题里挑 1 到 4 个"结果不理想就会改变决策"的，写 "knockout": true，并在 ifBad 里写一句结果不理想会改变什么决定。其余的不平均用力。',
  '2. 子问题就是整体判断里的"关键不确定性"：只编答案会改变决策的那几件事，按"最可能推翻答案的、最值得先验证的"排前面；不要为了凑全面再加别的维度。整体判断里的竞争假设，要让它们各自落在某个子问题的假设或 conditions 里，能被区分开。',
  '3. 假设是对还没有定论的事下的判断。资料包里已经明明白白写着的事实，写进 known_by 当依据，或者写进 conditions，不要把它写成"假设"再让人去证实。每个最底层的子问题恰好一个假设：statement 是可证伪的一句话（有方向、有条件、有门槛）；falsifier 写具体的证据，"看到什么就算它错了"，不许写"如果数据不支持"这类空话；conditions 写 1–3 条必须同时成立的条件。',
  '4. 资料包里的编号（K1、K2……）是代码查出来的资料。假设里：',
  '   - known_by：资料包里已经有直接撑着它的资料的编号。只填真的撑得住的，宁缺勿滥；',
  '   - to_verify：还没有资料撑着、要去证实的事。where 只能填资料包里的一个编号（要去读那份资料）或者"上网"；support 写什么证据能证明，counter 写反证去哪里找；',
  '   - 一份资料不能同时出现在同一个假设的 known_by 和 to_verify 里：已经读到、已经知道的，就不再写成"去查"。',
  '5. 高层指示、已确认的决定、业务方针不当证据用，只当边界：拆的时候不要和标了"冲突"又选了"按指示"的条目打架。',
  '6. 要有一个子问题回答"凭什么是我们"（拿这一层最强的对手比，不拿行业平均），或者在 split_basis 里写明这一问交给了哪个 Workspace。',
  '7. split_basis 里写：为什么选这几个不确定性、没选的为什么不研究（验证了也不改变决策）、少了哪个子问题会答不了什么。',
  '8a. 子问题的问句要像一个读者看得懂的问题：不要在括号里写"归 Q3""不在此重复""只问……"这类分工说明（分工写在 split_basis 里），不要用 A、B、Q1a 这类代号称呼任何东西。',
  '8. 每个字段写短，整棵树的输出有长度上限：statement 和 falsifier 各不超过 70 个字；conditions 每条不超过 30 个字；to_verify 里的 what、support、counter 各不超过 40 个字；split_basis 不超过 150 个字；最底层子问题一共不超过 12 个。',
  '9. day1_answer 是一句有判断的话，是假设不是结论。risks 写最可能被推翻的几点，和要 Senior 判断什么。next_actions 写谁、做什么、先后。',
  'JSON 的形状：',
  '{"core_question":"…","decision_options":"…","day1_answer":"…","split_basis":"…",',
  ' "subquestions":[{"question":"…？","knockout":true,"ifBad":"…","hypothesis":{"statement":"…","falsifier":"…","conditions":["…"],"known_by":["K3"],"to_verify":[{"what":"…","where":"K5","support":"…","counter":"…"}],"short":"≤30字的短名"}},',
  '                  {"question":"…","children":[{"question":"…","hypothesis":{…}},{"question":"…","hypothesis":{…}}]}],',
  ' "key_message":"…","risks":["…"],"next_actions":["…"]}',
].join('\n');

export function treePrompt(state: ComposeState, judgment: string, perspectives: string[], problems: string[] = [], open: string[] = []): string {
  const byId = new Map(state.pack.map((i) => [i.id, i]));
  const marked = state.marks
    .filter((m) => m.verdict !== '无关')
    .map((m) => `- ${m.ref}《${byId.get(m.ref)?.title ?? ''}》：${m.verdict}${m.resolution ? `（${m.resolution}）` : ''}。${m.note}`);
  const markable = state.pack.filter(isMarkable);
  const refs = state.pack.filter((i) => i.kind === 'reference'); // the method note is not evidence
  const line = (i: PackItem) => `- ${i.id}《${i.title}》${i.block ? ` ${i.block}` : ''}${i.status ? `（${i.status}）` : ''}：${i.gist}`;
  return [
    '## 问题',
    ...SLOT_KEYS.map((k) => `${SLOT_LABELS[k]}：${state.frame[k]}`),
    `研究资源（方法只能在这里面选）：${state.resources}`,
    `题目大小：${state.size}（一级子问题最多 ${LIMITS[state.size].firstLevel} 个，最底层子问题最多 ${LIMITS[state.size].leaves} 个）`,
    '',
    '## 整体判断（已经过独立评估和修订）',
    judgment,
    ...(open.length ? ['', '## 评估员提了、但这一版没能改掉的意见（写进 risks，让 Senior 判断）', ...open.map((o) => `- ${o}`)] : []),
    '',
    '## 指示、决定、业务方针（只当边界，不当证据）',
    ...(markable.length ? markable.map(line) : ['（没有）']),
    '用户的方向和它们的关系：',
    ...(marked.length ? marked : ['（都无关）']),
    '',
    '## 参考资料（编号可以写进 known_by 和 to_verify.where）',
    ...(refs.length ? refs.map(line) : ['（没有命中的资料：假设的 known_by 只能留空，要证实的写"上网"）']),
    '',
    '## 团队要求调查覆盖的视角（每个视角要么有子问题对应，要么说明为什么这个问题不需要）',
    perspectives.length ? perspectives.join('、') : '（没有配置）',
    ...(problems.length ? ['', '## 上一次的草稿不合格，请改正', ...problems.map((p) => `- ${p}`)] : []),
  ].join('\n');
}

export type DraftResult = { tree: Tree; warnings: string[] } | { error: string };

/** Compile the tree; one retry with the problems named. Never throws for a model that cannot satisfy the checks. */
export async function draftTree(ctx: ToolContext, state: ComposeState, judgment: string, open: string[] = []): Promise<DraftResult> {
  const model = await composeModel(ctx);
  const perspectives = await loadPerspectives(ctx.vault);
  let problems: string[] = [];
  for (let attempt = 0; attempt < 2; attempt++) {
    let tree: Tree;
    try {
      tree = await composeJson({ model, task: 'workplan_tree', system: SYSTEM, prompt: treePrompt(state, judgment, perspectives, problems, open), schema: treeSchema, signal: ctx.abortSignal });
    } catch (e) {
      // An answer cut off at the output limit comes back the same size when asked again: ask for less.
      // Any other unreadable answer is asked once more; a second failure ends as `error`, not as a crash.
      if (!(e instanceof LlmJsonError)) throw e;
      problems = [e instanceof LlmTruncatedError ? '上一次的输出太长，被截断了：每个字段写得更短，最底层子问题不超过 6 个。' : `上一次的输出不是合法的 JSON：${e.message.slice(0, 160)}`];
      continue;
    }
    const check = checkTree(tree, state.pack, state.size, state.resources);
    if (check.errors.length === 0) return { tree, warnings: check.warnings };
    problems = check.errors.slice(0, 8);
  }
  return { error: `拆题的草稿两次都没有过检查：${problems.join('；')}` };
}
