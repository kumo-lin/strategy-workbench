/** One request, several steps: the step that records the user's confirmation is followed by the step that composes (gate.ts, runner prepareStep). */
import { rm } from 'node:fs/promises';
import path from 'node:path';
import { MockLanguageModelV3 } from 'ai/test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runAgent } from '@/lib/harness';
import { updateState } from '@/lib/workplan/compose/state';
import { listWorkplans } from '@/lib/workplan/state';
import { ctxFor, makeM1Vault, step, WS } from '../helpers';
import { scriptedModel } from './fake-model';
import { hyp } from './fixtures';

const holder = vi.hoisted(() => ({ model: null as unknown }));
vi.mock('@/lib/models/provider', () => ({ getModel: async () => ({ model: holder.model }) }));

let vault: Awaited<ReturnType<typeof makeM1Vault>>['vault'];
let root: string;
let cleanup: () => Promise<void>;
beforeEach(async () => {
  ({ vault, root, cleanup } = await makeM1Vault());
  await rm(path.join(root, WS, 'workplan v1.md'));
});
afterEach(async () => cleanup());

const leaf = (q: string) => ({
  question: `${q}？`,
  hypothesis: { ...hyp(`${q}的假设`), falsifier: '采购文件里把可管理性排在价格之后', to_verify: [{ what: '查采购标准', where: '上网', support: '写明门槛', counter: '招标书' }] },
});
const tree = {
  core_question: '企业为什么付费',
  decision_options: '押、不押',
  day1_answer: '假设：IT 能管才付费',
  split_basis: '按决策选项拆',
  subquestions: [{ ...leaf('谁拍板'), knockout: true, ifBad: '改变先押哪一层' }, leaf('钱花在哪里'), leaf('什么条件批')], // D-64 T21: 1–4 key questions
  key_message: '一句话',
  risks: ['最可能被推翻的一点'],
  next_actions: ['Junior 先查 Q1'],
};
const judgment = '核心问题是谁有否决权。竞争假设：IT 能管才买单；价格排第一。关键的不确定性：采购标准里可管理性与价格的先后。最值得先验证采购文件里把什么排在前面，这一步成本最低，也最能区分这两个假设。容易被忽略的解释：企业换机主要是因为系统到期，不是为了 AI，所以 AI 带来的溢价本身可能并不存在，需要把换机原因和付费意愿分开看，分别找采购记录、预算科目和续约合同里的证据来区分。再看续约合同和预算科目里有没有为管理能力单独列支，把换机的原因和付费的意愿分开记录。';
const cleanEval = { answers: [1, 2, 3, 4, 5, 6].map((q) => ({ q, verdict: '没问题', counterexample: '草案已经把竞争假设和关键不确定性分开写了' })) };

describe('a first co-creation request', () => {
  it('composes in the same request that records the confirmation', async () => {
    holder.model = scriptedModel({ workplan_judgment: judgment, workplan_eval: cleanEval, workplan_tree: tree }).model;
    // everything filled and marked, the user has not confirmed yet: stage = confirm
    await updateState(vault, WS, (s) => ({ ...s, frame: { question: '问', decision: '决策', scope: '2027', success: '知道条件', known: '暂无', bar: '一个来源' } }), new Date());

    const chat = new MockLanguageModelV3({
      doStream: [
        step({ calls: [{ toolName: 'frame_topic', input: { confirmed: true } }] }),
        step({ calls: [{ toolName: 'compose_workplan', input: {} }] }),
        step({ text: '拆好了。' }),
      ],
    });
    const ctx = await ctxFor(vault);
    ctx.taskContextRead = true; // D-64 T20: this test is not about reading the task context first (tests/d64/t20)
    const res = await runAgent({ ctx, model: chat, messages: [{ role: 'user', content: '就按这个拆' }] });
    await res.consumeStream();

    const names = chat.doStreamCalls.map((c) => (c.tools ?? []).map((t) => t.name).sort());
    expect(names[0]).toEqual(['ask_user', 'frame_topic']);
    expect(names[1]).toEqual(['compose_workplan']);
    expect(await listWorkplans(vault, WS)).toHaveLength(1);
    // the step after the confirmation offers only the composing, and says so
    expect(names[1]).toEqual(['compose_workplan']);
    const systemOf = (i: number) => String(chat.doStreamCalls[i].prompt.find((m) => m.role === 'system')?.content);
    expect(systemOf(0)).not.toContain('这一步');
    expect(systemOf(1)).toContain('调用 compose_workplan');
  });
});
