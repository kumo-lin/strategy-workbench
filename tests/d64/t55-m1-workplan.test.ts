/** T55-2: M1 framing stays on its own decision rather than the old enterprise-PC script. */
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { nextStep } from '@/lib/testing/mock-agent';
import { M1_CONTRACT, M1_CORE, m1TreeAnswer } from '@/lib/testing/scripts/m1';
import { leavesOf, treeSchema } from '@/lib/workplan/compose/types';
import { answerResearchStep } from '@/lib/testing/mock-research';
import { taskLine } from '@/lib/testing/mock-contract';

afterEach(() => vi.unstubAllEnvs());
it('compiles the M1 script with the actual workplan tree schema', () => {
  expect(treeSchema.safeParse(m1TreeAnswer())).toMatchObject({ success: true });
  expect(leavesOf(treeSchema.parse(m1TreeAnswer()))[7].node.hypothesis.statement).toBe('跨设备对所有用户都有价值');
});
it('attaches the actual age-use reference to the relevant hypothesis, not the first unrelated source', () => {
  vi.stubEnv('VAULT_DIR', path.resolve('tests/fixtures/e2e-vault-m1'));
  const prompt = `${taskLine('workplan_tree')}\n## 参考资料（编号可以写进 known_by 和 to_verify.where）\n- K2《联想 2026-01 Qira发布》 ^c1：设备布局\n- K6《Pew 2026-06 How Opinions and Use of AI Differ by Age》 ^c1：Daily chatbot use\n\n## 其他`;
  const tree = treeSchema.parse(answerResearchStep(prompt));
  expect(leavesOf(tree)[0].node.hypothesis.known_by).toEqual(['K6']);
});
const turn = (calls: string[] = [], system = 'Workspace：20_项目/个人AI战略/M1 用户持续使用。') => ({ system, lastUser: '我们开始共创研究计划', calls, results: [], tools: ['ask_user', 'frame_topic', 'compose_workplan'] });
it('asks and confirms the M1 decision, with the M1 question and scope in the frame', async () => {
  vi.stubEnv('VAULT_DIR', path.resolve('tests/fixtures/e2e-vault-m1'));
  const question = await nextStep(turn());
  expect(JSON.stringify(question)).toContain(M1_CONTRACT.decision);
  expect(JSON.stringify(question)).not.toContain('企业端 AI PC');
  const framed = await nextStep(turn(['ask_user']));
  expect(framed).toMatchObject({ call: { toolName: 'frame_topic', input: { question: M1_CORE, decision: M1_CONTRACT.decision, scope: expect.stringContaining('2027'), known: M1_CONTRACT.known.join('；'), bar: M1_CONTRACT.bar } } });
  const confirm = await nextStep(turn(['ask_user', 'frame_topic', 'frame_topic']));
  expect(JSON.stringify(confirm)).toContain(M1_CORE);
  expect(JSON.stringify(confirm)).not.toContain('IT 能管');
});
it('keeps the legacy framing outside the M1 project', async () => {
  vi.stubEnv('VAULT_DIR', path.resolve('tests/fixtures/e2e-vault-m1'));
  const other = await nextStep(turn([], 'Workspace：20_项目/别的项目/WS-A 买方。'));
  expect(JSON.stringify(other)).toContain('明年要不要押注企业端 AI PC');
});
