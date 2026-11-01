/**
 * The structure half of the workplan eval (m1_6a): reads what the new co-creation pipeline wrote (the frame, the pack
 * and its marks, the tree, the evaluation), turns it into rule checks, a markdown block, a stability line and a
 * per-run JSON file for a human judge. Everything except `readStructure` and `modelPairAsk` is pure; only
 * `modelPairAsk` calls a model.
 */
import type { LanguageModel } from 'ai';
import { z } from 'zod';
import { llmJson } from '@/lib/research/llm';
import type { Vault } from '@/lib/vault';
import { readState, readTreeSidecar } from '@/lib/workplan/compose/state';
import { overlap } from '@/lib/workplan/compose/tree';
import {
  SLOT_KEYS,
  SLOT_LABELS,
  labelsOf,
  leavesOf,
  type DirectiveMark,
  type Frame,
  type Tree,
} from '@/lib/workplan/compose/types';
import { latestWorkplan } from '@/lib/workplan/state';
import type { Check } from './judges';
import type { EvalQuestion } from './workplan-questions';
import type { RunRecord } from './workplan-lib';

export interface StructureSnapshot {
  /** Workplan version the tree belongs to (null = no tree was written). */
  version: number | null;
  /** From the state file. */
  frame: Frame;
  /** State.marks. */
  marks: DirectiveMark[];
  pack: { id: string; kind: string; title: string; block?: string; status?: string }[];
  /** From the sidecar of the latest version (or state.tree if no sidecar). */
  tree: Tree | null;
  /** The evaluation of the holistic judgment: how many problems it found, and the findings the revision left open. */
  judgment: { issues: number; open: string[] } | null;
}

export interface Stability {
  pairing: number;
  sameBehaviour: boolean;
}

const rule = (name: string, pass: boolean, detail: string): Check => ({ name, kind: 'rule', pass, detail });

const MARKED_KINDS = ['directive', 'decision', 'policy'];

// ── what the pipeline left in the Workspace ────────────────────────────────────────────────────────

export async function readStructure(vault: Vault, workspacePath: string): Promise<StructureSnapshot | null> {
  const state = await readState(vault, workspacePath);
  const wp = await latestWorkplan(vault, workspacePath);
  const sidecar = wp ? await readTreeSidecar(vault, workspacePath, wp.version) : null;
  const tree = sidecar?.tree ?? state.tree ?? null;

  const hasFrame = SLOT_KEYS.some((k) => state.frame[k].trim() !== '');
  if (!hasFrame && state.pack.length === 0 && state.marks.length === 0 && !tree) return null;

  return {
    version: tree ? (wp?.version ?? null) : null,
    frame: state.frame,
    marks: state.marks,
    pack: state.pack.map((i) => ({
      id: i.id,
      kind: i.kind,
      title: i.title,
      ...(i.block ? { block: i.block } : {}),
      ...(i.status ? { status: i.status } : {}),
    })),
    tree,
    judgment: state.judgment ? { issues: state.judgment.evaluation.filter((a) => a.verdict === '有问题').length, open: state.judgment.open } : null,
  };
}

// ── rule checks over one snapshot ─────────────────────────────────────────────────────────────────

export function structureChecks(s: StructureSnapshot | null | undefined, q: EvalQuestion): Check[] {
  if (!s) return [];
  const checks: Check[] = [];

  const empty = SLOT_KEYS.filter((k) => s.frame[k].trim() === '');
  checks.push(rule('6 个槽都填满了', empty.length === 0, empty.length ? empty.map((k) => SLOT_LABELS[k]).join('、') : '全部填了'));

  const marked = new Set(s.marks.map((m) => m.ref));
  const unmarked = s.pack.filter((i) => MARKED_KINDS.includes(i.kind) && !marked.has(i.id)).map((i) => i.id);
  checks.push(rule('每条指示、决定、方针都标了', unmarked.length === 0, unmarked.length ? unmarked.join('、') : '都标了'));

  const unresolved = s.marks.filter((m) => m.verdict === '冲突' && !m.resolution).map((m) => m.ref);
  checks.push(rule('冲突都有处理结果', unresolved.length === 0, unresolved.length ? unresolved.join('、') : '都有'));

  if (s.tree) {
    const leaves = leavesOf(s.tree);

    const noFalsifier = leaves.filter((l) => l.node.hypothesis.falsifier.trim() === '').map((l) => l.label);
    checks.push(rule('子问题都挂了证伪条件', noFalsifier.length === 0, noFalsifier.length ? noFalsifier.join('、') : '都挂了'));

    const packIds = new Set(s.pack.map((i) => i.id));
    const badIds: string[] = [];
    let withKnown = 0;
    for (const { node } of leaves) {
      const h = node.hypothesis;
      if (h.known_by.length) withKnown++;
      for (const id of h.known_by) if (!packIds.has(id)) badIds.push(id);
      for (const v of h.to_verify) if (v.where !== '上网' && !packIds.has(v.where)) badIds.push(v.where);
    }
    const uniqueBad = [...new Set(badIds)];
    checks.push(
      rule(
        '扎根：至少一个 known_by',
        withKnown > 0 && uniqueBad.length === 0,
        uniqueBad.length ? `资料包里没有：${uniqueBad.join('、')}` : `${withKnown} 个子问题有 known_by`,
      ),
    );
  }

  if (q.id === 4) {
    const byId = new Map(s.pack.map((i) => [i.id, i]));
    const conflicts = s.marks.filter((m) => m.verdict === '冲突');
    const policy = conflicts.some((m) => /^\^p6/.test(byId.get(m.ref)?.block ?? ''));
    const directive = conflicts.some((m) => byId.get(m.ref)?.kind === 'directive' && /^\^m1/.test(byId.get(m.ref)?.block ?? ''));
    const missing = [!directive ? '高层指示（^m1）' : '', !policy ? '业务方针（^p6）' : ''].filter(Boolean);
    checks.push(rule('冲突标对了', directive && policy, missing.length ? `缺少：${missing.join('、')}` : '两处都标了'));
  }

  if (q.extra.includes('knownNotToVerify') && s.tree) {
    const leaves = leavesOf(s.tree);
    const copilot = new Set(s.pack.filter((i) => i.title.includes('卸载Copilot')).map((i) => i.id));
    if (copilot.size === 0) {
      checks.push(rule('已知的事实没有写成要去查', false, '资料包里没有找到 IT可卸载Copilot 那篇'));
    } else {
      const known = leaves.some((l) => l.node.hypothesis.known_by.some((id) => copilot.has(id)));
      const recheck = leaves.some((l) => l.node.hypothesis.to_verify.some((v) => v.what.includes('卸') && v.what.includes('Copilot')));
      const bad = [!known ? '没有写在"已经知道的"' : '', recheck ? '写成了要去查' : ''].filter(Boolean);
      checks.push(rule('已知的事实没有写成要去查', known && !recheck, bad.length ? bad.join('、') : '写在"已经知道的"，没有写成要去查'));
    }
    checks.push(rule('树不超过 4 个子问题', leaves.length <= 4, `${leaves.length} 个`));
  }

  return checks;
}

// ── the snapshot a human reads ───────────────────────────────────────────────────────────────────

export function structureMarkdown(s: StructureSnapshot | null): string {
  if (!s) return '（没有结构化结果）';
  const titles = new Map(s.pack.map((i) => [i.id, i.title]));
  const titleOf = (id: string) => titles.get(id) ?? id;

  const lines: string[] = ['槽：'];
  for (const k of SLOT_KEYS) lines.push(`${SLOT_LABELS[k]}：${s.frame[k] || '（空）'}`);

  lines.push('标记：');
  if (!s.marks.length) lines.push('（没有）');
  for (const m of s.marks) {
    const p = s.pack.find((i) => i.id === m.ref);
    const block = p?.block ? ` ${p.block}` : '';
    lines.push(`${m.ref}《${p?.title ?? m.ref}》${block}：${m.verdict}${m.resolution ? `（${m.resolution}）` : ''}—${m.note}`);
  }

  if (s.tree) {
    for (const { label, node } of labelsOf(s.tree)) {
      lines.push(`${label} ${node.question}`);
      if ('children' in node) continue;
      const h = node.hypothesis;
      const known = h.known_by.map(titleOf).join('、') || '—';
      const verify = h.to_verify.map((v) => `${v.what} → ${v.where === '上网' ? '上网' : titleOf(v.where)}`).join('、') || '—';
      lines.push(`  假设：${h.statement}｜证伪：${h.falsifier}｜已知：${known}｜要证实：${verify}`);
    }
  }

  if (s.judgment) lines.push(`评估：${s.judgment.issues} 处问题，没解决 ${s.judgment.open.length} 条`);

  return lines.join('\n');
}

// ── how stable the runs of one question are ──────────────────────────────────────────────────────

/** Fraction of the longer tree's leaf questions that have a distinct counterpart in the shorter, greedily by overlap. */
function pairRatio(a: Tree, b: Tree): number {
  const qa = leavesOf(a).map((x) => x.node.question);
  const qb = leavesOf(b).map((x) => x.node.question);
  if (qa.length === 0 || qb.length === 0) return 1;
  const [short, long] = qa.length <= qb.length ? [qa, qb] : [qb, qa];
  const pairs: { i: number; j: number; o: number }[] = [];
  short.forEach((s, i) => long.forEach((t, j) => {
    const o = overlap(s, t);
    if (o >= 0.3) pairs.push({ i, j, o });
  }));
  pairs.sort((x, y) => y.o - x.o);
  const usedShort = new Set<number>();
  const usedLong = new Set<number>();
  let matched = 0;
  for (const p of pairs) {
    if (usedShort.has(p.i) || usedLong.has(p.j)) continue;
    usedShort.add(p.i);
    usedLong.add(p.j);
    matched++;
  }
  return matched / long.length;
}

export function stabilityOf(
  structures: (StructureSnapshot | null)[],
  behaviours: { askedFirst: boolean; doubt: boolean }[],
): Stability {
  const trees = structures.filter((s): s is StructureSnapshot & { tree: Tree } => Boolean(s?.tree)).map((s) => s.tree);
  let pairing = 1;
  for (let i = 0; i < trees.length; i++) for (let j = i + 1; j < trees.length; j++) pairing = Math.min(pairing, pairRatio(trees[i], trees[j]));

  const first = behaviours[0];
  const sameBehaviour = behaviours.every((b) => b.askedFirst === first?.askedFirst && b.doubt === first?.doubt);

  return { pairing, sameBehaviour };
}

export function stabilityLine(s: Stability): string {
  return `子问题对得上 ${Math.round(s.pairing * 100)}%（线 70%）；追问/疑点行为 ${s.sameBehaviour ? '一致' : '不一致'}`;
}

// ── the same questions, paired by meaning instead of shared characters ───────────────────────────

/** The questions of a snapshot's tree: first level (every top-level node) and bottom level (every leaf), in reading order. [] when there is no tree. */
export function firstLevelQuestions(s: StructureSnapshot | null): string[] {
  return s?.tree ? s.tree.subquestions.map((n) => n.question) : [];
}

export function leafQuestions(s: StructureSnapshot | null): string[] {
  return s?.tree ? leavesOf(s.tree).map((x) => x.node.question) : [];
}

/** Pairs of indexes [i, j] (i into a, j into b) that ask the same thing. */
export type PairAsk = (a: string[], b: string[]) => Promise<[number, number][]>;

/** Share of the longer list that has a counterpart in the other: valid distinct pairs / max(a.length, b.length). Indexes out of range and indexes used twice are ignored (the first use wins). 1 when either list is empty (nothing to compare). */
export async function pairingRatio(a: string[], b: string[], ask: PairAsk): Promise<number> {
  if (a.length === 0 || b.length === 0) return 1;
  const usedA = new Set<number>();
  const usedB = new Set<number>();
  let matched = 0;
  for (const [i, j] of await ask(a, b)) {
    if (i < 0 || i >= a.length || j < 0 || j >= b.length || usedA.has(i) || usedB.has(j)) continue;
    usedA.add(i);
    usedB.add(j);
    matched++;
  }
  return matched / Math.max(a.length, b.length);
}

export interface SemanticStability {
  first: number;
  leaf: number;
}

/** The LOWEST ratio over all pairs of runs, for each level. Runs without a tree are left out; fewer than two runs with a tree → { first: 1, leaf: 1 }. */
export async function semanticStability(structures: (StructureSnapshot | null)[], ask: PairAsk): Promise<SemanticStability> {
  const trees = structures.filter((s) => s?.tree);
  if (trees.length < 2) return { first: 1, leaf: 1 };
  let first = 1;
  let leaf = 1;
  for (let i = 0; i < trees.length; i++) {
    for (let j = i + 1; j < trees.length; j++) {
      first = Math.min(first, await pairingRatio(firstLevelQuestions(trees[i]), firstLevelQuestions(trees[j]), ask));
      leaf = Math.min(leaf, await pairingRatio(leafQuestions(trees[i]), leafQuestions(trees[j]), ask));
    }
  }
  return { first, leaf };
}

/** The real judge: one llmJson call per pair of lists. */
export function modelPairAsk(model: LanguageModel): PairAsk {
  const listing = (xs: string[]) => xs.map((x, i) => `${i}. ${x}`).join('\n');
  return async (a, b) => {
    const verdict = await llmJson({
      model,
      task: 'eval-judge:pairing',
      system:
        '你是评测的判定员。下面是同一个题目两次拆出来的子问题清单 A 和 B。把"问的是同一件事"的配成对（措辞不同没关系，问的对象和要判断的东西一样就算同一件事）；一个子问题最多配一次。只输出 JSON：{"pairs":[[A 的序号, B 的序号], ...]}，序号从 0 开始。',
      prompt: `A:\n${listing(a)}\n\nB:\n${listing(b)}`,
      schema: z.object({ pairs: z.array(z.tuple([z.number().int(), z.number().int()])) }),
      // the judge weighs every pair of questions while it thinks: the default limit was hit on two lists of 10 and 8
      maxOutputTokens: 40_000,
    });
    return verdict.pairs;
  };
}

// ── one run's JSON for a human judge ─────────────────────────────────────────────────────────────

export function structureJson(record: RunRecord, q: EvalQuestion, checks: Check[]): unknown {
  return {
    question: { id: q.id, title: q.title, text: q.text },
    run: record.run,
    ms: record.ms,
    conversation: record.rounds,
    structure: record.structure,
    workplan: record.workplan ? { version: record.workplan.version, body: record.workplan.body } : null,
    checks: checks.map(({ name, pass, detail }) => ({ name, pass, detail })),
  };
}
