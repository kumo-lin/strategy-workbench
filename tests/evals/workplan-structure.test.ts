/** The workplan eval's structure checks, markdown, stability and per-run JSON. */
import { afterEach, describe, expect, it } from 'vitest';
import type { Vault } from '@/lib/vault';
import { updateState } from '@/lib/workplan/compose/state';
import { treeSchema, type Tree } from '@/lib/workplan/compose/types';
import type { Check } from '../../evals/judges';
import type { RunRecord } from '../../evals/workplan-lib';
import { EVAL_QUESTIONS, type EvalQuestion } from '../../evals/workplan-questions';
import {
  readStructure,
  stabilityLine,
  stabilityOf,
  structureChecks,
  structureJson,
  structureMarkdown,
  type StructureSnapshot,
} from '../../evals/workplan-structure';
import { hyp, leaf, sampleTree } from '../m1/compose/fixtures';
import { makeM1Vault, WS } from '../m1/helpers';

const q = (id: 1 | 2 | 3 | 4 | 5): EvalQuestion => EVAL_QUESTIONS.find((x) => x.id === id)!;
const find = (checks: Check[], name: string) => checks.find((c) => c.name === name)!;

const PACK: StructureSnapshot['pack'] = [
  { id: 'K1', kind: 'directive', title: '2026-10-16 高层周会（模拟）', block: '^m1' },
  { id: 'K2', kind: 'policy', title: '业务方针', block: '^p6' },
  { id: 'K3', kind: 'reference', title: 'Windows Report：IT可卸载Copilot' },
];

const MARKS: StructureSnapshot['marks'] = [
  { ref: 'K1', verdict: '一致', note: '周会说先看 IT 能不能管' },
  { ref: 'K2', verdict: '一致', note: '方针同意' },
];

const goodTree = (): Tree =>
  treeSchema.parse({
    ...sampleTree(),
    subquestions: [
      { question: 'IT 能不能管？', hypothesis: { ...hyp('IT 能管'), known_by: ['K3'] } },
      leaf('钱从哪出'),
    ],
  });

const snapshot = (over: Partial<StructureSnapshot> = {}): StructureSnapshot => ({
  version: 1,
  frame: { question: '问题', decision: '决策', scope: '范围', success: '成功', known: '已知', bar: '门槛' },
  marks: MARKS.map((m) => ({ ...m })),
  pack: PACK.map((p) => ({ ...p })),
  tree: goodTree(),
  judgment: { issues: 1, open: [] },
  ...over,
});

const treeWith = (...nodes: Tree['subquestions']): Tree => ({ ...goodTree(), subquestions: nodes });

const behaviour = (askedFirst: boolean, doubt: boolean) => ({ askedFirst, doubt });

describe('structureChecks', () => {
  it('returns no checks for a missing snapshot', () => {
    expect(structureChecks(null, q(1))).toEqual([]);
    expect(structureChecks(undefined, q(1))).toEqual([]);
  });

  it('passes every base check for a complete, marked and grounded run', () => {
    const checks = structureChecks(snapshot(), q(1));
    expect(checks.map((c) => c.name)).toEqual([
      '6 个槽都填满了',
      '每条指示、决定、方针都标了',
      '冲突都有处理结果',
      '子问题都挂了证伪条件',
      '扎根：至少一个 known_by',
    ]);
    expect(checks.every((c) => c.pass)).toBe(true);
  });

  it('fails the frame check and names the empty slot', () => {
    const checks = structureChecks(snapshot({ frame: { ...snapshot().frame, scope: '   ' } }), q(1));
    const c = find(checks, '6 个槽都填满了');
    expect(c.pass).toBe(false);
    expect(c.detail).toBe('范围和时间');
  });

  it('fails when a directive, decision or policy has no mark, and names it', () => {
    const checks = structureChecks(snapshot({ marks: [{ ref: 'K2', verdict: '一致', note: '方针' }] }), q(1));
    const c = find(checks, '每条指示、决定、方针都标了');
    expect(c.pass).toBe(false);
    expect(c.detail).toContain('K1');
  });

  it('fails when a conflict has no resolution', () => {
    const checks = structureChecks(snapshot({ marks: [{ ref: 'K1', verdict: '冲突', note: '和周会不一样' }, MARKS[1]] }), q(1));
    const c = find(checks, '冲突都有处理结果');
    expect(c.pass).toBe(false);
    expect(c.detail).toContain('K1');
  });

  it('fails when a leaf has an empty falsifier', () => {
    const tree = treeWith({ question: '甲？', hypothesis: { ...hyp('甲'), falsifier: '' } }, leaf('乙'));
    const c = find(structureChecks(snapshot({ tree }), q(1)), '子问题都挂了证伪条件');
    expect(c.pass).toBe(false);
    expect(c.detail).toContain('Q1');
  });

  it('fails grounding when a cited id is not in the pack', () => {
    const tree = treeWith({ question: '甲？', hypothesis: { ...hyp('甲'), known_by: ['K99'] } }, leaf('乙'));
    const c = find(structureChecks(snapshot({ tree }), q(1)), '扎根：至少一个 known_by');
    expect(c.pass).toBe(false);
    expect(c.detail).toContain('K99');
  });

  it('question 4 passes the conflict check only with both the policy and the directive marked as conflicts', () => {
    const both = snapshot({
      marks: [
        { ref: 'K1', verdict: '冲突', resolution: '按指示', note: '周会说先看 IT' },
        { ref: 'K2', verdict: '冲突', resolution: '按用户的想法', note: '方针不做订阅' },
      ],
    });
    expect(find(structureChecks(both, q(4)), '冲突标对了').pass).toBe(true);

    const onlyPolicy = snapshot({
      marks: [
        { ref: 'K1', verdict: '一致', note: '周会说先看 IT' },
        { ref: 'K2', verdict: '冲突', resolution: '按用户的想法', note: '方针不做订阅' },
      ],
    });
    const c = find(structureChecks(onlyPolicy, q(4)), '冲突标对了');
    expect(c.pass).toBe(false);
    expect(c.detail).toContain('^m1');
  });

  it('question 5 wants the Copilot note under known_by, not under to_verify', () => {
    const known = treeWith(
      { question: 'IT 能不能管？', hypothesis: { ...hyp('IT 能管'), known_by: ['K3'] } },
      leaf('钱从哪出'),
    );
    expect(find(structureChecks(snapshot({ tree: known }), q(5)), '已知的事实没有写成要去查').pass).toBe(true);

    const toVerify = treeWith(
      {
        question: 'IT 能不能管？',
        hypothesis: {
          ...hyp('IT 能管'),
          known_by: ['K3'],
          to_verify: [{ what: 'IT 能不能卸载 Copilot', where: '上网', support: '官方文档', counter: '论坛' }],
        },
      },
      leaf('钱从哪出'),
    );
    expect(find(structureChecks(snapshot({ tree: toVerify }), q(5)), '已知的事实没有写成要去查').pass).toBe(false);

    const missing = snapshot({ pack: PACK.filter((i) => i.id !== 'K3'), tree: known });
    const c = find(structureChecks(missing, q(5)), '已知的事实没有写成要去查');
    expect(c.pass).toBe(false);
    expect(c.detail).toBe('资料包里没有找到 IT可卸载Copilot 那篇');
  });

  it('question 5 keeps the tree at four leaves at most', () => {
    const small = treeWith(leaf('甲'), leaf('乙'));
    expect(find(structureChecks(snapshot({ tree: small }), q(5)), '树不超过 4 个子问题').pass).toBe(true);
    const big = treeWith(leaf('甲'), leaf('乙'), leaf('丙'), leaf('丁'), leaf('戊'));
    expect(find(structureChecks(snapshot({ tree: big }), q(5)), '树不超过 4 个子问题').pass).toBe(false);
  });
});

describe('readStructure', () => {
  let cleanup: () => Promise<void> = async () => {};

  afterEach(async () => {
    await cleanup();
    cleanup = async () => {};
  });

  it('returns null when the state has nothing and there is no tree', async () => {
    const fixture = await makeM1Vault();
    cleanup = fixture.cleanup;
    expect(await readStructure(fixture.vault, WS)).toBeNull();
  });

  it('reads the frame and pack back from the state file', async () => {
    const fixture = await makeM1Vault();
    cleanup = fixture.cleanup;
    const vault: Vault = fixture.vault;
    await updateState(vault, WS, (s) => ({
      ...s,
      frame: { ...s.frame, question: '哪一层先付钱？' },
      pack: [{ id: 'K1', kind: 'directive', title: '高层周会', path: 'a.md', block: '^m1', gist: '先看 IT' }],
    }));
    const s = await readStructure(vault, WS);
    expect(s).not.toBeNull();
    expect(s!.frame.question).toBe('哪一层先付钱？');
    expect(s!.pack[0]).toMatchObject({ id: 'K1', kind: 'directive', title: '高层周会', block: '^m1' });
    expect(s!.tree).toBeNull();
    expect(s!.version).toBeNull();
  });
});

describe('stabilityOf', () => {
  it('reports full pairing when three runs are identical', () => {
    const s = stabilityOf([snapshot(), snapshot(), snapshot()], [behaviour(true, false), behaviour(true, false), behaviour(true, false)]);
    expect(s.pairing).toBe(1);
    expect(s.sameBehaviour).toBe(true);
  });

  it('lowers the pairing when the trees ask different questions', () => {
    const different = treeWith(leaf('完全不同的问题甲'), leaf('另一种问法乙'));
    const s = stabilityOf([snapshot({ tree: goodTree() }), snapshot({ tree: different })], [behaviour(true, false), behaviour(true, false)]);
    expect(s.pairing).toBe(0);
  });

  it('treats a differing ask or doubt behaviour as unstable', () => {
    const s = stabilityOf([snapshot(), snapshot()], [behaviour(true, false), behaviour(false, true)]);
    expect(s.sameBehaviour).toBe(false);
  });
});

describe('stabilityLine', () => {
  it('writes the pairing percent and the behaviour verdict', () => {
    const line = stabilityLine({ pairing: 0.75, sameBehaviour: false });
    expect(line).toBe('子问题对得上 75%（线 70%）；追问/疑点行为 不一致');
  });
});

describe('structureMarkdown', () => {
  it('says so when there is no snapshot', () => {
    expect(structureMarkdown(null)).toBe('（没有结构化结果）');
  });

  it('renders the frame, the marks, the tree outline and the evaluation', () => {
    const md = structureMarkdown(snapshot());
    expect(md).toContain('要回答的问题：问题');
    expect(md).toContain('K1《2026-10-16 高层周会（模拟）》 ^m1：一致—周会说先看 IT 能不能管');
    expect(md).toContain('Q1 IT 能不能管？');
    expect(md).toContain('假设：IT 能管｜');
    expect(md).toContain('已知：Windows Report：IT可卸载Copilot');
    expect(md).toContain('评估：1 处问题，没解决 0 条');
  });
});

describe('structureJson', () => {
  it('has exactly what a human judge needs, with checks reduced to name/pass/detail', () => {
    const record: RunRecord = {
      questionId: 1,
      run: 2,
      ms: 1234,
      rounds: [],
      workplan: { version: 1, body: '# 计划', problems: [], askCount: 0 },
      structure: snapshot(),
    };
    const checks: Check[] = [{ name: '6 个槽都填满了', kind: 'rule', pass: true, detail: '全部填了' }];
    const json = structureJson(record, q(1), checks) as Record<string, unknown>;
    expect(Object.keys(json)).toEqual(['question', 'run', 'ms', 'conversation', 'structure', 'workplan', 'checks']);
    expect(json.question).toEqual({ id: 1, title: '题目清楚', text: q(1).text });
    expect(json.run).toBe(2);
    expect(json.ms).toBe(1234);
    expect(json.structure).toEqual(record.structure);
    expect(json.workplan).toEqual({ version: 1, body: '# 计划' });
    expect(json.checks).toEqual([{ name: '6 个槽都填满了', pass: true, detail: '全部填了' }]);
  });
});
