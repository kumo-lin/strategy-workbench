/** Shared fixtures for the compose tests: a small valid tree. */
import { treeSchema, type Tree } from '@/lib/workplan/compose/types';

export const hyp = (s: string) => ({ statement: s, falsifier: '看到相反的证据', conditions: ['条件一'], known_by: [], to_verify: [], short: s.slice(0, 8) });
export const leaf = (q: string) => ({ question: q.endsWith('？') ? q : `${q}？`, hypothesis: hyp(`${q}的假设`) });
export const sampleTree = (): Tree =>
  treeSchema.parse({
    core_question: '核心问题',
    decision_options: '选项 A、选项 B',
    day1_answer: '假设：先押 A',
    split_basis: '按决策选项拆，四个子问题合起来够',
    // D-64 T21: a tree marks 1–4 key questions
    subquestions: [{ ...leaf('谁拍板'), knockout: true, ifBad: '改变先押哪一层' }, { question: '钱花在哪里？', children: [leaf('软件'), leaf('硬件')] }, leaf('什么条件批')],
    key_message: '一句话',
    risks: ['最可能被推翻的一点'],
    next_actions: ['Junior 先查 Q1'],
  });

