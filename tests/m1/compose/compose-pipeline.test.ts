/** The tool gate, the frame_topic tool, the prompt for a first co-creation, and compose_workplan with a scripted model (D-56 ③ v2). */
import { rm } from 'node:fs/promises';
import path from 'node:path';
import type { z } from 'zod';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWorkplanPrompt } from '@/lib/harness/prompts/workplan';
import { frameTopicParameters, frameTopicTool } from '@/lib/harness/tools/frame-topic';
import { composeWorkplan, leadRisk, riskBrief } from '@/lib/workplan/compose/compose';
import { noteNamePart } from '@/lib/workplan/compose/render';
import { composeToolGate } from '@/lib/workplan/compose/gate';
import { buildPack, mergePack } from '@/lib/workplan/compose/pack';
import { readState, readTreeSidecar, updateState } from '@/lib/workplan/compose/state';
import { treeSchema, type ComposeState } from '@/lib/workplan/compose/types';
import { gatherWorkplanContext } from '@/lib/workplan/context';
import { listWorkplans } from '@/lib/workplan/state';
import { taskOf } from '@/lib/testing/mock-contract';
import { ctxFor, makeM1Vault, WS } from '../helpers';
import { scriptedModel } from './fake-model';
import { hyp } from './fixtures';

const holder = vi.hoisted(() => ({ model: null as unknown }));
vi.mock('@/lib/models/provider', () => ({ getModel: async () => ({ model: holder.model }) }));

const COMMON = (id: string, type: string, extra: string) =>
  `---\nid: ${id}\ntype: ${type}\nstatus: 已确认\ncreated: "2026-10-24"\nupdated: "2026-10-24"\nauthor: Senior\nderived_from: ["[[团队]]"]\nrelates_to: ["[[团队]]"]\n${extra}\n---\n`;

let vault: Awaited<ReturnType<typeof makeM1Vault>>['vault'];
let root: string;
let cleanup: () => Promise<void>;
beforeEach(async () => {
  ({ vault, root, cleanup } = await makeM1Vault({
    '20_项目/P/会议/2026-10-20 周会.md': `${COMMON('mtg', 'meeting', 'date: "2026-10-20"\nattendees: [VP]\nsimulated: true\ndecisions: []')}\n- 重点看 IT 能不能管 ^m1\n`,
    '00_团队知识/高层方针/业务方针.md': `${COMMON('pol', 'knowledge', 'kind: policy\napproved_by: Senior\norigin_project: null')}\n- 员工自费订阅一律不报销 ^p6\n`,
  }));
  await rm(path.join(root, WS, 'workplan v1.md')); // a first co-creation: no workplan yet
});
afterEach(async () => cleanup());

const ctx = () => ctxFor(vault);
async function frame(args: z.input<typeof frameTopicParameters>) {
  const run = frameTopicTool.execute;
  if (!run) throw new Error('frame_topic has no execute');
  return run(frameTopicParameters.parse(args), await ctx());
}
const full = { question: '企业为什么付费', decision: '明年押不押', scope: '2027', success: '知道付费条件', known: '资料里还没有现成结论', bar: '内部资料加一个独立来源就够' };

async function setState(patch: (s: ComposeState) => ComposeState) {
  await updateState(vault, WS, patch, new Date('2026-10-27T00:00:00Z'));
}

describe('composeToolGate', () => {
  it('first co-creation: only ask_user and frame_topic until the user confirmed the frame', async () => {
    expect(await composeToolGate(await ctx())).toEqual({ only: ['ask_user', 'frame_topic'] });
    const c = await gatherWorkplanContext(await ctx());
    await setState((s) => ({ ...s, frame: full, pack: [], confirmed: true }));
    expect(await composeToolGate(await ctx())).toEqual({ only: ['ask_user', 'frame_topic', 'compose_workplan'] });
    expect(c.compose.active).toBe(true);
  });

  it('a Workspace that already has a workplan never gets the compose tools', async () => {
    const m = await makeM1Vault();
    try {
      expect(await composeToolGate(await ctxFor(m.vault))).toEqual({ without: ['frame_topic', 'compose_workplan'] });
    } finally {
      await m.cleanup();
    }
  });
});

describe('frame_topic', () => {
  it('builds the pack on the first call, stores the slots and the marks, and says what is left', async () => {
    const r = await frame({ topic: '企业会不会为 AI 付费', question: full.question });
    expect(r.stage).toBe('framing');
    expect(r.empty).toEqual(['要支撑的决策', '范围和时间', '成功的样子', '已知的事实和判断', '证据要多强才能拍板']);
    expect(r.to_mark.map((i) => i.id)).toEqual(['K1', 'K2']); // the meeting block and the policy block
    const s = await readState(vault, WS);
    expect(s.topic).toBe('企业会不会为 AI 付费');
    expect(s.frame.question).toBe(full.question);
    expect(s.pack.map((i) => i.id)).toEqual(['K1', 'K2']); // the meeting block and the policy block; references come when the question is confirmed
  });

  it('refuses a mark for an id that is not in the pack, and confirms only when everything is filled', async () => {
    let r = await frame({ topic: 'x', ...full, marks: [{ ref: 'K9', verdict: '一致', note: 'n' }] });
    expect(r.problems[0]).toContain('K9');
    r = await frame({ marks: [{ ref: 'K1', verdict: '一致', note: '都在说 IT 能管' }, { ref: 'K2', verdict: '冲突', note: '这题要卖订阅' }] });
    expect(r.stage).toBe('framing');
    expect(r.open_conflicts.map((c) => c.ref)).toEqual(['K2']);
    r = await frame({ confirmed: true });
    expect(r.problems[0]).toContain('不能确认');
    r = await frame({ marks: [{ ref: 'K2', verdict: '冲突', note: '这题要卖订阅', resolution: '按用户的想法' }] });
    expect(r.stage).toBe('confirm');
    r = await frame({ confirmed: true });
    expect(r.stage).toBe('ready');
  });
});

describe('the prompt of a first co-creation', () => {
  it('has the compose protocol and the progress block, and no write_draft instructions', async () => {
    await frame({ topic: 'x', question: full.question });
    const p = renderWorkplanPrompt(await gatherWorkplanContext(await ctx()));
    expect(taskOf(p)).toBe('workplan_cocreate');
    expect(p).toContain('共创的做法（先定题，再拆）');
    expect(p).toContain('定题进度（系统记的，不是你记的）');
    expect(p).toContain('- K1｜高层指示｜《2026-10-20 周会》 ^m1｜重点看 IT 能不能管｜还没标');
    expect(p).toContain('要支撑的决策：（空）');
    expect(p).toContain('没有 write_draft');
    expect(p).not.toContain('`## 问题树与假设`'); // the writing format is the pipeline's, not the model's
    expect(p).not.toContain('提问额度');
  });

  it('after the user confirmed, the tools line offers compose_workplan', async () => {
    await setState((s) => ({ ...s, frame: full, confirmed: true }));
    const p = renderWorkplanPrompt(await gatherWorkplanContext(await ctx()));
    expect(p).toContain('ask_user、frame_topic、compose_workplan');
  });
});

// ── compose_workplan with a scripted model ───────────────────────────────────

/** The first reference note of the pack: filled in by ready(), read when the scripted model answers (the code asks for at least one known_by when the library had material). */
const KNOWN: string[] = [];
const leaf = (q: string, extra: Partial<ReturnType<typeof hyp>> = {}) => ({
  question: `${q}？`,
  hypothesis: { ...hyp(`${q}的假设`), known_by: KNOWN, falsifier: '采购文件里把可管理性排在价格之后', to_verify: [{ what: '查采购标准', where: '上网', support: '写明门槛', counter: '招标书' }], ...extra },
});
const tree = () => ({
  core_question: '企业为什么付费',
  decision_options: '押、不押',
  day1_answer: '假设：IT 能管才付费',
  split_basis: '按决策选项拆',
  // D-64 T21: a tree marks 1–4 key questions
  subquestions: [{ ...leaf('谁拍板'), knockout: true, ifBad: '改变先押哪一层' }, { question: '钱花在哪里？', children: [leaf('软件'), leaf('硬件')] }, leaf('什么条件批')],
  key_message: '一句话',
  risks: ['最可能被推翻的一点'],
  next_actions: ['Junior 先查 Q1'],
});
const JUDGMENT = '核心问题不是企业愿不愿意付费，而是谁在采购里有否决权。竞争假设：IT 能管才买单；价格仍排第一；业务部门自带预算绕开 IT。关键的不确定性：采购标准里可管理性与价格的先后，预算由谁批。最值得先验证的是采购文件里把什么排在前面。容易被忽略的解释：企业换机主要是因为系统到期，不是为了 AI，所以 AI 带来的溢价本身可能并不存在，需要把换机原因和付费意愿分开看，分别找采购记录、预算科目和续约合同里的证据来区分。再看续约合同和预算科目里有没有为管理能力单独列支，把换机的原因和付费的意愿分开记录。';
/** An evaluation in which every question is answered "没问题". */
const cleanEval = { answers: [1, 2, 3, 4, 5, 6].map((q) => ({ q, verdict: '没问题', counterexample: '草案已经把竞争假设和关键不确定性分开写了' })) };

async function ready() {
  await frame({ topic: 'x', ...full });
  // the library is searched once the question is confirmed: do it here so the scripted tree can cite one of its notes
  const found = await buildPack({ vault, projectPath: '20_项目/P', query: `x ${Object.values(full).join(' ')}` });
  await setState((s) => ({ ...s, pack: mergePack(s.pack, found), pack_frozen: true }));
  KNOWN.length = 0;
  KNOWN.push(...(await readState(vault, WS)).pack.filter((i) => i.kind === 'reference').slice(0, 1).map((i) => i.id));
  await setState((s) => ({
    ...s,
    marks: s.pack.map((i) => ({ ref: i.id, verdict: '一致' as const, note: '一致' })),
    confirmed: true,
  }));
}

describe('small helpers', () => {
  it('noteNamePart keeps a plain name and never returns an empty one', () => {
    expect(noteNamePart('a/b:c')).toBe('a b c');
    expect(noteNamePart('///')).toBe('假设');
  });
  it('riskBrief gives a whole sentence or clause, marks a hard cut, and never leaves a title open', () => {
    expect(riskBrief('短的风险。后面还有一句')).toBe('短的风险');
    expect(riskBrief('微软把可管的 AI 并入 Intune，不另收费，独立付费的空间就没了，所以要先查这件事是否真的发生在大客户里面')).toBe('微软把可管的 AI 并入 Intune');
    expect(riskBrief('一二三四五六七八九十一二三四五六七八九十一二三四五六七八九十一二三四五六七八九十一二三四五六七八九十')).toMatch(/…$/);
    expect(riskBrief('依据《2026-10-16 高层周会（模拟）》里的说法不够明确而且需要进一步核对这件事的出处和口径')).not.toMatch(/《[^》]*$/);
  });
});

describe('the lead risk of the closing message', () => {
  it('never shows a cut-off sentence or a placeholder (the three seen in round 7)', () => {
    expect(leadRisk(['最可能被推翻：员工自付意愿被低价 Copilot 个人版或免…'])).toBe('主要风险待你补充');
    expect(leadRisk(['…'])).toBe('主要风险待你补充');
    expect(leadRisk(['……'])).toBe('主要风险待你补充');
    expect(leadRisk([])).toBe('主要风险待你补充');
  });
  it('takes the first whole risk, skipping the empty ones', () => {
    expect(leadRisk(['…', '管理栈若只能打包进 DaaS 单价，独立付费空间就没了'])).toBe('管理栈若只能打包进 DaaS 单价，独立付费空间就没了');
  });
});

describe('compose_workplan', () => {
  it('judges, evaluates, compiles the tree, writes the workplan and one note per hypothesis, and saves the tree beside it', async () => {
    const m = scriptedModel({ workplan_judgment: JUDGMENT, workplan_eval: cleanEval, workplan_tree: tree() });
    holder.model = m.model;
    await ready();
    const r = await composeWorkplan(await ctx());
    expect(r).toMatchObject({ status: 'done', version: 1, hypotheses: 4 });
    expect(m.asked.workplan_judgment).toBe(1);
    expect(m.asked.workplan_eval).toBe(1);
    expect(m.asked.workplan_revise).toBeUndefined(); // nothing to revise when the evaluator found nothing
    const versions = await listWorkplans(vault, WS);
    expect(versions.map((v) => v.version)).toEqual([1]);
    const side = await readTreeSidecar(vault, WS, 1);
    expect(treeSchema.safeParse(side?.tree).success).toBe(true);
    const s = await readState(vault, WS);
    expect(s.judgment?.revised).toBe(JUDGMENT);
    expect(s.judgment?.tokens).toBeGreaterThan(0);
    expect(s.tree).toBeTruthy();
    // the contract's new slots are in the note
    expect(versions[0].body).toContain('已知的事实和判断：资料里还没有现成结论');
    expect(versions[0].body).toContain('证据要多强才能拍板：内部资料加一个独立来源就够');
    // after the write the Workspace has a workplan: the compose tools are gone
    expect(await composeToolGate(await ctx())).toEqual({ without: ['frame_topic', 'compose_workplan'] });
  });

  it('the evaluator finds a concrete problem: one revision runs, and the tree is compiled from the revised text', async () => {
    const issue = { q: 4, verdict: '有问题', target: '采购文件里把什么排在前面', counterexample: '采购文件常常只写技术规格，不排优先级，这一条就查不出区分', fix: '改成：先看三家大客户的招标书评分表里可管理性和价格各占几分' };
    const revised = `${JUDGMENT}（改后）先看三家大客户招标书的评分表里可管理性和价格各占几分。\n\n## 没能改动的意见\n无`;
    const m = scriptedModel({ workplan_judgment: JUDGMENT, workplan_eval: { answers: [issue, ...cleanEval.answers.filter((a) => a.q !== 4)] }, workplan_revise: revised, workplan_tree: tree() });
    holder.model = m.model;
    await ready();
    const r = await composeWorkplan(await ctx());
    expect(r.status).toBe('done');
    expect(m.asked.workplan_revise).toBe(1);
    const s = await readState(vault, WS);
    expect(s.judgment?.revised).toContain('（改后）');
    expect(s.judgment?.revised).not.toContain('没能改动的意见');
    expect(s.judgment?.open).toEqual([]);
  });

  it('a finding the revision could not take in goes into 风险和待确认 and the result', async () => {
    const issue = { q: 5, verdict: '有问题', target: '预算由谁批', counterexample: '即使查清预算由谁批，三家客户都是 IT 批，结论也不会变，这条研究白做', fix: '删掉这一条，把力气放到采购标准上' };
    const revised = `${JUDGMENT}\n\n## 没能改动的意见\n[1] 预算的批准人本身是用户点名要查的`;
    holder.model = scriptedModel({ workplan_judgment: JUDGMENT, workplan_eval: { answers: [issue, ...cleanEval.answers.filter((a) => a.q !== 5)] }, workplan_revise: revised, workplan_tree: tree() }).model;
    await ready();
    const r = await composeWorkplan(await ctx());
    expect(r.status).toBe('done');
    if (r.status === 'done') expect(r.open_issues.join('')).toContain('预算由谁批');
    const body = (await listWorkplans(vault, WS))[0].body;
    expect(body).toContain('评估提醒：');
    expect(body).toContain('这一版没能改动：预算的批准人本身是用户点名要查的');
    expect(body).not.toMatch(/\bQ5\b/);
    expect((await readState(vault, WS)).judgment?.open).toHaveLength(1);
  });

  it('refuses before the user confirmed, and does not write anything', async () => {
    holder.model = scriptedModel({}).model;
    await frame({ topic: 'x', question: full.question });
    await expect(composeWorkplan(await ctx())).rejects.toThrow('不能确认');
    expect(await listWorkplans(vault, WS)).toHaveLength(0);
  });

  it('a tree that fails the code checks twice is reported as failed, nothing is written', async () => {
    const bad = tree();
    bad.subquestions[0] = leaf('谁拍板', { falsifier: '如果数据不支持' });
    const m = scriptedModel({ workplan_judgment: JUDGMENT, workplan_eval: cleanEval, workplan_tree: bad });
    holder.model = m.model;
    await ready();
    const r = await composeWorkplan(await ctx());
    expect(r.status).toBe('failed');
    // the reason is for the log: nothing of it reaches the model, so nothing of it reaches the chat
    expect(JSON.stringify(r)).not.toMatch(/证伪|空话|如果数据不支持|草稿|known_by/);
    expect(r).toMatchObject({ next: expect.stringContaining('我换一种拆法再试一次') });
    expect((await vault.readLog(`${WS}/日志.md`)).find((x) => x.action === 'compose:failed')?.change).toContain('如果数据不支持');
    expect(m.asked.workplan_tree).toBe(2);
    expect(await listWorkplans(vault, WS)).toHaveLength(0);
    // the second failure says it is over, and still no reason, no question
    const again = await composeWorkplan(await ctx());
    expect(again).toMatchObject({ status: 'failed', next: expect.stringContaining('稍后再试') });
    expect(JSON.stringify(again)).not.toMatch(/证伪|草稿/);
  });

  it('a judgment that cannot be written (too short twice) is reported as failed, and no tree is asked for', async () => {
    const m = scriptedModel({ workplan_judgment: '太短', workplan_tree: tree() });
    holder.model = m.model;
    await ready();
    const r = await composeWorkplan(await ctx());
    expect(r.status).toBe('failed');
    expect(m.asked.workplan_judgment).toBe(2);
    expect(m.asked.workplan_tree).toBeUndefined();
    expect(await listWorkplans(vault, WS)).toHaveLength(0);
  });

  it('a short name with a slash or a link character still gives plain note names, and the closing message is short', async () => {
    const odd = tree();
    odd.subquestions[0] = { ...leaf('谁拍板', { short: 'SCCM/GPO 卸载[1]#2' }), knockout: true, ifBad: '改变先押哪一层' }; // D-64 T21: keep the key question
    holder.model = scriptedModel({ workplan_judgment: JUDGMENT, workplan_eval: cleanEval, workplan_tree: odd }).model;
    await ready();
    const r = await composeWorkplan(await ctx());
    expect(r.status).toBe('done');
    if (r.status === 'done') {
      expect(Array.from(r.say).length).toBeLessThanOrEqual(80);
      expect(r.say).toContain('v1 拆好了');
      expect(r.say).not.toMatch(/workplan|Workspace/); // 走查截图 2.3: the reader's words
    }
    const names = (await vault.list('20_项目/P/假设')).map((e) => e.name);
    expect(names.some((n) => n.includes('SCCM GPO 卸载 1 2'))).toBe(true);
    expect(names.every((n) => !/[/\\#^[\]]/.test(n))).toBe(true);
  });

  it('internal names in the compiled tree are fixed before the workplan is written (pack id by code, the rest by one rewrite)', async () => {
    const dirty = tree();
    dirty.subquestions[0] = { ...leaf('谁拍板', { statement: 'IT 拍板，见 K1 和 ^m1' }), knockout: true, ifBad: '改变先押哪一层' }; // D-64 T21: keep the key question
    const m = scriptedModel({
      workplan_judgment: JUDGMENT,
      workplan_eval: cleanEval,
      workplan_tree: dirty,
      workplan_rewrite: { texts: { 'sub.0.statement': 'IT 拍板，周会里也这么说' } },
    });
    holder.model = m.model;
    await ready();
    const r = await composeWorkplan(await ctx());
    expect(r.status).toBe('done');
    expect(m.asked.workplan_rewrite).toBe(1);
    const body = (await listWorkplans(vault, WS))[0].body;
    expect(body).toContain('IT 拍板，周会里也这么说');
    expect(body).not.toContain('K1 和');
    const side = await readTreeSidecar(vault, WS, 1);
    expect(JSON.stringify(side?.tree)).not.toContain('^m1');
  });
});
