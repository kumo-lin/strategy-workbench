/** The code checks of a drafted tree: sizes, falsifiers and sources (D-56 ③ v2 §4). */
import { describe, expect, it } from 'vitest';
import { checkTree, MAX_FIRST_LEVEL, MAX_LEAVES } from '@/lib/workplan/compose/tree';
import { treeSchema, type PackItem } from '@/lib/workplan/compose/types';
import { hyp } from './fixtures';

const pack: PackItem[] = [{ id: 'K1', kind: 'reference', title: '资料', path: 'x.md', gist: '' }];
const leaf = (q: string, known: string[] = ['K1']) => ({
  question: `${q}？`,
  hypothesis: { ...hyp(`${q}的假设`), known_by: known, falsifier: '采购文件里把可管理性排在价格之后', to_verify: [{ what: '查采购标准', where: '上网', support: '写明门槛', counter: '招标书' }] },
});
/** D-64 T21: the first bottom-level sub-question is marked a key question (a tree needs 1–4). */
const markFirstKey = (subs: unknown[]): unknown[] => {
  const [first, ...rest] = subs as { children?: unknown[] }[];
  if (!first) return subs;
  return [first.children ? { ...first, children: markFirstKey(first.children) } : { ...first, knockout: true, ifBad: '改变先押哪一层' }, ...rest];
};
const tree = (subquestions: unknown[]) =>
  treeSchema.parse({ core_question: 'q', decision_options: 'd', day1_answer: 'a', split_basis: 's', subquestions: markFirstKey(subquestions), key_message: 'k', risks: ['最可能被推翻的一点是什么'], next_actions: ['n'] });
const branch = (q: string, n: number) => ({ question: `${q}？`, children: Array.from({ length: n }, (_, i) => leaf(`${q}${i}`)) });

describe('checkTree for a small question', () => {
  it('holds the tree to 3 first-level and 4 bottom-level sub-questions', () => {
    expect(checkTree(tree([leaf('a'), leaf('b'), leaf('c')]), pack, '小题').errors).toEqual([]);
    expect(checkTree(tree([leaf('a'), leaf('b'), leaf('c'), leaf('d')]), pack, '小题').errors.some((e) => e.includes('一级子问题有 4 个，最多 3 个'))).toBe(true);
    expect(checkTree(tree([branch('a', 3), branch('b', 2)]), pack, '小题').errors.some((e) => e.includes('最底层子问题有 5 个，最多 4 个'))).toBe(true);
  });
  it('the same tree is fine as a big question', () => {
    expect(checkTree(tree([branch('a', 3), branch('b', 2)]), pack, '大题').errors).toEqual([]);
  });
});

describe('checkTree sources', () => {
  it('asks for at least one known_by when the pack holds reference material, and not when it does not', () => {
    const none = tree([leaf('a', []), leaf('b', [])]);
    expect(checkTree(none, pack).errors.some((e) => e.includes('没有一个假设用上它'))).toBe(true);
    expect(checkTree(none, [{ ...pack[0], kind: 'policy' }]).errors.some((e) => e.includes('没有一个假设用上它'))).toBe(false);
    expect(checkTree(tree([leaf('a', []), leaf('b')]), pack).errors).toEqual([]);
  });
});

describe('checkTree: sources and placeholders', () => {
  it('a meeting instruction or a policy line cannot be an "already known" source', () => {
    const p: PackItem[] = [...pack, { id: 'K2', kind: 'directive', title: '周会', path: 'm.md', block: '^m1', gist: '' }];
    const errors = checkTree(tree([leaf('a', ['K1']), leaf('b', ['K2'])]), p).errors;
    expect(errors.some((e) => e.includes('K2') && e.includes('会议上的指示'))).toBe(true);
    expect(errors.some((e) => e.includes('K1'))).toBe(false);
  });
  it('a risk that is only a placeholder is sent back', () => {
    const t = treeSchema.parse({ ...tree([leaf('a'), leaf('b')]), risks: ['…。'] });
    expect(checkTree(t, pack).errors.some((e) => e.includes('空的占位'))).toBe(true);
  });
});

describe('checkTree sizes', () => {
  it('accepts a tree within the limits', () => {
    const t = tree([leaf('a'), branch('b', 2), leaf('c')]);
    expect(checkTree(t, pack).errors).toEqual([]);
  });

  it(`refuses more than ${MAX_LEAVES} bottom-level sub-questions, naming the number`, () => {
    const t = tree([branch('a', 5), branch('b', 4), branch('c', 4)]); // D-64 T21: the limit went from 8 to 12
    const errors = checkTree(t, pack).errors;
    expect(errors.some((e) => e.includes('最底层子问题有 13 个'))).toBe(true);
  });

  it(`refuses more than ${MAX_FIRST_LEVEL} first-level sub-questions`, () => {
    const t = tree(Array.from({ length: MAX_FIRST_LEVEL + 1 }, (_, i) => leaf(`q${i}`)));
    expect(checkTree(t, pack).errors.some((e) => e.includes(`一级子问题有 ${MAX_FIRST_LEVEL + 1} 个`))).toBe(true);
  });
});

describe('checkTree and the research resources', () => {
  const withMethod = (what: string) => {
    const l = leaf('a');
    l.hypothesis.to_verify = [{ what, where: '上网', support: '写明门槛', counter: '招标书' }];
    return tree([l, leaf('b')]);
  };

  it('refuses a method the team cannot run (an experiment, an A/B test, a pilot, a survey) under the default resources', () => {
    for (const what of ['对 20 家客户做报价 A/B 测试', '随机分组看接受率', '找三家客户试点', '发放问卷调查 CIO']) {
      expect(checkTree(withMethod(what), pack).errors.some((e) => e.includes('超出了研究资源')), what).toBe(true);
    }
    const t = tree([leaf('a'), leaf('b')]);
    t.next_actions = ['下周起做报价 A/B 测试'];
    expect(checkTree(t, pack).errors.some((e) => e.includes('超出了研究资源'))).toBe(true);
  });

  it('desk research passes, and an experiment passes when the resources allow one', () => {
    expect(checkTree(withMethod('读招标书的评分表'), pack).errors).toEqual([]);
    expect(checkTree(withMethod('找三家客户试点'), pack, '大题', '可以找 3 家客户做试点').errors).toEqual([]);
  });
});
