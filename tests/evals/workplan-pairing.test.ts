/** The eval's pairing by meaning: the ratio, the lowest over runs, the question lists and the line it adds. */
import { describe, expect, it } from 'vitest';
import type { Tree } from '@/lib/workplan/compose/types';
import type { Check } from '../../evals/judges';
import type { RunRecord } from '../../evals/workplan-lib';
import { renderResultsMarkdown } from '../../evals/workplan-lib';
import { EVAL_QUESTIONS } from '../../evals/workplan-questions';
import {
  firstLevelQuestions,
  leafQuestions,
  pairingRatio,
  semanticStability,
  type PairAsk,
  type StructureSnapshot,
} from '../../evals/workplan-structure';
import { sampleTree } from '../m1/compose/fixtures';

const snapshot = (tree: Tree | null = sampleTree()): StructureSnapshot => ({
  version: 1,
  frame: { question: '问题', decision: '决策', scope: '范围', success: '成功', known: '已知', bar: '门槛' },
  marks: [],
  pack: [],
  tree,
  judgment: null,
});

/** Pairs every index with the same index: the stand-in for a judge that finds every question twice. */
const sameIndex: PairAsk = async (a) => a.map((_, i) => [i, i]);

describe('pairingRatio', () => {
  it('is valid distinct pairs over the longer list', async () => {
    const ratio = await pairingRatio(['a', 'b', 'c'], ['x', 'y'], async () => [[0, 1], [2, 0]]);
    expect(ratio).toBe(2 / 3);
  });

  it('ignores out-of-range indexes and a second use of an index', async () => {
    const ratio = await pairingRatio(['a', 'b'], ['x', 'y'], async () => [[0, 0], [0, 1], [5, 0], [1, 1]]);
    expect(ratio).toBe(1);
  });

  it('is 1 without asking when either list is empty', async () => {
    let calls = 0;
    const ask: PairAsk = async () => {
      calls++;
      return [];
    };
    expect(await pairingRatio([], ['x'], ask)).toBe(1);
    expect(await pairingRatio(['a'], [], ask)).toBe(1);
    expect(calls).toBe(0);
  });
});

describe('semanticStability', () => {
  it('is 1 on both levels when every pair of runs pairs by index, and asks once per pair per level', async () => {
    let calls = 0;
    const ask: PairAsk = (a, b) => {
      calls++;
      return sameIndex(a, b);
    };
    const out = await semanticStability([snapshot(), snapshot(), snapshot()], ask);
    expect(out).toEqual({ first: 1, leaf: 1 });
    expect(calls).toBe(6);
  });

  it('takes the lowest ratio over the pairs of runs, on both levels', async () => {
    let n = 0;
    const ask: PairAsk = async (a) => {
      const pair = Math.floor(n++ / 2);
      return pair === 1 ? [] : a.map((_, i) => [i, i]);
    };
    expect(await semanticStability([snapshot(), snapshot(), snapshot()], ask)).toEqual({ first: 0, leaf: 0 });
  });

  it('leaves out a run without a tree', async () => {
    let calls = 0;
    const ask: PairAsk = (a, b) => {
      calls++;
      return sameIndex(a, b);
    };
    expect(await semanticStability([snapshot(), null, snapshot()], ask)).toEqual({ first: 1, leaf: 1 });
    expect(calls).toBe(2);
  });

  it('is 1 when fewer than two runs have a tree', async () => {
    let calls = 0;
    const ask: PairAsk = async () => {
      calls++;
      return [];
    };
    expect(await semanticStability([snapshot(), null], ask)).toEqual({ first: 1, leaf: 1 });
    expect(await semanticStability([], ask)).toEqual({ first: 1, leaf: 1 });
    expect(calls).toBe(0);
  });
});

describe('firstLevelQuestions and leafQuestions', () => {
  it('reads the top-level questions and the leaves in reading order', () => {
    expect(firstLevelQuestions(snapshot())).toEqual(['谁拍板？', '钱花在哪里？', '什么条件批？']);
    expect(leafQuestions(snapshot())).toEqual(['谁拍板？', '软件？', '硬件？', '什么条件批？']);
  });

  it('is empty without a snapshot or a tree', () => {
    expect(firstLevelQuestions(null)).toEqual([]);
    expect(leafQuestions(null)).toEqual([]);
    expect(firstLevelQuestions(snapshot(null))).toEqual([]);
    expect(leafQuestions(snapshot(null))).toEqual([]);
  });
});

describe('renderResultsMarkdown with semantic stability', () => {
  const meta = { stamp: '2026-10-27-01', model: 'deepseek-flash', vault: 'snapshot-v10', workspace: '.scratch/evals/2026-10-27-01' };
  const q1 = EVAL_QUESTIONS.find((q) => q.id === 1)!;
  const runs = [1, 2, 3].map((run) => ({
    q: q1,
    record: { questionId: 1, run, ms: 1000, rounds: [], workplan: null, structure: snapshot() } as RunRecord,
    checks: [] as Check[],
  }));
  const lineOf = (md: string) => md.split('\n').find((l) => l.startsWith('稳定性 · 题 1：'))!;

  it('appends the pairing by meaning with its thresholds', () => {
    expect(lineOf(renderResultsMarkdown(meta, runs, { 1: { first: 1, leaf: 0.5 } }))).toMatch(
      /；按意思配对：一级 100%（线 70%），最底层 50%（线 70%）$/,
    );
  });

  it('prints the line as before without an entry', () => {
    expect(lineOf(renderResultsMarkdown(meta, runs))).not.toContain('按意思配对');
  });
});
