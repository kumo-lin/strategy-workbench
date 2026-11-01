/** Scrubbing a drafted tree (D-56 ③ v2): the code fixes pack ids, one model rewrite removes the rest, what stays is reported. */
import { describe, expect, it, vi } from 'vitest';
import { replacePackIds, scrubTree, treeTexts, withTexts, type TreeText } from '@/lib/workplan/compose/scrub';
import { packItemSchema, treeSchema, type Leaf, type PackItem, type Tree } from '@/lib/workplan/compose/types';
import { sampleTree } from './fixtures';

const packOf = (...items: [string, string][]): PackItem[] =>
  items.map(([id, title]) => packItemSchema.parse({ id, kind: 'reference', title, path: `${id}.md` }));

const leafAt = (t: Tree, i: number): Leaf => t.subquestions[i] as Leaf;

describe('treeTexts', () => {
  it('addresses every free-text string in reading order and never the code-only fields', () => {
    const t = sampleTree();
    leafAt(t, 0).hypothesis.to_verify = [{ what: '查数', where: '上网', support: '支持', counter: '反证' }];
    const paths = treeTexts(t).map((x) => x.path);
    for (const p of ['core_question', 'sub.0.question', 'sub.1.0.statement', 'sub.1.1.falsifier', 'risks.0', 'next_actions.0']) {
      expect(paths).toContain(p);
    }
    expect(paths).toContain('sub.0.conditions.0');
    expect(paths).toContain('sub.0.verify.0.what');
    expect(paths).toContain('sub.0.verify.0.counter');
    expect(paths).not.toContain('sub.0.verify.0.where');
    expect(paths.some((p) => p.includes('known_by'))).toBe(false);
  });
});

describe('withTexts', () => {
  it('replaces the named addresses in a copy, leaves the original untouched, and ignores unknown addresses', () => {
    const t = sampleTree();
    const out = withTexts(t, { core_question: '新的核心问题', 'sub.99.question': '不存在' });
    expect(out).not.toBe(t);
    expect(out.core_question).toBe('新的核心问题');
    expect(t).toEqual(sampleTree());
    expect(withTexts(t, { 'no.such.path': 'x' })).toEqual(t);
  });
});

describe('replacePackIds', () => {
  it('turns pack ids written in prose into the item title, and leaves unknown ids and look-alikes alone', () => {
    const pack = packOf(['K2', '预算表'], ['K12', '路线图']);
    expect(replacePackIds('见 K2 和 K12，不是 UK2', pack)).toBe('见 《预算表》 和 《路线图》，不是 UK2');
    expect(replacePackIds('见 K3', pack)).toBe('见 K3');
    expect(replacePackIds('K2x', pack)).toBe('K2x');
  });
});

describe('scrubTree', () => {
  it('needs no rewrite on a clean tree', async () => {
    const rewrite = vi.fn(async () => ({}));
    const r = await scrubTree(sampleTree(), [], rewrite);
    expect(rewrite).not.toHaveBeenCalled();
    expect(r.fixedByCode).toBe(0);
    expect(r.rewritten).toBe(0);
    expect(r.left).toEqual([]);
  });

  it('fixes pack ids by code alone, with no model call, and the result is still a valid tree', async () => {
    const t = sampleTree();
    leafAt(t, 0).hypothesis.falsifier = '见 K3 就说明错了';
    const rewrite = vi.fn(async () => ({}));
    const r = await scrubTree(t, packOf(['K3', '季度数据']), rewrite);
    expect(r.fixedByCode).toBe(1);
    expect(rewrite).not.toHaveBeenCalled();
    expect(leafAt(r.tree, 0).hypothesis.falsifier).toBe('见 《季度数据》 就说明错了');
    expect(JSON.stringify(r.tree)).not.toContain('K3');
    expect(() => treeSchema.parse(r.tree)).not.toThrow();
  });

  it('asks the model once for exactly the strings that still contain internals, and applies its answers', async () => {
    const t = sampleTree();
    leafAt(t, 0).hypothesis.statement = '按 ^m1 这块做';
    t.risks[0] = '见 [[x]] 的说法';
    const rewrite = vi.fn(async (_items: TreeText[]) => ({ 'sub.0.statement': '按那块做', 'risks.0': '见那个说法' }));
    const r = await scrubTree(t, [], rewrite);
    expect(rewrite).toHaveBeenCalledTimes(1);
    expect(rewrite.mock.calls[0][0].map((x) => x.path).sort()).toEqual(['risks.0', 'sub.0.statement']);
    expect(r.rewritten).toBe(2);
    expect(r.left).toEqual([]);
    expect(leafAt(r.tree, 0).hypothesis.statement).toBe('按那块做');
    expect(r.tree.risks[0]).toBe('见那个说法');
    expect(() => treeSchema.parse(r.tree)).not.toThrow();
  });

  it('reports an answer that still contains an internal in left and does not ask again', async () => {
    const t = sampleTree();
    leafAt(t, 0).hypothesis.statement = '按 ^m1 这块做';
    t.risks[0] = '见 [[x]] 的说法';
    const rewrite = vi.fn(async () => ({ 'sub.0.statement': '见 a.md 那块', 'risks.0': '见那个说法' }));
    const r = await scrubTree(t, [], rewrite);
    expect(rewrite).toHaveBeenCalledTimes(1);
    expect(r.left).toEqual([{ path: 'sub.0.statement', hits: ['a.md'] }]);
  });

  it('does not throw when the rewrite throws: the code-fixed tree comes back with every string in left', async () => {
    const t = sampleTree();
    leafAt(t, 0).hypothesis.statement = '按 ^m1 这块做';
    t.risks[0] = '见 [[x]] 的说法';
    const rewrite = vi.fn(async () => {
      throw new Error('boom');
    });
    const r = await scrubTree(t, [], rewrite);
    expect(r.tree).toEqual(t);
    expect(r.rewritten).toBe(0);
    expect(r.left.map((x) => x.path).sort()).toEqual(['risks.0', 'sub.0.statement']);
    expect(r.left.find((x) => x.path === 'sub.0.statement')!.hits).toEqual(['^m1']);
  });

  it('ignores answers for paths that were not asked and blank answers for ones that were', async () => {
    const t = sampleTree();
    leafAt(t, 0).hypothesis.statement = '按 ^m1 这块做';
    const rewrite = vi.fn(async () => ({ core_question: '新的核心问题', 'sub.0.statement': '   ' }));
    const r = await scrubTree(t, [], rewrite);
    expect(r.tree).toEqual(t);
    expect(r.rewritten).toBe(0);
    expect(r.left).toEqual([{ path: 'sub.0.statement', hits: ['^m1'] }]);
  });
});

describe('notes written for the reviewer', () => {
  const dirty = () => withTexts(sampleTree(), { 'sub.0.question': '谁拍板采购？（欧洲金融归Q3，不在此重复）', risks: undefined as never, 'risks.0': '若Q1a被推翻，A买方的判断就要改', 'sub.1.0.question': '软件花在哪里？' });

  it('are cut out by the code when the model cannot rewrite them', async () => {
    const r = await scrubTree(dirty(), [], async () => { throw new Error('x'); });
    expect(treeTexts(r.tree).find((x) => x.path === 'sub.0.question')!.text).toBe('谁拍板采购？');
    expect(treeTexts(r.tree).find((x) => x.path === 'risks.0')!.text).toBe('若这一支被推翻，买方的判断就要改');
    expect(r.left).toEqual([]);
  });

  it('are asked once to the model, and what the rewrite leaves is cleaned by the code', async () => {
    let calls = 0;
    const r = await scrubTree(dirty(), [], async (items) => (calls++, Object.fromEntries(items.map((i) => [i.path, i.path === 'risks.0' ? '若这一支被推翻，A买方要改' : i.text.replace(/（[^）]*）/, '')]))));
    expect(calls).toBe(1);
    expect(treeSchema.safeParse(r.tree).success).toBe(true);
    expect(treeTexts(r.tree).find((x) => x.path === 'risks.0')!.text).toBe('若这一支被推翻，买方要改');
    expect(r.left).toEqual([]);
  });
});
