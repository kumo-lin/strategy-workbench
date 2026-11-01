/**
 * D-39 P0: the question tree of a plan (CONTRACT-CHANGE-M3-1). Fixture: tests/fixtures/d39/计划 v3.md, C's WS-A sample
 * (D-39_计划样稿_WS-A问题树.md) written as a plan note: Q1 / Q2 (→ Q2-1, Q2-2) / Q3 (→ Q3-1, Q3-2, Q3-3).
 */
import { readFileSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { researchPlanSchema, type ResearchPlanNote } from '@/lib/notes/schema';
import { selectScope } from '@/lib/research/execute';
import { checkPlanDraft, planApprovalProblems } from '@/lib/research/plan-checks';
import { savePlanVersion } from '@/lib/research/plan-save';
import { toEditable } from '@/lib/research/plan-types';
import { cleanConditions, conditionText, hypothesisLabel, isQuestion, questionTreeOf, subQuestionLabel, treeChecks, treeOrder, withConditionText } from '@/lib/research/question-tree';
import { createVault } from '@/lib/vault';
import { parseMarkdown } from '@/lib/vault/frontmatter';
import { ROLES } from '../helpers/fixture-vault';
import { RDIR, setup, WS } from './research-fixture';

const RAW = readFileSync('tests/fixtures/d39/计划 v3.md', 'utf8');
const plan = (): ResearchPlanNote => researchPlanSchema.parse(parseMarkdown(RAW).data);
const withClaims = (p: ResearchPlanNote, f: (cs: ResearchPlanNote['claims']) => ResearchPlanNote['claims']): ResearchPlanNote => ({ ...p, claims: f(p.claims.map((c) => ({ ...c }))) });
const codes = (p: ResearchPlanNote) => treeChecks(p).map((t) => t.code);

let cleanup: (() => Promise<void>) | undefined;
afterEach(async () => {
  await cleanup?.();
  cleanup = undefined;
});

describe('the schema keeps the new fields (only added, nothing changed)', () => {
  it('the WS-A sample parses: question / parent on the claims, conditions as text or {text, evidence_needed, where}, question_tree, mece_check', () => {
    const p = plan();
    expect(p.claims[1]).toMatchObject({ id: 'C2', parent: 'Q2', question: '"IT 管得住"是不满足就出局的准入要求，还是加分项？' });
    expect(p.claims[0].conditions[0]).toMatchObject({ text: expect.stringContaining('统一终端管理'), evidence_needed: expect.any(String), where: expect.any(String) });
    expect(p.claims[2].conditions[0]).toBe('过了合规和技术评审之后，比的是价格、换机节奏、合同打包');
    expect(p.question_tree?.map((n) => n.id)).toEqual(['Q2', 'Q3']);
    expect(p.mece_check).toContain('必要：');
  });

  it('an older plan without any of them still parses as it did', () => {
    const old = { ...parseMarkdown(RAW).data } as Record<string, unknown>;
    delete old.question_tree;
    delete old.mece_check;
    old.claims = (old.claims as Record<string, unknown>[]).map(({ question: _q, parent: _p, ...c }) => ({ ...c, conditions: (c.conditions as unknown[]).map((x) => (typeof x === 'string' ? x : (x as { text: string }).text)) }));
    expect(researchPlanSchema.safeParse(old).success).toBe(true);
  });

  it('conditionText reads either form; withConditionText keeps evidence / where; cleanConditions trims and drops empty ones', () => {
    const [obj] = plan().claims[0].conditions;
    expect(conditionText('一句话')).toBe('一句话');
    expect(conditionText(obj)).toContain('统一终端管理');
    expect(withConditionText(obj, '新的话')).toMatchObject({ text: '新的话', evidence_needed: expect.any(String), where: expect.any(String) });
    expect(cleanConditions(['  a ', '', { text: ' b ', where: 'w' }, { text: ' ' }])).toEqual(['a', { text: 'b', where: 'w' }]);
  });
});

describe('the tree and its labels', () => {
  it('numbered by the order of the claims: Q1 / Q2 → Q2-1, Q2-2 / Q3 → Q3-1…; H2-1 for the hypothesis of Q2-1', () => {
    const tree = questionTreeOf(plan());
    if (tree.format !== 'question_tree') throw new Error('not a tree');
    expect(tree.roots.map((r) => [r.qid, r.leaf?.label ?? r.children.map((c) => c.label)])).toEqual([
      ['Q1', 'H1'],
      ['Q2', ['H2-1', 'H2-2']],
      ['Q3', ['H3-1', 'H3-2', 'H3-3']],
    ]);
    expect(tree.roots[1].question).toBe('买方按什么标准放行，又按什么标准选？');
    expect(tree.byClaim.get('C5')).toMatchObject({ qid: 'Q3-2', label: 'H3-2', parent: 'Q3', question: '硬件预算里，企业会不会为端侧 AI 多付钱？' });
    expect(hypothesisLabel(plan(), 'C3')).toBe('H2-2');
    expect(subQuestionLabel(plan(), 'C1', 'C1-Q2')).toBe('Q1.2');
    expect(subQuestionLabel(plan(), 'C2', 'C2-Q1')).toBe('Q2-1.1');
  });

  it('an older plan is "legacy": H1, H2… by claim order, the stored 子问题 ids, no tree checks', () => {
    const old = withClaims(plan(), (cs) => cs.map(({ question: _q, parent: _p, ...c }) => c));
    expect(questionTreeOf(old)).toEqual({ format: 'legacy' });
    expect(hypothesisLabel(old, 'C3')).toBe('H3');
    expect(subQuestionLabel(old, 'C2', 'C2-Q1')).toBe('C2-Q1');
    expect(treeChecks(old)).toEqual([]);
    expect(treeOrder(old)).toEqual(['C1', 'C2', 'C3', 'C4', 'C5', 'C6']);
  });
});

describe('treeChecks: the deterministic checks of D-39', () => {
  it('the WS-A sample passes', () => {
    expect(treeChecks(plan())).toEqual([]);
  });

  it('a split with one part, an unknown parent, an unused node', () => {
    const one = withClaims(plan(), (cs) => cs.filter((c) => c.id !== 'C3'));
    expect(codes(one)).toEqual(['single_child']);
    // (Q2 is then left with one part, and Q3 moves down a place: those are reported too)
    expect(codes(withClaims(plan(), (cs) => cs.map((c) => (c.id === 'C3' ? { ...c, parent: 'Q9' } : c))))).toEqual(['unknown_parent', 'single_child', 'tree_order']);
    const unused = { ...plan(), question_tree: [...plan().question_tree!, { id: 'Q4', question: '还有什么要问？' }] };
    expect(codes(unused)).toEqual(['unused_node']);
  });

  it('a question_tree id out of its reading order', () => {
    const swapped = withClaims(plan(), (cs) => [cs[0], ...cs.slice(3), cs[1], cs[2]]); // Q3's claims now come before Q2's
    expect(treeChecks(swapped).filter((t) => t.code === 'tree_order').map((t) => t.message)).toEqual([expect.stringContaining('Q3 按假设的顺序排在第 2 个'), expect.stringContaining('Q2 按假设的顺序排在第 3 个')]);
  });

  it('a hypothesis with no sub-question, a sub-question that is not a question, no verification plan, no MECE check', () => {
    expect(codes(withClaims(plan(), (cs) => cs.map((c) => (c.id === 'C4' ? { ...c, question: undefined } : c))))).toEqual(['not_tree']);
    expect(codes(withClaims(plan(), (cs) => cs.map((c) => (c.id === 'C1' ? { ...c, question: '采购决策权' } : c))))).toEqual(['not_question']);
    expect(codes(withClaims(plan(), (cs) => cs.map((c) => (c.id === 'C6' ? { ...c, conditions: [], counter_search: ' ' } : c))))).toEqual(['no_conditions', 'no_counter_search']);
    expect(codes({ ...plan(), mece_check: '' })).toEqual(['no_mece_check']);
  });

  it('isQuestion: a question mark or a question word', () => {
    expect(isQuestion('谁决定买，谁出钱？')).toBe(true);
    expect(isQuestion('企业会不会为端侧 AI 多付钱')).toBe(false);
    expect(isQuestion('企业是否为端侧 AI 多付钱')).toBe(true);
  });
});

describe('where the checks apply', () => {
  it('the plan the model writes is sent back with the tree problems', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'sw-tree-'));
    cleanup = () => rm(root, { recursive: true, force: true });
    const vault = createVault(root);
    await expect(checkPlanDraft('# 计划\n', { vault }, plan() as unknown as Record<string, unknown>)).resolves.toBeUndefined();
    await expect(checkPlanDraft('# 计划\n', { vault }, { ...plan(), mece_check: '' } as unknown as Record<string, unknown>)).rejects.toThrow(/问题树有 1 处没通过检查[\s\S]*mece_check/);
  });

  it('approval: a failing tree is listed, a passing or older plan has nothing', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'sw-tree-'));
    cleanup = () => rm(root, { recursive: true, force: true });
    await mkdir(path.join(root, 'p'), { recursive: true });
    await writeFile(path.join(root, 'p/计划 v3.md'), RAW);
    await writeFile(path.join(root, 'p/计划 v4.md'), RAW.replace(/^mece_check: \|-\n(?: {2}.*\n)+/m, ''));
    const vault = createVault(root);
    expect(await planApprovalProblems(vault, 'p/计划 v3.md')).toEqual([]);
    expect(await planApprovalProblems(vault, 'p/计划 v4.md')).toEqual([expect.stringContaining('没有写 mece_check')]);
  });

  it('a small run takes the first hypothesis in the tree\'s order, not the claims array\'s', () => {
    const p = withClaims(plan(), (cs) => cs);
    const order = treeOrder(p);
    const reordered = [...p.claims].reverse(); // the array order is not the reading order any more
    const { selected, notExecuted } = selectScope(reordered, { maxClaims: 1, maxSubQuestions: 2 }, undefined, order);
    expect(selected.map((s) => s.claim.id)).toEqual(['C1']);
    expect(notExecuted.slice(0, 5)).toEqual(['C2', 'C3', 'C4', 'C5', 'C6']);
    // a follow-up still names its claim
    expect(selectScope(reordered, { maxClaims: 1, maxSubQuestions: 2 }, ['C5'], order).selected.map((s) => s.claim.id)).toEqual(['C5']);
  });

  it('a plan edited on the page keeps the tree and the structured conditions', async () => {
    const fx = await setup({ approved: false });
    cleanup = fx.cleanup;
    const editable = toEditable(plan());
    editable.claims[0].conditions[0] = withConditionText(editable.claims[0].conditions[0], '员工端 AI 工具纳入统一终端管理');
    const saved = await savePlanVersion({ vault: fx.vault, workspacePath: WS, researchDir: RDIR, role: ROLES.juniorA, plan: editable });
    const back = (await fx.vault.read(saved.path)).note as ResearchPlanNote;
    expect(back.question_tree).toEqual(plan().question_tree);
    expect(back.mece_check).toBe(plan().mece_check);
    expect(back.claims.map((c) => [c.question, c.parent ?? null])).toEqual(plan().claims.map((c) => [c.question, c.parent ?? null]));
    expect(back.claims[0].conditions[0]).toMatchObject({ text: '员工端 AI 工具纳入统一终端管理', evidence_needed: expect.any(String), where: expect.any(String) });
    expect(treeChecks(back)).toEqual([]);
  });
});
