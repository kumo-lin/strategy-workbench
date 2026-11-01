/**
 * Scripted chat agent for the e2e run (`MODEL_MOCK=1`). Each script is a fixed list of
 * steps; which step comes next is decided from the conversation itself — the tool calls made
 * since the last user message — so a page reload, a fresh browser context or a retry of the
 * same turn always lands on the same step. No state lives in the server process.
 *
 * Which script runs is decided by the last user message and the tool set of the phase:
 *   workplan phase, first co-creation (tools include frame_topic), "我们开始共创…"
 *                                            → 定题: ask → frame_topic → marks → confirm → frame_topic(confirmed) → compose_workplan
 *   workplan phase, "我们开始共创…" (a workplan already exists: submit_for_review among the tools)
 *                                            → 共创: 2 questions → workplan v1 + hypothesis → submit_for_review
 *   workplan phase, "请帮我解读这条 comment…" → 解读: intent question → change question → workplan v2
 *   research_plan phase (any message)        → grill: 3 questions → 计划 v1 (a question tree: Q1 → hypothesis H1)
 *   files_chat phase (set_selection among the tools, D-64 T37)
 *                                            → 找资料: vault_search → up to 4 files, the project's confirmed decisions first
 *   project_framing phase (draft_contract among the tools, D-64 T33)
 *                                            → 新建项目: the three questions → frame_topic → marks → confirm → frame_topic(confirmed) → draft_contract → draft_issue_tree
 * Anything else gets a one-line text reply. The content is fixed, in Chinese like the real UI.
 */
import { getVault } from '@/lib/vault';
import { isM1, M1_CLAIM_PERSPECTIVE, M1_CORE, M1_CONTRACT, M1_ISSUE_TREE, M1_PLAN } from './scripts/m1';

export type PromptMessage = { role: string; content: unknown };
export type ScriptStep = { call: { toolName: string; input: object } } | { text: string };

interface Turn {
  system: string;
  lastUser: string;
  /** Tool names the model has called since the last user message, in order. */
  calls: string[];
  /** The tool results after the last user message, in order. */
  results: { toolName: string; output: unknown }[];
  tools: string[];
}

/** The value of a tool result: the AI SDK carries it as `{ type: 'json', value }` or as a plain value. */
function outputOf(output: unknown): unknown {
  const o = output as { type?: string; value?: unknown } | null;
  return o && typeof o === 'object' && o.type === 'json' ? o.value : output;
}

function textOf(content: unknown): string {
  if (typeof content === 'string') return content;
  return (content as { type: string; text?: string }[]).map((p) => (p.type === 'text' ? (p.text ?? '') : '')).join('');
}

export function readTurn(prompt: PromptMessage[], tools: string[]): Turn {
  const lastUserAt = prompt.map((m) => m.role).lastIndexOf('user');
  const after = lastUserAt >= 0 ? prompt.slice(lastUserAt + 1) : [];
  const calls = after
    .filter((m) => m.role === 'assistant')
    .flatMap((m) => (m.content as { type: string; toolName?: string }[]).filter((p) => p.type === 'tool-call').map((p) => p.toolName ?? ''));
  const results = after
    .filter((m) => m.role === 'tool')
    .flatMap((m) =>
      (m.content as { type: string; toolName?: string; output?: unknown }[])
        .filter((p) => p.type === 'tool-result')
        .map((p) => ({ toolName: p.toolName ?? '', output: outputOf(p.output) })),
    );
  return {
    system: prompt.filter((m) => m.role === 'system').map((m) => textOf(m.content)).join('\n'),
    lastUser: lastUserAt >= 0 ? textOf(prompt[lastUserAt].content) : '',
    calls,
    results,
    tools,
  };
}

const why = (s: string) => ({ why: s });

/** The M1 demo is the Workspace being worked on, not every project path the prompt happens to mention (its context lists others). */
const isM1Workspace = (system: string) => {
  const ws = /Workspace：(20_项目\/[^/\n]+\/[^/\n。]+)。/.exec(system)?.[1];
  return ws ? isM1(`${ws}/`) : isM1(system);
};

function workspaceOf(system: string): { path: string; code: string } {
  const path = /Workspace：(20_项目\/[^/\n]+\/[^/\n。]+)。/.exec(system)?.[1];
  if (!path) throw new Error('mock agent: no Workspace path in the system prompt');
  return { path, code: path.split('/').pop()!.split(' ')[0] };
}

/** The first hypothesis note's name (without `.md`) in the project's 假设 folder: the compose pipeline calls it `IT 拍板`,
 *  older fixtures `IT 可管理性`; the scripts must follow whichever note exists. Falls back to the old name. */
async function h1NameOf(project: string, code: string): Promise<string> {
  const fallback = `${code}-H1 IT 可管理性`;
  try {
    const entries = await getVault().list(`${project}/假设`);
    return entries.find((e) => e.kind === 'file' && e.name.startsWith(`${code}-H1 `))?.name.replace(/\.md$/, '') ?? fallback;
  } catch {
    return fallback;
  }
}

/** A question-tree workplan (D-39) with one sub-question and its hypothesis; `extra` goes under the hypothesis' verification plan. */
function treeWorkplan(code: string, version: number, hypothesisNote: string, extra = ''): string {
  return `# ${code} workplan v${version}

## 要回答的问题与要支撑的决策
明年要不要押注企业端 AI PC。

## 前提
（没有已确认的决定）

## Day-1 answer
押 IT 可管的管理栈。

## 问题树与假设
### Q1 企业买单的首要条件是不是 IT 能管？
**假设 H1**：企业买单的首要条件是 IT 能管。[[${hypothesisNote}]]

## MECE 和充分必要的自检
只有一个子问题，不存在重叠；少了它就答不了核心问题。凭什么是联想交给 W5。

## 每个假设怎么验证
### H1
条件：采购清单里把可管理性放在前面。证据：采购文件。反证：价格排在前面的调研。
${extra}

## 金字塔骨架
结论 → Q1 的回答 → 证据。

## 风险和待确认
- 无。

## next action
- 调查 H1
`;
}

function coCreate(t: Turn): ScriptStep[] {
  const { path: W, code: C } = workspaceOf(t.system);
  const hyp = `${C}-H1 IT 可管理性`;
  const wsLink = `[[${W}/workspace|${W.split('/').pop()}]]`;
  const body = treeWorkplan(C, 1, hyp);
  return [
    {
      call: {
        toolName: 'ask_user',
        input: {
          question: '这项研究要支撑什么决策？',
          options: [
            { id: 'a', label: '明年要不要押注企业端 AI PC' },
            { id: 'b', label: '定价策略' },
          ],
          ...why('先对齐决策'),
        },
      },
    },
    {
      call: {
        toolName: 'ask_user',
        input: {
          question: '为了回答它，你最想先验证哪个子问题？',
          options: [
            { id: 'h1', label: '企业买单的首要条件是 IT 能管' },
            { id: 'h2', label: '预算来自 IT 部门之外' },
          ],
          ...why('确定第一个假设'),
        },
      },
    },
    {
      call: {
        toolName: 'write_draft',
        input: {
          note_type: 'workplan',
          name: 'workplan v1',
          frontmatter: { id: `${C.toLowerCase()}-wp-v1`, version: 1, derived_from: ['[[团队]]'], relates_to: [wsLink], changes: [] },
          body,
          ...why('对齐后起草 workplan v1'),
        },
      },
    },
    {
      call: {
        toolName: 'write_draft',
        input: {
          note_type: 'hypothesis',
          name: hyp,
          frontmatter: {
            id: `${C.toLowerCase()}-h1`,
            workspace: wsLink,
            statement: '企业买单的首要条件是 IT 能管',
            verdict_proposed: null,
            verdict: null,
            evidence: [],
            counter_evidence: [],
            derived_from: [`[[${W}/workplan v1|workplan v1]]`],
            relates_to: [wsLink],
          },
          body: '# H1\n',
          ...why('每个假设一条笔记'),
        },
      },
    },
    {
      call: {
        toolName: 'submit_for_review',
        input: { gate: 'G1', subject: 'workplan v1', summary: '请看拆题：问题、子问题、假设和下一步。', focus: ['H1 是否可证伪'], ...why('Junior 说可以交了') },
      },
    },
    { text: '送审材料准备好了，请点"提交给 Senior"。' },
  ];
}

/** The last result of a tool, if any (the newest one is the one to answer). */
function lastOutput(t: Turn, toolName: string): unknown {
  return [...t.results].reverse().find((r) => r.toolName === toolName)?.output;
}

/** The first co-creation the compose pipeline drafts (D-56 ③ v2): ask → frame_topic → marks → confirm → frame_topic(confirmed) → compose_workplan. */
function composeCoCreate(t: Turn): ScriptStep[] {
  const toMark = (lastOutput(t, 'frame_topic') as { to_mark?: { id: string }[] } | undefined)?.to_mark ?? [];
  const marks = toMark.map((i) => ({ ref: i.id, verdict: '一致', note: '方向在它之内' }));
  const compose = lastOutput(t, 'compose_workplan') as { say?: unknown } | undefined;
  const say = typeof compose?.say === 'string' ? compose.say : '拆好了，右边是研究计划。';
  const m1 = isM1Workspace(t.system);
  const decision = m1 ? M1_CONTRACT.decision : '明年要不要押注企业端 AI PC';
  const question = m1 ? M1_CORE : '企业买单的首要条件是不是 IT 能管？';
  return [
    {
      call: {
        toolName: 'ask_user',
        input: {
          question: '这项研究要支撑什么决策？',
          options: [
            { id: 'a', label: decision },
            { id: 'b', label: '定价策略' },
          ],
          ...why('先对齐决策'),
        },
      },
    },
    {
      call: {
        toolName: 'frame_topic',
        input: {
          topic: t.lastUser,
          question,
          decision,
          scope: m1 ? `${M1_CONTRACT.horizon}；${M1_CONTRACT.geography}；${M1_CONTRACT.product_scope}` : '2026–2027 年，大中型企业',
          success: m1 ? M1_CONTRACT.success : '知道企业买单的首要条件',
          known: m1 ? M1_CONTRACT.known.join('；') : '资料里还没有现成结论',
          bar: m1 ? M1_CONTRACT.bar : '内部资料加一个独立外部来源就够',
          size: '大题',
          ...why('用户说了决策，先把题目定下来'),
        },
      },
    },
    {
      call: {
        toolName: 'frame_topic',
        input: {
          ...(marks.length ? { marks } : {}),
          ...why('资料包里的每一条都标成一致'),
        },
      },
    },
    {
      call: {
        toolName: 'ask_user',
        input: {
          question: m1 ? `题目定成：${question}；支撑${decision}；${M1_CONTRACT.horizon}；${M1_CONTRACT.geography}。就按这个拆？` : '题目定成：企业买单的首要条件是不是 IT 能管；支撑明年要不要押注企业端 AI PC；2026–2027 年大中型企业；知道企业买单的首要条件；已知的事实：资料里还没有现成结论；证据门槛：内部资料加一个独立外部来源就够。就按这个拆？',
          options: [
            { id: 'a', label: '就按这个拆' },
            { id: 'b', label: '我要改' },
          ],
          ...why('拆之前让用户确认题目'),
        },
      },
    },
    { call: { toolName: 'frame_topic', input: { confirmed: true, ...why('用户点了就按这个拆') } } },
    { call: { toolName: 'compose_workplan', input: why('题目定了，交给系统拆') } },
    { text: say },
  ];
}

/** D-64 T37: the files page's chat — what to read for this task, the confirmed decisions first. */
function filesChat(t: Turn, all: Turn['results']): ScriptStep[] {
  // v6 2.6: "TechRadar 那篇讲企业采购的，和 M1 有关吗？" — look the file up, then propose not reading it (the analyst agrees on the card)
  const asked = /^(.+?)那篇.*有关吗/.exec(t.lastUser)?.[1]?.trim();
  if (asked) {
    const hit = ((lastOutput(t, 'vault_search') as { hits?: { path: string; title: string }[] } | undefined)?.hits ?? []).find((h) => h.title.includes(asked));
    const reason = '关系不大：M1 研究的是个人用户会不会持续使用，企业采购属于别的论点';
    return [
      { call: { toolName: 'vault_search', input: { query: asked, types: ['source'], limit: 3, ...why('先找到这份资料') } } },
      hit ? { call: { toolName: 'set_selection', input: { exclude: [hit.path], reason, ...why('和任务无关的资料不进入调查') } } } : { text: `文件管理里没有找到「${asked}」。` },
      { text: `${reason}。点“同意”后取消勾选，调查时不会读。` },
    ];
  }
  const ctx = all.find((r) => r.toolName === 'read_task_context')?.output as { contract?: { question?: string } | null; decisions?: { name: string }[] } | undefined;
  // v6 2.13: the project's confirmed outputs first (the decision, then the report it came from), then the company's own
  // material for this line of work. 复核 P6: materials only — without a type the search ranked 项目 and 日志 as reading.
  const searched = all.filter((r) => r.toolName === 'vault_search').map((r) => ((r.output as { hits?: { title: string }[] } | undefined)?.hits ?? []).map((h) => h.title));
  const decided = (ctx?.decisions ?? []).map((d) => d.name);
  const items = [...decided.map((d) => `${d}（项目里已确认的决定：它是这次研究的前提）`), ...searched.flat().filter((h) => !decided.includes(h))].filter((x, i, xs) => xs.indexOf(x) === i).slice(0, 4);
  const marks = '①②③④';
  return [
    { call: { toolName: 'vault_search', input: { query: ctx?.contract?.question ?? t.lastUser, types: ['report'], limit: 2, ...why('先找项目里已有的报告') } } },
    { call: { toolName: 'vault_search', input: { query: '联想 Qira', types: ['source'], limit: 4, ...why('再找联想自己的资料') } } },
    { text: items.length ? `按这个任务，建议先读这 ${items.length} 份：\n${items.map((x, i) => `${marks[i]} ${x}`).join('\n')}` : '文件管理里还没有和这个任务直接相关的资料。' },
  ];
}

/** D-64 T33: a new project's framing, with the M1 project's contract and issue tree (scripts/m1.ts). */
function projectFrame(t: Turn): ScriptStep[] {
  const toMark = (lastOutput(t, 'frame_topic') as { to_mark?: { id: string }[] } | undefined)?.to_mark ?? [];
  const marks = toMark.map((i) => ({ ref: i.id, verdict: '一致', note: '方向在它之内' }));
  const c = M1_CONTRACT;
  const scope = `${c.horizon}；${c.geography}；${c.product_scope}；不研究${c.out_of_scope.join('、')}`;
  return [
    {
      call: {
        toolName: 'ask_user',
        input: {
          question: '先定三件事：① 这次研究要支撑什么决定？② 时间和地域看到哪里？③ 哪些不研究？',
          options: [
            { id: 'a', label: `${c.decision}；${c.horizon}；${c.geography}；不研究${c.out_of_scope.join('和')}` },
            { id: 'b', label: '我自己写' },
          ],
          ...why('新项目先定决定、范围和不研究的'),
        },
      },
    },
    {
      call: {
        toolName: 'frame_topic',
        input: { topic: t.lastUser, question: c.question, decision: c.decision, scope, success: c.success, known: c.known.join('；'), bar: c.bar, size: '大题', ...why('用户选了决定和范围') },
      },
    },
    { call: { toolName: 'frame_topic', input: { ...(marks.length ? { marks } : {}), ...why('资料包里的每一条都标成一致') } } },
    {
      call: {
        toolName: 'ask_user',
        input: {
          question: `题目定成：${c.question}支撑${c.decision}；${scope}；成功的样子：${c.success}；已知：${c.known.join('；')}；证据门槛：${c.bar}。就按这个拆？`,
          options: [
            { id: 'a', label: '就按这个拆' },
            { id: 'b', label: '我要改' },
          ],
          ...why('拆之前让用户确认题目'),
        },
      },
    },
    { call: { toolName: 'frame_topic', input: { confirmed: true, ...why('用户点了就按这个拆') } } },
    { call: { toolName: 'draft_contract', input: { ...c, original_question: t.lastUser, ...why('题目定了，写决策契约') } } },
    { call: { toolName: 'draft_issue_tree', input: { ...M1_ISSUE_TREE, ...why('按决策拆成两条工作线') } } },
    { text: '决策契约和议题树都写好了，现在是草稿：请 Senior 在项目页点「确定，指派负责人」。' },
  ];
}

async function interpretComment(t: Turn): Promise<ScriptStep[]> {
  const { path: W, code: C } = workspaceOf(t.system);
  const link = /\[\[[^\]]+#\^m\d+\]\]/.exec(t.lastUser)?.[0];
  if (!link) throw new Error('mock agent: the user message has no comment link');
  const commentId = /#\^(m\d+)\]\]$/.exec(link)![1];
  const wsLink = `[[${W}/workspace|${W.split('/').pop()}]]`;
  const project = W.split('/').slice(0, 2).join('/');
  const hyp = await h1NameOf(project, C);
  const m1 = isM1Workspace(t.system);
  const intent = m1 ? '区分真正受益的用户和重复任务，不把跨设备当成普遍价值' : '担心结论被换机潮这种替代解释推翻';
  const change = m1 ? '收窄跨设备假设，并在 K3 加入三个竞争解释与通用助手对照' : '每个假设怎么验证：H1 加了排除换机潮的检验';
  const body = m1
    ? (await getVault().read(`${W}/workplan v1.md`)).body
        .replace('跨设备对所有用户都有价值', `跨设备只在电脑到手机接续的特定任务中明显，不是普遍价值〔${commentId}〕`)
        .replace('### H3-2\n', `### H3-2\n\n- K3 先区分三个竞争解释：H1 有持续增量；H2 没有独立增量；H3 被授权成本抵消。对照问题：${M1_PLAN.question}〔${commentId}〕\n`)
    : treeWorkplan(C, 2, hyp, `- H1 检验：对比 Win10 换机前后的 AI PC 渗透率〔${commentId}〕`);
  return [
    {
      call: {
        toolName: 'ask_user',
        input: {
          question: 'Senior 这条意见想达成什么？',
          options: [
            { id: 'i1', label: m1 ? intent : '担心结论被替代解释（换机潮）推翻，要求排除它' },
            { id: 'i2', label: '要求每个论点都写明反证怎么找' },
          ],
          ...why('意图要 Junior 确认'),
        },
      },
    },
    {
      call: {
        toolName: 'ask_user',
        input: {
          question: '怎么改？',
          options: [
            { id: 'c1', label: m1 ? change : '在 H1 的做法里加"排除换机潮"的检验' },
            { id: 'c0', label: '不改' },
          ],
          multiSelect: true,
          ...why('改哪里由 Junior 定'),
        },
      },
    },
    {
      call: {
        toolName: 'write_draft',
        input: {
          note_type: 'workplan',
          name: 'workplan v2',
          frontmatter: {
            id: `${C.toLowerCase()}-wp-v2`,
            version: 2,
            derived_from: [`[[${W}/workplan v1|workplan v1]]`],
            relates_to: [wsLink],
            changes: [{ comment: link, intent, change }],
          },
          body,
          ...why('Junior 选了 i1 和 c1'),
        },
      },
    },
    { text: m1 ? '研究计划 v2 写好了，已关联 Senior 的意见；先验证 K3 的独立增量，再决定跨设备的投入范围。' : '改好了：H1 加了排除换机潮的检验。G1 已通过，不用重新审批。' },
  ];
}

async function researchGrill(t: Turn): Promise<ScriptStep[]> {
  const { path: W, code: C } = workspaceOf(t.system);
  const wsLink = `[[${W}/workspace|${W.split('/').pop()}]]`;
  const project = W.split('/').slice(0, 2).join('/');
  const hypName = await h1NameOf(project, C);
  const vault = getVault();
  const hasHyp = await vault.exists(`${project}/假设/${hypName}.md`);
  const workplanPath = `${W}/workplan v1.md`;
  const derived = (await vault.exists(workplanPath)) ? `[[${W}/workplan v1|workplan v1]]` : wsLink;
  return [
    {
      call: {
        toolName: 'ask_user',
        input: {
          question: '这次调查要回答什么问题？',
          options: [{ id: 'q1', label: '企业为什么为员工的 AI PC 买单？' }],
          ...why('先对齐调查问题'),
        },
      },
    },
    {
      call: {
        toolName: 'ask_user',
        input: {
          question: '这个答案要支撑什么决策？',
          options: [{ id: 'p1', label: '决定 WS-A 先验证哪个买方场景' }],
          ...why('先问答案怎么用'),
        },
      },
    },
    {
      call: {
        toolName: 'ask_user',
        input: {
          question: '哪些假设必须成立？',
          options: [{ id: 'c1', label: 'IT 可管理性决定企业是否采购' }],
          multiSelect: true,
          ...why('确定假设'),
        },
      },
    },
    {
      call: {
        toolName: 'write_draft',
        input: {
          note_type: 'research_plan',
          name: '计划 v1',
          frontmatter: {
            id: `plan-${C.toLowerCase()}-it-v1`,
            version: 1,
            question: '企业为什么为员工的 AI PC 买单？',
            purpose: '决定 WS-A 先验证哪个买方场景',
            derived_from: [derived],
            relates_to: [wsLink],
            // D-39: a question tree. One top-level sub-question (Q1, not split, so no question_tree) with its one hypothesis;
            // treeChecks (lib/research/question-tree.ts) holds the draft to: a question, a condition, a way to look for counter-evidence, a mece_check
            mece_check: '只有一个子问题，不存在重叠；少了它就答不了核心问题：企业为什么买单，先看是不是 IT 能管。',
            claims: [
              {
                id: 'C1',
                question: '企业买单的首要条件是不是 IT 能管？',
                parent: null,
                statement: 'IT 可管理性决定企业是否采购 AI PC',
                hypothesis: hasHyp ? `[[${hypName}]]` : null,
                conditions: ['采购由 IT 牵头'],
                sub_questions: [
                  { id: 'C1-Q1', question: '企业采购 AI PC 时 IT 部门的角色是什么？', methods: ['知识库', '网络'] },
                  { id: 'C1-Q2', question: '员工对 AI PC 的 NPU 有多在乎？', methods: ['知识库', '网络'] },
                  { id: 'C1-Q3', question: '内部预算流程是怎样的？', methods: ['专家访谈'] },
                ],
                counter_search: '找 IT 不是决策方、或者员工并不在乎的证据',
                perspective: ['买方'],
              },
            ],
            // D-32: the team list's other perspectives, each with why this plan does not look at it; 监管 is left out on
            // purpose (D-34: the plan page says "漏了：监管" until Junior adds a sub-question for it)
            perspectives_skipped: [
              { perspective: '竞争对手', reason: '试水调查只查买方这一个子问题，对手放到完整调查' },
              { perspective: '我方自身的布局', reason: '先确认买方要什么，再对照联想的布局' },
              { perspective: '技术供给', reason: '技术供给由 W1 形态那边负责' },
            ],
            approved_by_owner: null,
            approved_at: null,
          },
          body: '# IT 可管理性 调查计划 v1\n\n## 调查什么 / 为什么\n企业为什么为员工的 AI PC 买单。\n\n## 问题树\n- Q1 企业买单的首要条件是不是 IT 能管？\n  - 假设 H1：IT 可管理性决定企业是否采购 AI PC\n  - 要查的问题：C1-Q1、C1-Q2（查法：知识库、网络）\n\n## 要问专家的问题\n- 预算由谁批？\n',
          ...why('三个问题都对齐了，起草计划'),
        },
      },
    },
    { text: '计划 v1 写好了：可以在页面上增删子问题、改问法，满意了点"批准"，批准之前不会开始调查。' },
  ];
}

/** D-64 T54: the investigation plan of the M1 demo — K3 split into three competing hypotheses (说明文档 2.5). */
function m1ResearchGrill(t: Turn): ScriptStep[] {
  const { path: W } = workspaceOf(t.system);
  const wsLink = `[[${W}/workspace|${W.split('/').pop()}]]`;
  return [
    { call: { toolName: 'ask_user', input: { question: '先验证哪个关键问题？', options: [{ id: 'k3', label: 'K3 跨设备是否解决重复出现的真实问题' }], ...why('按 Senior 的意见先验证 K3') } } },
    { call: { toolName: 'ask_user', input: { question: '这个答案要支撑什么决策？', options: [{ id: 'p1', label: M1_PLAN.purpose }], ...why('先问答案怎么用') } } },
    { call: { toolName: 'ask_user', input: { question: '“没有价值”和“有价值但被授权成本抵消”要不要分开验证？', options: [{ id: 'h3', label: '分开：对应的产品动作不同' }], ...why('确定竞争假设') } } },
    {
      call: {
        toolName: 'write_draft',
        input: {
          note_type: 'research_plan',
          name: '计划 v1',
          frontmatter: {
            id: 'plan-m1-k3-v1',
            version: 1,
            question: M1_PLAN.question,
            purpose: M1_PLAN.purpose,
            derived_from: [wsLink],
            relates_to: [wsLink],
            mece_check: '每个关键问题都有互相对立的假设：K3 的三个分别是有独立增量、没有独立增量、被授权成本抵消；K1、K2、K4 各两个，一正一反。',
            claims: M1_PLAN.claims.map((c) => ({ ...c, parent: null, hypothesis: null, sub_questions: [{ id: `${c.id}-Q1`, question: c.question, methods: ['知识库', '网络'] }], perspective: M1_CLAIM_PERSPECTIVE[c.id] ?? ['用户'] })),
            // D-32: a perspective of the team list no claim looks from is named, with why this plan leaves it (复核 F)
            perspectives_skipped: [
              { perspective: '经济性', reason: '这次先回答用户会不会持续用；投入产出放到定价验证时再算' },
              { perspective: '中国市场', reason: '先用公开数据较全的海外样本；中国市场的差异放到区域验证' },
              { perspective: '监管', reason: '授权意愿按用户视角查；监管要求放到产品方案阶段' },
            ],
            approved_by_owner: null,
            approved_at: null,
          },
          body: `# K3 跨设备价值 调查计划 v1\n\n## 调查什么 / 为什么\n${M1_PLAN.question}\n\n## 问题树\n${M1_PLAN.claims.map((c) => `- ${c.statement}`).join('\n')}\n\n证伪标准：执行前约定业务上有意义的最低改善幅度，避免看到结果后再改标准。\n`,
          ...why('K3 优先，其他关键问题保留竞争假设，起草计划'),
        },
      },
    },
    { text: '调查计划 v1 写好了：K3 下并列 H1、H2、H3 三个竞争假设。计划定了，点“计划定了，开始调查”。' },
  ];
}

/** The step to run now, or null when this conversation has no script (→ plain reply). */
export async function nextStep(turn: Turn): Promise<ScriptStep> {
  // D-64 T20: the first step of a phase offers only read_task_context — every script starts by reading the task context;
  // the scripts below count their own calls, so the read is left out of `calls`
  if (turn.tools.length === 1 && turn.tools[0] === 'read_task_context') return { call: { toolName: 'read_task_context', input: { why: '开工前先读任务背景' } } };
  const t: Turn = { ...turn, calls: turn.calls.filter((c) => c !== 'read_task_context'), results: turn.results.filter((r) => r.toolName !== 'read_task_context') };
  let script: ScriptStep[] | null = null;
  if (t.tools.includes('submit_for_review')) {
    if (/^请帮我解读这条 ?(意见|comment)/.test(t.lastUser)) script = await interpretComment(t);
    else if (t.lastUser.includes('共创')) script = coCreate(t);
  } else if (t.tools.includes('set_selection')) {
    script = filesChat(t, turn.results);
  } else if (t.tools.includes('draft_contract')) {
    script = projectFrame(t);
  } else if (t.tools.includes('frame_topic') || t.tools.includes('compose_workplan')) {
    // the first co-creation: no submit_for_review yet, the workplan is the compose pipeline's to draft (the step right after the confirmation offers compose_workplan alone)
    if (t.lastUser.includes('共创')) script = composeCoCreate(t);
  } else if (t.tools.includes('write_draft')) {
    script = isM1Workspace(t.system) ? m1ResearchGrill(t) : await researchGrill(t);
  }
  if (!script) return { text: '（mock）收到。' };
  return script[Math.min(t.calls.length, script.length - 1)];
}
