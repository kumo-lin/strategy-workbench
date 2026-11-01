/** Grounding: sources the judge does not keep come off the tree (D-56 ③ v2, round 3 of the eval). */
import { describe, expect, it } from 'vitest';
import { applyGrounding, collectPairs, groundTree, type Excerpts } from '@/lib/workplan/compose/ground';
import { leavesOf, treeSchema, type PackItem } from '@/lib/workplan/compose/types';
import { hyp } from './fixtures';

const item = (id: string, kind: PackItem['kind'] = 'reference'): PackItem => ({ id, kind, title: `资料${id}`, path: `x/${id}.md`, gist: `摘要${id}` });
const pack = [item('K1'), item('K2'), item('K3'), item('K4', 'policy')];
const excerpts: Excerpts = { get: async (i) => `这是资料${i.id}的原文` };

const leaf = (q: string, known: string[], verify: { where: string }[]) => ({
  question: `${q}？`,
  hypothesis: { ...hyp(`${q}的假设`), known_by: known, to_verify: verify.map((v) => ({ what: `查${q}`, where: v.where, support: 's', counter: 'c' })) },
});
const tree = () =>
  treeSchema.parse({
    core_question: 'q', decision_options: 'd', day1_answer: 'a', split_basis: 's',
    subquestions: [leaf('甲', ['K1', 'K4'], [{ where: 'K2' }]), leaf('乙', [], [{ where: 'K3' }, { where: '上网' }])],
    key_message: 'k', risks: ['r'], next_actions: ['n'],
  });

describe('collectPairs', () => {
  it('numbers every reference attachment in reading order and leaves policies and the web alone', async () => {
    const pairs = await collectPairs(tree(), pack, excerpts);
    expect(pairs.map((p) => [p.n, p.label, p.how, p.source.id])).toEqual([
      [1, 'Q1', 'known', 'K1'],
      [2, 'Q1', 'verify', 'K2'],
      [3, 'Q2', 'verify', 'K3'],
    ]);
    expect(pairs[0].excerpt).toBe('这是资料K1的原文');
  });
});

describe('groundTree', () => {
  it('drops a known source the judge did not keep and turns a refused "read this note" into 上网', async () => {
    const r = await groundTree(tree(), pack, excerpts, async () => [2]);
    const leaves = leavesOf(r.tree);
    expect(leaves[0].node.hypothesis.known_by).toEqual(['K4']); // K1 off the known list; the policy was never checked
    expect(leaves[0].node.hypothesis.to_verify.map((v) => v.where)).toEqual(['K2', 'K1']); // ... and onto the to-check list, marked as not verified
    expect(leaves[0].node.hypothesis.to_verify[1].support).toContain('没核实')
    expect(leaves[0].node.hypothesis.to_verify[0].where).toBe('K2'); // kept
    expect(leaves[1].node.hypothesis.to_verify.map((v) => v.where)).toEqual(['上网', '上网']); // K3 refused
    expect(r.dropped.map((p) => p.source.id)).toEqual(['K1', 'K3']);
  });

  it('leaves the original tree alone (a copy is changed)', async () => {
    const t = tree();
    await groundTree(t, pack, excerpts, async () => []);
    expect(t).toEqual(tree());
  });

  it('a leaf left with no source at all gets a "look it up" entry of its own', () => {
    const t = treeSchema.parse({
      core_question: 'q', decision_options: 'd', day1_answer: 'a', split_basis: 's',
      subquestions: [leaf('甲', ['K1'], []), leaf('乙', ['K2'], [])],
      key_message: 'k', risks: ['r'], next_actions: ['n'],
    });
    return collectPairs(t, pack, excerpts).then((pairs) => {
      const r = applyGrounding(t, pairs, new Set());
      for (const l of leavesOf(r.tree)) {
        expect(l.node.hypothesis.known_by).toEqual([]);
        expect(l.node.hypothesis.to_verify).toHaveLength(1); // the refused note itself, marked as not verified
        expect(l.node.hypothesis.to_verify[0].support).toContain('没核实');
      }
    });
  });

  it('a judge that fails changes nothing, and a tree with nothing to check never calls the judge', async () => {
    const t = tree();
    expect((await groundTree(t, pack, excerpts, async () => { throw new Error('x'); })).tree).toBe(t);
    const bare = treeSchema.parse({
      core_question: 'q', decision_options: 'd', day1_answer: 'a', split_basis: 's',
      subquestions: [leaf('甲', [], [{ where: '上网' }]), leaf('乙', [], [{ where: '上网' }])],
      key_message: 'k', risks: ['r'], next_actions: ['n'],
    });
    let called = 0;
    await groundTree(bare, pack, excerpts, async () => (called++, []));
    expect(called).toBe(0);
  });
});

describe('a note with no text of its own', () => {
  it('is never put to the judge and cannot stay among the known sources', async () => {
    const seen: number[][] = [];
    const empty: Excerpts = { get: async (i) => (i.id === 'K1' ? ' ' : '足够长的原文内容，讲的是同一件事的事实和数据。') };
    const r = await groundTree(tree(), pack, empty, async (pairs) => (seen.push(pairs.map((p) => p.n)), pairs.map((p) => p.n)));
    expect(seen).toEqual([[2, 3]]);
    expect(leavesOf(r.tree)[0].node.hypothesis.known_by).toEqual(['K4']);
    expect(r.dropped.map((p) => p.source.id)).toEqual(['K1']);
  });
});
