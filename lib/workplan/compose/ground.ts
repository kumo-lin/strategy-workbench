/**
 * Grounding check (D-56 ③ v2, round 3 of the eval): the model attaches library notes to hypotheses as "already known"
 * (`known_by`) or as "go and read this" (`to_verify.where`), and often attaches notes that only sound related (7 of 10
 * pairs in one run). Every pair is shown to a judge together with the note's own text; a note whose text does not bear
 * on the claim is taken off: a known source is dropped, a "read this note" becomes "上网". The judge call is injected.
 */
import { z } from 'zod';
import type { ToolContext } from '@/lib/harness/types';
import type { Vault } from '@/lib/vault';
import { composeJson, composeModel } from './llm';
import { leavesOf, type PackItem, type Tree } from './types';

export interface Pair {
  /** 1-based number the judge answers with. */
  n: number;
  /** Q1, Q2-1 */
  label: string;
  how: 'known' | 'verify';
  /** For `verify`: index into the leaf's `to_verify`. */
  at?: number;
  claim: string;
  source: PackItem;
  excerpt: string;
}

export interface Excerpts {
  get(item: PackItem): Promise<string>;
}

const EXCERPT_MAX = 600;
const EMPTY_BELOW = 6;

/** The note's own text for a pack item: its block when the item names one, else the start of the note. */
export function vaultExcerpts(vault: Vault): Excerpts {
  const cache = new Map<string, string>();
  return {
    async get(item) {
      const key = `${item.path}${item.block ?? ''}`;
      const hit = cache.get(key);
      if (hit !== undefined) return hit;
      let text = '';
      try {
        const block = item.block ? (await vault.getBlocks(item.path)).get(item.block.replace(/^\^/, '')) : undefined;
        text = block?.text ?? (await vault.read(item.path)).body;
      } catch {
        text = item.gist;
      }
      const clipped = text.replace(/\s+/g, ' ').trim().slice(0, EXCERPT_MAX);
      cache.set(key, clipped);
      return clipped;
    },
  };
}

/** Every reference attachment of the tree, numbered. Directives, decisions and policies are boundaries, not evidence: they are not checked. */
export async function collectPairs(tree: Tree, pack: PackItem[], excerpts: Excerpts): Promise<Pair[]> {
  const byId = new Map(pack.map((i) => [i.id, i]));
  const pairs: Pair[] = [];
  for (const { label, node } of leavesOf(tree)) {
    const h = node.hypothesis;
    for (const id of h.known_by) {
      const source = byId.get(id);
      if (source?.kind === 'reference') pairs.push({ n: pairs.length + 1, label, how: 'known', claim: h.statement, source, excerpt: await excerpts.get(source) });
    }
    for (const [at, v] of h.to_verify.entries()) {
      const source = byId.get(v.where);
      if (source?.kind === 'reference') pairs.push({ n: pairs.length + 1, label, how: 'verify', at, claim: v.what, source, excerpt: await excerpts.get(source) });
    }
  }
  return pairs;
}

/** The tree without the attachments the judge did not keep. A leaf left with no source at all gets a "go and look it up" entry for its own claim. */
export function applyGrounding(tree: Tree, pairs: Pair[], keep: ReadonlySet<number>): { tree: Tree; dropped: Pair[] } {
  const dropped = pairs.filter((p) => !keep.has(p.n));
  if (dropped.length === 0) return { tree, dropped };
  const copy = structuredClone(tree);
  const leaves = new Map(leavesOf(copy).map((l) => [l.label, l.node]));
  for (const p of dropped) {
    const leaf = leaves.get(p.label);
    if (!leaf) continue;
    const h = leaf.hypothesis;
    if (p.how === 'known') {
      // not thrown away: the note stays on the page as something to check, marked as not verified
      h.known_by = h.known_by.filter((id) => id !== p.source.id);
      if (!h.to_verify.some((v) => v.where === p.source.id)) {
        h.to_verify.push({ what: `核实《${p.source.title}》是否说明这一点`, where: p.source.id, support: '相关资料（没核实）：原文直接讲到同一个对象、同一件事', counter: h.falsifier });
      }
    } else if (p.at !== undefined && h.to_verify[p.at]) h.to_verify[p.at].where = '上网';
  }
  for (const leaf of leaves.values()) {
    const h = leaf.hypothesis;
    if (h.known_by.length === 0 && h.to_verify.length === 0) h.to_verify.push({ what: h.statement, where: '上网', support: '找到能直接证明它的资料', counter: h.falsifier });
  }
  return { tree: copy, dropped };
}

export type Judge = (pairs: Pair[]) => Promise<number[]>;

/** Check the tree's attachments with `judge` (the numbers it keeps). A judge that fails changes nothing. */
export async function groundTree(tree: Tree, pack: PackItem[], excerpts: Excerpts, judge: Judge): Promise<{ tree: Tree; dropped: Pair[] }> {
  const pairs = await collectPairs(tree, pack, excerpts);
  if (pairs.length === 0) return { tree, dropped: [] };
  // a note with no text of its own cannot support anything: it is not even put to the judge
  const hollow = new Set(pairs.filter((p) => p.excerpt.replace(/\s/g, '').length < EMPTY_BELOW).map((p) => p.n));
  const asked = pairs.filter((p) => !hollow.has(p.n));
  let kept: number[] = [];
  if (asked.length > 0) {
    try {
      kept = await judge(asked);
    } catch {
      return { tree: hollow.size ? applyGrounding(tree, pairs, new Set(pairs.filter((p) => !hollow.has(p.n)).map((p) => p.n))).tree : tree, dropped: pairs.filter((p) => hollow.has(p.n)) };
    }
  }
  return applyGrounding(tree, pairs, new Set(kept));
}

const SYSTEM = [
  '你是核对员。下面每一条是：一个说法，和一篇资料里的一段原文。判断这段原文是不是和这个说法直接相关的事实或数据：能用来支持它、反驳它，或者是检验它时必须看的材料。',
  '不要求原文证明说法里的具体数字或阈值，只要原文讲的就是这件事（同一个对象、同一个问题）就算相关。',
  '说的是另一个国家、另一个对象的价格或法规（比如美国的价格用来支持中国员工的价格上限）不算；意思相反的不算（原文说的和说法的方向相反，但说法是在被检验的，反面材料要的是"检验它"才算）；一个人在会议上说的话不是事实依据。',
  '这几种不算：只是话题相近、同一个行业、出现了同样的词，但讲的是另一件事（比如说法讲"算力是否单列报价"，原文讲"保修条款"或"远程唤醒"）。',
  '只输出 JSON：{"keep":[相关的那几条的序号]}',
].join('\n');

export function modelJudge(ctx: ToolContext): Judge {
  return async (pairs) => {
    const prompt = pairs
      .map((p) => `[${p.n}] 说法：${p.claim}\n    资料《${p.source.title}》${p.source.block ? ` ${p.source.block}` : ''}原文：${p.excerpt}`)
      .join('\n\n');
    const out = await composeJson({
      model: await composeModel(ctx),
      task: 'workplan_ground',
      system: SYSTEM,
      prompt,
      schema: z.object({ keep: z.array(z.number().int()).default([]) }),
      signal: ctx.abortSignal,
      timeoutMs: 120_000,
    });
    return out.keep;
  };
}
