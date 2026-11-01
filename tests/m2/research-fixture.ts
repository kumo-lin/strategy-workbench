/**
 * Fixture for the Deep Research gate tests: an approved plan, a hypothesis, vault
 * sources, a scripted model (answers each orchestrated step by recognising its prompt)
 * and a fake DeepSeek Search/Fetch client that counts calls.
 */
import { MockLanguageModelV3 } from 'ai/test';
import { vi } from 'vitest';
import type { SearchResult, WebToolsClient } from '@/lib/deepseek/web-tools';
import { buildToolContext } from '@/lib/harness';
import { makeFixtureVault, ROLES } from '../helpers/fixture-vault';

// Fixture vaults live on disk and several sessions run their suites at once: 2–9 s per test is normal under load, the 5 s default is not.
vi.setConfig({ testTimeout: 60_000 });

export const WS = '20_项目/P/WS-A';
export const RDIR = `${WS}/调查/R1`;
export const PLAN = `${RDIR}/计划 v1.md`;
export const HYP = '20_项目/P/假设/WS-A-H1 IT 可管理.md';

const fm = (lines: string) => `---\n${lines.trim()}\n---\n`;

/** `keys`: D-64 the key question (K1–K4) of each claim, in order (none: the older plans without keys). */
export function planNote(opts: { approved: boolean; subQuestions?: number; claims?: number; keys?: string[] }) {
  const nClaims = opts.claims ?? 1;
  const nSubs = opts.subQuestions ?? 3;
  const claims = Array.from({ length: nClaims }, (_, ci) => {
    const c = `C${ci + 1}`;
    const subs = Array.from({ length: nSubs }, (_, qi) =>
      qi === nSubs - 1 && nSubs >= 3
        ? `      - { id: ${c}-Q${qi + 1}, question: "内部预算流程是怎样的？", methods: [专家访谈] }`
        : `      - { id: ${c}-Q${qi + 1}, question: "企业采购 AI PC 时 IT 部门的角色 ${qi + 1}？", methods: [知识库, 网络] }`,
    ).join('\n');
    return `  - id: ${c}
    statement: "IT 可管理性决定企业是否采购 AI PC ${ci + 1}"
    hypothesis: "${ci === 0 ? '[[WS-A-H1 IT 可管理]]' : 'null'}"${opts.keys?.[ci] ? `\n    key: ${opts.keys[ci]}` : ''}
    conditions: ["采购由 IT 牵头"]
    sub_questions:
${subs}
    counter_search: "找 IT 不是决策方、或者员工并不在乎的证据"`.replace('"null"', 'null');
  }).join('\n');
  return `${fm(`
id: plan-r1-v1
type: research_plan
status: ${opts.approved ? '已确认' : '探索性'}
created: "2026-10-24"
updated: "2026-10-24"
author: AI
derived_from: ["[[20_项目/P/WS-A/workplan v1|workplan v1]]"]
relates_to: ["[[20_项目/P/WS-A/workspace|WS-A]]"]
version: 1
question: "企业为什么为员工的 AI PC 买单？"
purpose: "决定 WS-A 先验证哪个买方场景"
claims:
${claims}
approved_by_owner: ${opts.approved ? '"Junior A"' : 'null'}
approved_at: ${opts.approved ? '"2026-10-24T09:00:00Z"' : 'null'}
exploratory: true
`)}\n# R1 调查计划 v1\n`;
}

const HYP_NOTE = `${fm(`
id: ws-a-h1
type: hypothesis
status: 进行中
created: "2026-10-24"
updated: "2026-10-24"
author: Junior A
derived_from: ["[[20_项目/P/WS-A/workplan v1|workplan v1]]"]
relates_to: ["[[20_项目/P/WS-A/workspace|WS-A]]"]
workspace: "[[20_项目/P/WS-A/workspace|WS-A]]"
statement: IT 可管理性决定企业是否采购
verdict_proposed: null
verdict: null
evidence: []
counter_evidence: []
`)}\n# WS-A-H1\n`;

/** A second preset source from a different publisher, A-grade: with 资料甲 it makes the vault alone decisive. */
export const SOURCE_B = `${fm(`
id: src-b
type: source
status: 已确认
created: "2026-10-24"
updated: "2026-10-24"
author: Senior
derived_from: ["[[团队]]"]
relates_to: ["[[团队]]"]
url: null
publisher: 国家统计机构
published: "2026-06-30"
retrieved: "2026-10-24"
origin: 预置
grade: A
graded_by: 人
authority: null
link_checked: false
`)}\n# 资料乙\n\n## 论断\n\n- 「企业 AI PC 采购中，IT 部门负责设备管理与安全合规审批。」— 位置：表 2 ^c1\n`;

export const EXPERT = '00_团队知识/专家输入/访谈（模拟）.md';
const EXPERT_NOTE = (simulated: boolean) => `${fm(`
id: expert-it-lead
type: knowledge
status: 推断
created: "2026-10-24"
updated: "2026-10-24"
author: AI
derived_from: ["[[项目]]"]
relates_to: ["[[20_项目/P/WS-A/workspace|WS-A]]"]
kind: expert-input
approved_by: null
origin_project: "[[项目]]"
simulated: ${simulated}
`)}\n# 专家访谈：某企业 IT 负责人

**受访者**：可管理性是门槛，不是加分项；IT 部门一票否决采购。 ^e1

**受访者**：反面意见：管得太死，员工会绕过去，采购并不总是 IT 说了算。 ^e2
`;

export const MEETING = '20_项目/P/会议/2026-10-16 高层周会.md';
const MEETING_NOTE = `${fm(`
id: mtg-exec
type: meeting
status: 推断
created: "2026-10-24"
updated: "2026-10-24"
author: AI
derived_from: ["[[项目]]"]
relates_to: ["[[20_项目/P/WS-A/workspace|WS-A]]"]
date: "2026-10-16"
attendees: [VP, Senior]
simulated: true
decisions: []
`)}\n# 2026-10-16 高层周会

**VP**：先说方向。重点看 IT 能不能管，因为采购决定权在 CIO 手里，不在员工手里。 ^m1

**VP**：别一上来就纠结 NPU 算力够不够。 ^m2
`;
const WORKPLAN_V1_WITH_MEETING = `${fm(`
id: ws-a-wp-v1
type: workplan
status: 进行中
created: "2026-10-24"
updated: "2026-10-24"
author: Junior A
derived_from: ["[[团队]]"]
relates_to: ["[[团队]]"]
version: 1
approved_by: null
approved_at: null
changes: []
`)}\n# workplan v1\n\n- 高层的方向：重点看 IT 能不能管：[[20_项目/P/会议/2026-10-16 高层周会]]（^m1）\n`;

export async function setup(opts: { expert?: boolean | 'real'; meeting?: boolean; approved?: boolean; withSourceB?: boolean; subQuestions?: number; claims?: number; keys?: string[]; stage?: string } = {}) {
  const extra: Record<string, string> = {
    [PLAN]: planNote({ approved: opts.approved ?? true, subQuestions: opts.subQuestions, claims: opts.claims ?? opts.keys?.length, keys: opts.keys }),
    [HYP]: HYP_NOTE,
  };
  if (opts.withSourceB) extra['10_资料库/资料乙.md'] = SOURCE_B;
  if (opts.expert) extra[EXPERT] = EXPERT_NOTE(opts.expert !== 'real');
  if (opts.meeting) {
    extra[MEETING] = MEETING_NOTE;
    extra['20_项目/P/WS-A/workplan v1.md'] = WORKPLAN_V1_WITH_MEETING;
  }
  const fx = await makeFixtureVault(extra);
  if (opts.stage) {
    const ws = await fx.vault.read(`${WS}/workspace.md`);
    await fx.vault.write(`${WS}/workspace.md`, { frontmatter: { ...ws.data, stage: opts.stage }, body: ws.body }, { overwrite: true });
  }
  const ctx = await buildToolContext({ vault: fx.vault, role: ROLES.juniorA, workspacePath: WS, track: 'research', researchDir: RDIR, now: () => new Date('2026-10-24T10:00:00Z') });
  return { ...fx, ctx };
}

// ── fake web ────────────────────────────────────────────────────────────────

export interface FakeWeb extends WebToolsClient {
  searches: string[];
  fetches: string[];
}

/** Each search returns 3 fresh URLs; each page holds one supporting and one refuting sentence. */
export function fakeWeb(opts: { refuting?: boolean } = {}): FakeWeb {
  let n = 0;
  const web: FakeWeb = {
    searches: [],
    fetches: [],
    async search({ query }) {
      web.searches.push(query);
      const results: SearchResult[] = [0, 1, 2].map((i) => {
        const k = ++n;
        return {
          url: `https://site${k}-research.com/report/${k}`,
          title: `报告 ${k}`,
          site_name: `研究机构${k}`,
          date: '2026-09-01T00:00:00Z',
          summary: `摘要 ${k} ${i}`,
          rerank_score: 0.9 - i * 0.1,
          authority: 3,
        };
      });
      return { results };
    },
    async fetch({ url }) {
      web.fetches.push(url);
      const k = /report\/(\d+)/.exec(url)?.[1] ?? '0';
      const lines = [`调研显示，第 ${k} 组企业里 IT 部门主导了 AI PC 的采购决策。`];
      if (opts.refuting !== false) lines.push(`另有调查认为，员工并不在乎 NPU，换机主要由系统停止支持推动。`);
      return { title: `报告 ${k}`, content: lines.join('\n\n') };
    },
  };
  return web;
}

// ── scripted model ──────────────────────────────────────────────────────────

/** A complete "AI 的推荐判断" (方法库 so what 提炼 第 4 步), what the scripted summary answers by default. */
export const RECOMMENDATION = {
  decision_answer: '押管理和安全栈，自研为主（提议）',
  action: '商用 AI PC 把管理和安全栈做成能写进采购条款的证明物，由商用产品线牵头',
  action_kind: '自研',
  scale: '先在 2–3 家已有机队管理的大客户试点，6–9 个月',
  scale_inferred: true,
  scale_basis: '按一个试点周期覆盖一次采购评审来估，没有资料给出具体数字',
  metrics: ['试点客户的 IT 是否把可管理性写进招标条款', '半年内是否进入下一轮采购'],
  alternatives: [
    { dimension: 'layer', option: '押端侧算力', kind: '其他', why_not: '买方不为 AI 本身多付钱' },
    { dimension: 'acquire', option: '和现有管理平台厂商合作，把管理能力预装', kind: '合作', why_not: '差异化落在对方平台上' },
    { dimension: 'acquire', option: '收购一家终端管理公司', kind: '收购', why_not: '证据还不足以支撑这个量级的投入' },
  ],
  change_if: ['试点客户的 IT 仍然只看价格和换机周期'],
};

export interface ModelScript {
  /** Sees every prompt the model is given. */
  onPrompt?: (prompt: string) => void;
  /** The summary step answers with JSON that cannot be parsed, every time. */
  brokenSummary?: boolean;
  /** The recommendation; null = the model left it out; a function sees the prompt (a follow-up's rewrite). */
  recommendation?: Record<string, unknown> | null | ((prompt: string) => Record<string, unknown> | null);
  /** Override the judgment JSON (keys = evidence keys the prompt listed). */
  /** `locked`: a rewrite of the writing only (D-48 第 4 轮): the conditions are given, the model only writes. */
  judge?: (keys: { supports: string[]; refutes: string[]; challenges: string[]; conditions: number[]; locked: boolean }) => Record<string, unknown>;
  /** D-48: the rewrite of the parts over their 字数 limit (default: each as it was). */
  shorten?: (items: { id: string; text: string }[]) => { id: string; text: string }[];
  /** D-48 第 3 轮: each footnote of the Summary / recommendation judged (default: 撑得住); a proposed switch's ids carry ">E#". */
  citationFit?: (items: { id: string; key: string; sentence: string }[]) => { id: string; fit: string; reason: string }[];
  /** D-56 ⑦: each first-layer footnote judged against its original (default: 撑得住). */
  citationVerify?: (items: { id: string; sentence: string; key: string }[]) => { id: string; fit: string; reason: string }[];
  /** D-48 第 5 轮: the one-line answer and 对决策的回答 from the sub-questions' answers (default: the first answer's first clause, tagged). */
  conclusion?: (answers: { q: string; text: string }[]) => { so_what: string; decision_answer: string };
  /** The repair of the 挂错 ones (default: none, so they are flagged). */
  citationRepair?: (items: { id: string; key: string; sentence: string }[]) => { id: string; action: string; key?: string; sentence?: string }[];
  /** Override one evaluation stance (return undefined for the default rule). */
  stance?: (quote: string, prompt: string) => 'supports' | 'refutes' | 'irrelevant' | undefined;
  /** The first N evaluation calls never answer (until aborted): a stuck model. */
  hangEvaluate?: number;
  /** Add an invented quote to every extraction (must be dropped by the system). */
  inventQuote?: boolean;
  /** D-39, a question-tree plan: the Summary's answer per top-level sub-question (default: one sentence), and its sufficiency. */
  answers?: Record<string, string>;
  /** A follow-up's summary_update.reason opens with this (the live run wrote "H2 的理由改成：…"). */
  summaryReasonPrefix?: string;
  sufficiency?: string;
  /** The rewrite of a carried clause whose number is not in its original (default: the clause without its numbers). */
  reword?: (clause: string, prompt: string) => string;
  /** D-64 T23: fields added to the Summary answer (reasons, gaps, recommendations); `key` is the first evidence key the prompt listed. */
  summaryExtra?: (key: string | undefined) => Record<string, unknown>;
}

export interface ScriptedModel {
  model: MockLanguageModelV3;
  tasks: string[];
}

function promptText(options: { prompt: { role: string; content: unknown }[] }): string {
  return options.prompt
    .map((m) => (typeof m.content === 'string' ? m.content : (m.content as { type: string; text?: string }[]).map((p) => p.text ?? '').join('')))
    .join('\n');
}

const usage = { inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 1, text: 1, reasoning: 0 } };

export function scriptedModel(script: ModelScript = {}): ScriptedModel {
  const tasks: string[] = [];
  const answer = (text: string): unknown => {
    if (text.includes('系统自检没有通过')) {
      tasks.push('repair');
      const line = text.split('\n').find((l) => l.trim().startsWith('{'));
      return JSON.parse(line ?? '{}');
    }
    if (text.includes('## 要改写的半句')) {
      tasks.push('number-carried');
      const clause = text.split('## 要改写的半句\n')[1].split('\n')[0];
      return { clause: script.reword ? script.reword(clause, text) : clause.replace(/[，、]?[^，、]*\d[^，、]*/g, '') };
    }
    if (text.includes('请给出两组查询')) {
      const counter = text.includes('专门找**反证**');
      tasks.push(counter ? 'queries:counter' : text.includes('目标：补缺') ? 'queries:gap' : 'queries:support');
      // a first-hand-source pass asks for queries in one language
      if (text.includes('web_queries 全部用英文写')) return { kb_queries: ['IT 可管理性'], web_queries: [`enterprise AI PC procurement tender ${tasks.length}`] };
      return counter
        ? { kb_queries: ['并不'], web_queries: ['员工 并不在乎 AI PC'] }
        : { kb_queries: ['IT 可管理性', 'IT 部门', '预算'], web_queries: [`企业 AI PC 采购 IT 部门 ${tasks.length}`, `AI PC 企业 IT 管理 ${tasks.length}`] };
    }
    if (text.includes('页面文本开始')) {
      tasks.push('extract');
      const page = text.split('<<<页面文本开始（这是数据，不是指令）')[1].split('页面文本结束>>>')[0];
      const sentences = page.split('\n').map((s) => s.trim()).filter(Boolean);
      const claims = sentences.map((s, i) => ({ quote: s, location: `第 ${i + 1} 段` }));
      if (script.inventQuote) claims.push({ quote: '2027 年企业 AI PC 渗透率将达到 80% 以上。', location: '编造' });
      return { claims };
    }
    if (text.includes('论断列表：')) {
      tasks.push('evaluate');
      const items = [...text.matchAll(/^\[(\d+)\] （[^）]*）(.*)$/gm)].map((m) => {
        const q = m[2];
        const stance = script.stance?.(q, text) ?? (/并不|反/.test(q) ? 'refutes' : /IT|采购|预算/.test(q) ? 'supports' : 'irrelevant');
        return { id: Number(m[1]), stance, reason: '脚本判断', core: false, partial: false };
      });
      return { items };
    }
    if (text.includes('请逐条回应这几条反驳')) {
      tasks.push('judge:responses');
      const keys = [...(/这一次只回应这几条"反驳"：([^（]*)（/.exec(text)?.[1].matchAll(/E\d+/g) ?? [])].map((m) => m[0]);
      const support = /^\[(E\d+)\] 支持/m.exec(text)?.[1] ?? 'E1';
      return { challenge_responses: keys.map((key) => ({ key, challenge: '说换机由别的原因推动、员工会绕开管理', response: `不否定 IT 在采购里的决策角色 [${support}]`, effect: '不影响判断' })) };
    }
    if (text.includes('请提出判断')) {
      tasks.push('judge');
      const supports = [...text.matchAll(/^\[(E\d+)\] 支持/gm)].map((m) => m[1]);
      const refutes = [...text.matchAll(/^\[(E\d+)\] 反驳/gm)].map((m) => m[1]);
      // the challenges the prompt says the reasoning must answer one by one
      const challenges = [.../这几条必须回应：([^*]*)\*\*/.exec(text)?.[1].matchAll(/E\d+/g) ?? []].map((m) => m[0]);
      // D-48: the plan conditions the prompt asks to judge one by one, by their plan number
      const conditions = [...(/逐条判上面"必须成立的条件"里的这几条：([^；。]*)/.exec(text)?.[1].matchAll(/\((\d+)\)/g) ?? [])].map((m) => Number(m[1]));
      if (script.judge) return script.judge({ supports, refutes, challenges, conditions, locked: text.includes('这几条的状态已经定了') });
      return {
        verdict: '成立',
        rebutted: refutes,
        revised_statement: null,
        support_lines: supports.slice(0, 3).map((k) => `IT 部门主导采购 [${k}]`),
        counter_lines: refutes.length ? [] : ['已专门检索反证，没有找到 A/B 级的反证'],
        challenge_responses: refutes.map((k) => ({ key: k, challenge: '说换机由别的原因推动、员工会绕开管理', response: `不否定 IT 在采购里的决策角色 [${supports[0] ?? 'E1'}]`, effect: '推不翻' })),
        reasoning: `多家独立来源都指向 IT 主导 [${supports[0] ?? 'E1'}]`,
        model_knowledge: [],
        so_what: ['先打 IT 管理场景'],
        gaps: ['缺少预算口径'],
        expert_questions: ['预算由谁批？'],
      };
    }
    if (text.includes('写报告最前面的 Summary')) {
      tasks.push('summary');
      if (script.brokenSummary) return '{"so_what": "x", "results": ["H1 → 成立（提议）：x"] "workplan_impact": []}';
      const k = /\[(E\d+)\]/.exec(text)?.[1];
      // a question-tree plan (D-39): one answer per top-level sub-question run, and why they are enough
      const tree = text.includes('- answers：')
        ? { answers: [...text.matchAll(/^- (Q\d+) .*这次查了/gm)].map((m) => ({ id: m[1], answer: script.answers?.[m[1]] ?? `IT 决定准入${k ? ` [${k}]` : ''}` })), sufficiency: script.sufficiency ?? '谁决定、按什么放行、钱从哪来，三问少一个都答不了' }
        : {};
      return { so_what: `买方的关键是 IT 可管理性${k ? ` [${k}]` : ''}`, results: ['H1 → 成立（提议）：多家独立来源支持'], workplan_impact: [`和 IT 负责人对齐管理需求${k ? ` [${k}]` : ''}`], ...tree, ...script.summaryExtra?.(k) };
    }
    if (text.includes('写"AI 的推荐判断（提议，待人拍板）"')) {
      tasks.push(text.includes('上一次写的推荐判断没有通过系统检查') ? 'recommend:repair' : 'recommend');
      const rec = typeof script.recommendation === 'function' ? script.recommendation(text) : script.recommendation;
      // answers the directive row the way the prompt asks, when the prompt shows a directive to answer
      const directive = /^\[(M\d+)\]（高层指示/m.exec(text)?.[1];
      // a follow-up whose claim changed asks for the claim's new Summary 理由
      const key = /关键证据：\[(E\d+)\]/.exec(text)?.[1];
      const summaryUpdate = text.includes('summary_update 字段') ? { summary_update: { reason: `${script.summaryReasonPrefix ?? ''}按这一版的判断重写的理由${key ? ` [${key}]` : ''}`, so_what: '' } } : {};
      if (rec === undefined) return { ...RECOMMENDATION, directive_response: directive ? `修正：重点看 IT 能不能管的方向成立，但只在管理严格的企业里 [${directive}]` : '', ...summaryUpdate };
      return rec ?? {};
    }
    if (text.includes('下面是各子问题已经定稿的回答')) {
      tasks.push('summary:conclusion');
      const answers = [...text.matchAll(/^- (Q\d+(?:-\d+)?)：(.*)$/gm)].map((m) => ({ q: m[1], text: m[2] }));
      if (script.conclusion) return script.conclusion(answers);
      const a = answers[0];
      const first = a ? a.text.split(/[；。]/)[0].trim() : '还答不了';
      return { so_what: `${first}${a ? `[${a.q}]` : ''}`, decision_answer: `提议：先押 IT 管理这一层${a ? `[${a.q}]` : ''}。依据：${a?.q ?? ''} 的回答${a ? `[${a.q}]` : ''}` };
    }
    if (text.includes('拿不准时判部分')) {
      // citationVerifyPrompt renders the footnote it is given ([^1]) inside its own brackets: 这个脚注：[[^1]]
      const items = [...text.matchAll(/^- id：(\S+)\n {2}句子：(.*)\n {2}这个脚注：\[+(\^\d+)\]+/gm)].map((m) => ({ id: m[1], sentence: m[2], key: m[3] }));
      tasks.push('citation-verify');
      return { items: script.citationVerify ? script.citationVerify(items) : items.map((i) => ({ id: i.id, fit: '撑得住', reason: '', can: '原文说到的事实', cannot: '原文没有说到的范围' })) };
    }
    if (text.includes('逐项判断：原文撑不撑得住')) {
      const items = [...text.matchAll(/^- id：(\S+)\n {2}句子：(.*)\n {2}这个脚注：\[(E\d+)\]/gm)].map((m) => ({ id: m[1], sentence: m[2], key: m[3] }));
      tasks.push(items.some((i) => i.id.includes('>')) ? 'citation-fit:verify' : 'citation-fit');
      return { items: script.citationFit ? script.citationFit(items) : items.map((i) => ({ id: i.id, fit: '撑得住', reason: '' })) };
    }
    if (text.includes('有一个脚注挂错了')) {
      tasks.push('citation-fit:repair');
      const items = [...text.matchAll(/^- id：(\S+)\n {2}句子：(.*)\n {2}挂错的脚注：\[(E\d+)\]/gm)].map((m) => ({ id: m[1], sentence: m[2], key: m[3] }));
      return { items: script.citationRepair ? script.citationRepair(items) : [] };
    }
    if (text.includes('下面这几处超过了字数上限')) {
      tasks.push('shorten');
      const items = [...text.matchAll(/^- id：(\S+)（[^）]*）：(.*)$/gm)].map((m) => ({ id: m[1], text: m[2] }));
      return { items: script.shorten ? script.shorten(items) : items };
    }
    tasks.push('unknown');
    return {};
  };
  let hung = 0;
  const model = new MockLanguageModelV3({
    doGenerate: async (options) => {
      const prompt = promptText(options as never);
      script.onPrompt?.(prompt);
      if (script.hangEvaluate && prompt.includes('论断列表：') && hung < script.hangEvaluate) {
        hung++;
        tasks.push('evaluate:hung');
        const signal = (options as { abortSignal?: AbortSignal }).abortSignal;
        await new Promise((_, reject) => {
          if (signal?.aborted) reject(signal.reason);
          signal?.addEventListener('abort', () => reject(signal.reason ?? new Error('aborted')));
        });
      }
      return {
      content: [{ type: 'text', text: ((a) => (typeof a === 'string' ? a : JSON.stringify(a)))(answer(prompt)) }],
      finishReason: { unified: 'stop', raw: 'stop' },
      usage,
      warnings: [],
      };
    },
  });
  return { model, tasks };
}
