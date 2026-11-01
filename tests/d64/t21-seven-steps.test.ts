/** D-64 T21: the code checks of the seven-step method (D63 §5). */
import { afterEach, describe, expect, it } from 'vitest';
import { checkTree, MAX_LEAVES } from '@/lib/workplan/compose/tree';
import { renderWorkplan } from '@/lib/workplan/compose/render';
import { newState, treeSchema, type PackItem } from '@/lib/workplan/compose/types';
import { composeToolGate } from '@/lib/workplan/compose/gate';
import { keyQuestionProblems } from '@/lib/research/plan-checks';
import { recommendationProblems } from '@/lib/research/recommendation-refs';
import { writeState } from '@/lib/workplan/compose/state';
import { makeM1Vault, ctxFor, WS } from '../m1/helpers';

const pack: PackItem[] = [{ id: 'K1', kind: 'reference', title: '资料', path: 'x.md', gist: '' }];
const hyp = (s: string, falsifier = '采购文件里把可管理性排在价格之后') => ({ statement: s, falsifier, conditions: ['条件一'], known_by: ['K1'], to_verify: [], short: s.slice(0, 8) });
const leaf = (q: string, ko?: string) => ({ question: q, hypothesis: hyp(`${q}的假设`), ...(ko !== undefined ? { knockout: true, ifBad: ko } : {}) });
const tree = (subquestions: unknown[]) =>
  treeSchema.parse({ core_question: 'q', decision_options: 'd', day1_answer: 'a', split_basis: 's', subquestions, key_message: 'k', risks: ['最可能被推翻的一点是什么'], next_actions: ['n'] });
const four = (n: string) => ({ question: `${n}？`, children: [leaf(`${n}1？`, '改变定位'), leaf(`${n}2？`), leaf(`${n}3？`)] });

let cleanup: () => Promise<void> = async () => {};
afterEach(async () => cleanup());

describe('T21 seven steps', () => {
  it('1. with a contract not yet confirmed by the Senior, the gate keeps compose_workplan back and says why', async () => {
    const fx = await makeM1Vault({
      '20_项目/P/决策契约.md': `---\nid: c\ntype: contract\nstatus: 推断\ncreated: "2026-10-27"\nupdated: "2026-10-27"\nauthor: AI\nderived_from: ["[[团队]]"]\nrelates_to: ["[[团队]]"]\nquestion: q\ndecision: d\ndecision_owner: o\nhorizon: h\ngeography: g\nproduct_scope: p\nout_of_scope: []\nsuccess: s\nknown: []\nbar: b\n---\n# c\n`,
    });
    cleanup = fx.cleanup;
    const ws = await fx.vault.read(`${WS}/workspace.md`);
    await fx.vault.write(`${WS}/workspace.md`, { frontmatter: { ...ws.data, stage: '拆题中' }, body: ws.body }, { overwrite: true, checkLinks: false });
    for (const f of (await fx.vault.list(WS)).filter((e) => /^workplan v\d+\.md$/.test(e.name))) await (await import('node:fs/promises')).unlink(`${fx.root}/${f.path}`);
    const state = { ...newState(), frame: { question: 'q？', decision: 'd', scope: 's', success: 's', known: 'k', bar: 'b' }, confirmed: true };
    await writeState(fx.vault, WS, state as never);
    const gate = await composeToolGate(await ctxFor(fx.vault));
    expect(gate && 'only' in gate ? gate.only : []).not.toContain('compose_workplan');
    expect(gate && 'reason' in gate ? gate.reason : '').toContain('决策契约要先由 Senior 确认');
  });

  it('2. a sub-question that does not end with ？ is an error; an empty falsifier is refused', () => {
    const t = tree([four('a'), { ...leaf('b 是话题'), knockout: false }]);
    expect(checkTree(t, pack).errors.some((e) => e.includes('不是问句'))).toBe(true);
    expect(() => tree([leaf('a？', '改变'), { question: 'b？', hypothesis: hyp('b', '') }])).toThrow();
  });

  it('3. a big question may have 12 bottom-level sub-questions, not 13', () => {
    expect(MAX_LEAVES).toBe(12);
    const ok = tree([four('a'), four('b'), four('c'), four('d')]);
    expect(checkTree(ok, pack).errors).toEqual([]);
    const tooMany = tree([four('a'), four('b'), four('c'), four('d'), leaf('e？')]);
    expect(checkTree(tooMany, pack).errors.some((e) => e.includes('最底层子问题有 13 个，最多 12 个'))).toBe(true);
  });

  it('4. 1 to 4 key questions (knockout), each saying what changes if the answer is bad', () => {
    expect(checkTree(tree([leaf('a？'), leaf('b？')]), pack, '小题').errors.some((e) => e.includes('关键问题'))).toBe(true);
    expect(checkTree(tree([leaf('a？', ''), leaf('b？')]), pack, '小题').errors.some((e) => e.includes('ifBad'))).toBe(true);
    const five = tree([four('a'), four('b'), four('c'), four('d'), leaf('e？', '改变')]);
    expect(checkTree(five, pack).errors.some((e) => e.includes('关键问题有 5 个，最多 4 个'))).toBe(true);
  });

  it('the rendered workplan lists K1 to K4 in one line, and marks each key question', () => {
    const t = tree([four('a'), four('b')]);
    const state = { ...newState(), frame: { question: 'q？', decision: 'd', scope: 's', success: 's', known: 'k', bar: 'b' } };
    const { body } = renderWorkplan({ tree: t, state, wsCode: 'M1', firstHypothesisNumber: 1 });
    expect(body).toMatch(/^关键问题：K1 a1？ · K2 b1？$/m);
    expect(body).toContain('Knock-out（P0）：结果不理想就会改变 2027 年产品战略');
  });

  it('5. the investigation plan: every key it uses has 2 to 3 hypotheses', () => {
    const claim = (id: string, key?: string) => ({ id, key, statement: id });
    expect(keyQuestionProblems([claim('C1', 'K3'), claim('C2', 'K3'), claim('C3', 'K3')])).toEqual([]);
    expect(keyQuestionProblems([claim('C1', 'K3')])[0]).toContain('K3 下只有 1 个假设');
    expect(keyQuestionProblems([claim('C1', 'K3'), claim('C2', 'K3'), claim('C3', 'K3'), claim('C4', 'K3')])[0]).toContain('K3 下有 4 个假设');
    expect(keyQuestionProblems([claim('C1')])).toEqual([]); // an older plan without keys
  });

  it('6. every recommendation cites at least one judgment of the report', () => {
    const ids = ['H1', 'H2', 'K3'];
    expect(recommendationProblems([{ title: '先验证高频场景', how: '…', refs: ['K3'] }], ids)).toEqual([]);
    expect(recommendationProblems([{ title: '先验证高频场景', how: '…', refs: [] }], ids)[0]).toContain('没有引用');
    expect(recommendationProblems([{ title: '先验证高频场景', how: '…', refs: ['H9'] }], ids)[0]).toContain('H9');
  });
});
