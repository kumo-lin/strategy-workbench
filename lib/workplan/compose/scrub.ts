/**
 * Scrubbing the drafted tree (D-56 ③ v2): the user reads this text in the workplan, so it must not hold file names,
 * tool names, block ids (`^m1`), `[[` links, vault folders or pack ids (`K3`). The code fixes pack ids itself, then
 * asks the model ONCE to rewrite the sentences that still contain internals, and reports what is left for the caller
 * to log. Pure except for the injected rewrite; no I/O.
 */
import { z } from 'zod';
import type { ToolContext } from '@/lib/harness/types';
import { findInternals } from '@/lib/testing/internal-names';
import { composeJson, composeModel } from './llm';
import { isBranch, type PackItem, type Tree, type TreeNode } from './types';

/** The shared list of internal names, plus made-up codes like A1 / B2 (Q, H, K, W, C and G are names the reader meets: Q2, H1, W1; K is replaced from the pack). */
const CODE_RE = /\b(?![HQKWCG])[A-Z]\d+\b/g;
/** Notes about who answers what, written for the reviewer and not for the reader: （欧洲金融归Q3，不在此重复）, （只问采购选择；…归Q5…）. */
const DIVISION_RE = /[（(][^）)]*(?:归\s*Q\d|不在此|不重复|不答|不含|只问|交给\s*Q\d)[^）)]*[）)]/g;
/** A sub-question label that does not exist for the reader (Q1a) and a made-up option code in front of a word (A买方). */
const LABEL_RE = /\bQ\d+[a-z]\b/g;
const OPTION_CODE_RE = /(?<![A-Za-z0-9])[A-E](?=[一-鿿])/g;

export function internalsOf(text: string): string[] {
  return [...new Set([...findInternals(text), ...(text.match(CODE_RE) ?? []), ...(text.match(DIVISION_RE) ?? []), ...(text.match(LABEL_RE) ?? []), ...(text.match(OPTION_CODE_RE) ?? [])])];
}

/** What the code can do alone when the model's rewrite still leaves them: cut the division notes and the made-up labels out. */
export function cleanByCode(text: string): string {
  return text
    .replace(DIVISION_RE, '')
    .replace(LABEL_RE, '这一支')
    .replace(OPTION_CODE_RE, '')
    .replace(CODE_RE, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/** Every free-text string of the tree with a stable address, in reading order. */
export interface TreeText {
  path: string;
  text: string;
}

const TOP_LEVEL = ['core_question', 'decision_options', 'day1_answer', 'split_basis', 'key_message'] as const;

export function treeTexts(tree: Tree): TreeText[] {
  const out: TreeText[] = [
    { path: 'core_question', text: tree.core_question },
    { path: 'decision_options', text: tree.decision_options },
    { path: 'day1_answer', text: tree.day1_answer },
    { path: 'split_basis', text: tree.split_basis },
    { path: 'key_message', text: tree.key_message },
    ...tree.risks.map((text, i) => ({ path: `risks.${i}`, text })),
    ...tree.next_actions.map((text, i) => ({ path: `next_actions.${i}`, text })),
  ];
  const walk = (node: TreeNode, at: string) => {
    out.push({ path: `sub.${at}.question`, text: node.question });
    if (isBranch(node)) {
      node.children.forEach((c, i) => walk(c, `${at}.${i}`));
      return;
    }
    const h = node.hypothesis;
    out.push({ path: `sub.${at}.statement`, text: h.statement });
    out.push({ path: `sub.${at}.falsifier`, text: h.falsifier });
    out.push({ path: `sub.${at}.short`, text: h.short });
    h.conditions.forEach((text, i) => out.push({ path: `sub.${at}.conditions.${i}`, text }));
    h.to_verify.forEach((v, i) => {
      out.push({ path: `sub.${at}.verify.${i}.what`, text: v.what });
      out.push({ path: `sub.${at}.verify.${i}.support`, text: v.support });
      out.push({ path: `sub.${at}.verify.${i}.counter`, text: v.counter });
    });
  };
  tree.subquestions.forEach((n, i) => walk(n, String(i)));
  return out;
}

function setText(tree: Tree, path: string, text: string): void {
  if ((TOP_LEVEL as readonly string[]).includes(path)) {
    (tree as unknown as Record<string, string>)[path] = text;
    return;
  }
  const parts = path.split('.');
  if (parts.length === 2 && (parts[0] === 'risks' || parts[0] === 'next_actions')) {
    const list = parts[0] === 'risks' ? tree.risks : tree.next_actions;
    const i = Number(parts[1]);
    if (Number.isInteger(i) && i >= 0 && i < list.length) list[i] = text;
    return;
  }
  if (parts[0] !== 'sub') return;
  const start = Number(parts[1]);
  if (!Number.isInteger(start) || start < 0 || start >= tree.subquestions.length) return;
  let node: TreeNode | undefined = tree.subquestions[start];
  let i = 2;
  while (node && i < parts.length && /^\d+$/.test(parts[i])) {
    if (!isBranch(node)) return;
    const j = Number(parts[i]);
    if (!Number.isInteger(j) || j < 0 || j >= node.children.length) return;
    node = node.children[j];
    i++;
  }
  if (!node) return;
  const field = parts.slice(i);
  if (field.length === 1 && field[0] === 'question') {
    node.question = text;
    return;
  }
  if (isBranch(node)) return;
  const h = node.hypothesis;
  if (field.length === 1) {
    if (field[0] === 'statement') h.statement = text;
    else if (field[0] === 'falsifier') h.falsifier = text;
    else if (field[0] === 'short') h.short = text;
    return;
  }
  if (field[0] === 'conditions' && field.length === 2) {
    const k = Number(field[1]);
    if (Number.isInteger(k) && k >= 0 && k < h.conditions.length) h.conditions[k] = text;
    return;
  }
  if (field[0] === 'verify' && field.length === 3) {
    const k = Number(field[1]);
    if (!Number.isInteger(k) || k < 0 || k >= h.to_verify.length) return;
    if (field[2] === 'what') h.to_verify[k].what = text;
    else if (field[2] === 'support') h.to_verify[k].support = text;
    else if (field[2] === 'counter') h.to_verify[k].counter = text;
  }
}

/** A copy of `tree` where the strings at the given addresses are replaced. Addresses that do not exist are ignored. */
export function withTexts(tree: Tree, changed: Record<string, string>): Tree {
  const copy = structuredClone(tree);
  for (const [path, text] of Object.entries(changed)) setText(copy, path, text);
  return copy;
}

/** Replace pack ids (K1, K12 ...) written in prose by the title of that pack item in 《》; an id not in the pack is left as is. */
export function replacePackIds(text: string, pack: PackItem[]): string {
  const titleById = new Map(pack.map((p) => [p.id, p.title]));
  return text.replace(/\bK\d+\b/g, (id) => {
    const title = titleById.get(id);
    return title ? `《${title}》` : id;
  });
}

export interface ScrubResult {
  tree: Tree;
  fixedByCode: number;
  rewritten: number;
  left: { path: string; hits: string[] }[];
}

export async function scrubTree(
  tree: Tree,
  pack: PackItem[],
  rewrite: (items: TreeText[]) => Promise<Record<string, string>>,
): Promise<ScrubResult> {
  // 1. What the code can fix alone: pack ids written in prose.
  const changedByCode: Record<string, string> = {};
  for (const { path, text } of treeTexts(tree)) {
    const next = replacePackIds(text, pack);
    if (next !== text) changedByCode[path] = next;
  }
  const fixed = withTexts(tree, changedByCode);
  const fixedByCode = Object.keys(changedByCode).length;

  // 2. What still contains internals goes to one model call; none = done.
  const offending = treeTexts(fixed).filter((x) => internalsOf(x.text).length > 0);
  if (offending.length === 0) return { tree: fixed, fixedByCode, rewritten: 0, left: [] };

  // 3. One rewrite, never more; a failure leaves every offending string for the caller.
  const asked = new Set(offending.map((x) => x.path));
  let answered: Record<string, unknown> = {};
  try {
    answered = await rewrite(offending.map(({ path, text }) => ({ path, text })));
  } catch {
    const byCode = withTexts(fixed, Object.fromEntries(offending.map((x) => [x.path, cleanByCode(x.text)]).filter(([, v]) => v.length > 0)));
    const stillLeft = treeTexts(byCode).filter((x) => asked.has(x.path) && internalsOf(x.text).length > 0);
    return { tree: byCode, fixedByCode, rewritten: 0, left: stillLeft.map((x) => ({ path: x.path, hits: internalsOf(x.text) })) };
  }
  const accepted: Record<string, string> = {};
  for (const [path, value] of Object.entries(answered ?? {})) {
    if (!asked.has(path)) continue;
    if (typeof value !== 'string' || value.trim() === '') continue;
    accepted[path] = value;
  }
  const applied = withTexts(fixed, accepted);

  // 4. What the rewrite left is cleaned by the code; anything that still shows an internal is reported (the caller logs it).
  const stillBad: Record<string, string> = {};
  for (const x of treeTexts(applied)) if (asked.has(x.path) && internalsOf(x.text).length > 0) stillBad[x.path] = cleanByCode(x.text);
  const cleaned = Object.keys(stillBad).length ? withTexts(applied, Object.fromEntries(Object.entries(stillBad).filter(([, v]) => v.length > 0))) : applied;
  const finalText = new Map(treeTexts(cleaned).map((x) => [x.path, x.text]));
  const left = offending.flatMap(({ path }) => {
    const hits = internalsOf(finalText.get(path) ?? '');
    return hits.length ? [{ path, hits }] : [];
  });
  return { tree: cleaned, fixedByCode, rewritten: Object.keys(accepted).length, left };
}

const SYSTEM = `你要为用户改写句子（每行是 路径｜原句｜要去掉的部分）：读者不能看到文件名、工具名、^m1 这样的块编号、[[ 链接、文件夹路径或编号，也不能看到括号里写给评审的分工说明（"归Q3""不在此重复""只问……"）和 A、B、Q1a 这类代号：括号说明直接删掉，代号换成它指的东西。把每一处都换成普通的词（笔记的话用《标题》，或者直接说它讲了什么）；意思不变，长度大致不变。只输出 JSON：{"texts":{"<path>":"<新句子>"}}，只包含给定的 path。`;

/** The real rewrite call: one composeJson call for all offending strings. */
export function modelRewrite(ctx: ToolContext): (items: TreeText[]) => Promise<Record<string, string>> {
  return async (items) => {
    const prompt = items.map((i) => `${i.path}｜${i.text}｜要去掉：${internalsOf(i.text).join('、')}`).join('\n');
    const out = await composeJson({
      model: await composeModel(ctx),
      task: 'workplan_rewrite',
      system: SYSTEM,
      prompt,
      schema: z.object({ texts: z.record(z.string(), z.string()) }),
      signal: ctx.abortSignal,
    });
    return out.texts;
  };
}
