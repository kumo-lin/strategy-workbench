/**
 * D-64 T54: the M1 script of the mock model (E2E only). When the vault is the m1-qira demo (its 个人AI战略 project has
 * an issue_tree) and the prompt names no other project, the mock answers with the M1 topic of the explanation document
 * (the v6 explanation document, part two; the same text as v4) instead of the old enterprise-AI-PC script.
 *
 * Why the vault and not only the Workspace path of the system prompt: most orchestrated calls (the compose steps, the
 * Summary, the decision draft) carry a task line but no Workspace path. The old fixtures use the same project name but
 * their 项目.md has no issue_tree, so they keep the old answers.
 *
 * Content marked 补写 is not in the document (it only shows an excerpt); everything else is its wording.
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { getVault } from '@/lib/vault';

export const M1_PROJECT = '20_项目/个人AI战略';
export const M1_WORKSPACES = ['M1 用户持续使用', 'L2 凭什么赢'] as const;

/** Is this call part of the M1 demo? Pure apart from one file read; never throws. */
export function isM1(text: string, root: string = safeRoot()): boolean {
  if (!root) return false;
  const projectNote = path.join(root, M1_PROJECT, '项目.md');
  if (!existsSync(projectNote) || !/^issue_tree:/m.test(readFileSync(projectNote, 'utf8'))) return false;
  const projects = [...text.matchAll(/20_项目\/([^/\s|\]）)]+)\//g)].map((m) => m[1]);
  const actual = projects.filter((p) => !/^[.…]+$/.test(p));
  return (projects.length === 0 || actual.length > 0) && actual.every((p) => p === '个人AI战略');
}

function safeRoot(): string {
  try {
    return getVault().root;
  } catch {
    return '';
  }
}

// ── 2.3 研究计划 ────────────────────────────────────────────────────────────

export const M1_CORE = '哪些用户会持续使用个人 AI？2027 年应优先服务哪些用户、任务和使用机制？';

/** The four key questions (K1–K4) and what changes if the answer is bad. */
export const M1_KEYS = [
  { key: 'K1', question: '有没有足够高频的任务形成习惯？', ifBad: '2027 年不按“日常高频助手”定位投入' },
  { key: 'K2', question: '个人上下文是否明显优于通用 AI？', ifBad: '不把个人上下文当作 2027 年的主要差异点' },
  { key: 'K3', question: '跨设备是否解决重复出现的真实问题？', ifBad: '跨设备不作为面向所有用户的主打卖点' },
  { key: 'K4', question: '用户是否愿意授予所需权限？', ifBad: '2027 年先做分层授权，再做代为执行' },
] as const;

const leaf = (question: string, statement: string, short: string, falsifier: string, condition: string, key?: (typeof M1_KEYS)[number]) => ({
  question,
  ...(key ? { knockout: true, ifBad: key.ifBad, key: key.key } : {}),
  hypothesis: {
    statement,
    falsifier,
    conditions: [condition],
    known_by: [] as string[],
    to_verify: [{ what: question.replace(/？$/, ''), where: '上网', support: '能直接回答的数据', counter: '反面的数据' }],
    short,
  },
});

/** The workplan tree (compose step ④): the user lifecycle 需求 → 采用 → 留存 → 深化, 12 sub-questions, K1–K4 marked. */
export function m1TreeAnswer(text = '') {
  const refs = text.split(/^## 参考资料[^\n]*\n/m)[1]?.split(/^## /m)[0] ?? '';
  const age = /^-\s*(K\d+)《Pew 2026-06 How Opinions and Use of AI Differ by Age》/m.exec(refs)?.[1];
  const tree = {
    core_question: M1_CORE,
    decision_options: '优先服务哪些用户；优先做哪些任务；用什么使用机制（跨设备、个人上下文、授权）',
    day1_answer: '假设：会持续使用的是有高频重复任务的多任务用户，不只是年轻人；跨设备只在特定任务里有价值',
    split_basis: '按用户生命周期拆：需求 → 首次尝试 → 留存 → 使用深化。人群互相重叠，也解释不了“为什么会持续用”，所以不按人群拆',
    subquestions: [
      {
        question: 'M1.1 需求：哪些用户、哪些任务的需求最强？',
        children: [
          leaf('哪些用户群的未满足需求最强？', '30 至 49 岁多任务用户与学生需求最强，不只是年轻人', '需求最强人群', '每日使用率最高的是 18 至 29 岁', '多任务用户的每日使用率高于年轻人'),
          leaf('有没有足够高频的任务形成习惯？', '有每天重复的任务（整理信息、写作、日程）能形成习惯', '高频任务', '每天使用的人主要是一次性尝试', '每天使用的比例足够高', M1_KEYS[0]), // 补写
          leaf('个人上下文是否明显优于通用 AI？', '记得个人上下文的助手在同一任务上明显优于通用 AI', '个人上下文增量', '同任务对比没有差异', '同一任务有可对比的结果', M1_KEYS[1]), // 补写
        ],
      },
      {
        question: 'M1.2 采用：用户怎样开始用？',
        children: [
          leaf('预装、下载和推荐入口如何影响首次使用？', '预装提高触达，但不足以带来真实使用', '预装与首次使用', '预装用户的首次使用率不高于下载用户', '能区分预装和下载用户'),
          leaf('用户第一次用的是什么任务？', '首次使用集中在搜索和写作这类低门槛任务', '首次任务', '首次使用分散，没有集中的任务', '有按任务的使用数据'), // 补写
          leaf('不用的人为什么不用？', '不感兴趣、隐私顾虑和不信任准确性是主要原因', '不用的原因', '不用的人主要是不会用', '有不用原因的调查'), // 补写
        ],
      },
      {
        question: 'M1.3 留存：什么让用户留下或离开？',
        children: [
          leaf('什么导致用户放弃或换用其他工具？', '价值低、隐私顾虑、需要反复核查是主要流失原因', '流失原因', '流失主要因为价格', '有流失或换工具的原因数据'),
          leaf('跨设备是否解决重复出现的真实问题？', '跨设备对所有用户都有价值', '跨设备价值', '控制重度用户后跨设备与单设备留存无差异', '存在反复发生的跨设备任务', M1_KEYS[2]),
          leaf('付费用户的留存是否更好？', 'AI 订阅应用的留存低于非 AI 应用', '订阅留存', 'AI 应用留存不低于非 AI 应用', '有分 AI 与非 AI 的留存数据'), // 补写
        ],
      },
      {
        question: 'M1.4 深化：用户愿意给多少？',
        children: [
          leaf('用户愿意给多少记忆、数据和自主权？', '授权意愿随收益和可控程度变化，需要分层授权', '授权分层', '用户愿意一次性给全部权限', '有不同权限层级的授权意愿数据'),
          leaf('用户是否愿意授予所需权限？', '用户愿意给只读权限，不愿让 AI 代为执行', '授权意愿', '多数用户愿意让 AI 代为执行', '只读和代为执行的授权率可比', M1_KEYS[3]),
          leaf('用户愿意让 AI 替自己做决定吗？', '用户要 AI 帮忙，不要 AI 替自己做决定', '代为决定', '多数用户愿意让 AI 替自己做购买决定', '有让 AI 做决定的意愿数据'), // 补写
        ],
      },
    ],
    key_message: '个人 AI 要赢在具体任务里持续有用，而不是让更多人试用',
    risks: ['跨设备可能对所有用户都有价值，只是现在没有数据', '个人上下文的增量可能被通用模型的进步抹平'],
    next_actions: ['分析师甲先查 K3 跨设备的价值', '请 Senior 对 K3 的拆法给意见'],
  };
  if (age) tree.subquestions[0].children[0].hypothesis.known_by = [age];
  return tree;
}

export const M1_JUDGMENT = [
  '核心问题不是有多少人试过个人 AI，而是哪些用户会在具体任务里持续使用：试用的人多，天天用的人少。',
  '竞争假设一：有高频重复任务的多任务用户会持续使用；假设二：持续使用主要靠新鲜感，过一段时间就会流失；假设三：用户认可价值，但不愿授予必要的权限。',
  '关键的不确定性有四件（K1 到 K4）：有没有高频任务、个人上下文是否优于通用 AI、跨设备是否解决真实问题、用户是否愿意授权。任何一件结果不理想都会改变 2027 年的产品战略。',
  '容易被忽略的解释：联想已发布 Qira，设备覆盖只证明供给，不证明需求。',
  '最值得先验证：K3 跨设备的价值，因为它直接决定 Qira 的投入方向。',
].join('\n');

export const M1_KEYWORDS = ['个人 AI 持续使用', '每天使用', 'cross-device', '授权'];

// ── 2.5 调查计划：K3 下三个竞争假设 ─────────────────────────────────────────

export const M1_PLAN = {
  question: '控制通用助手能力、任务难度和用户差异后，跨设备连续体验是否仍有独立增量？',
  purpose: '决定跨设备是否作为 2027 年面向所有用户的主打卖点',
  claims: [
    {
      id: 'C1',
      key: 'K3',
      if_bad: M1_KEYS[2].ifBad,
      question: '跨设备连续体验是否有持续增量？',
      statement: 'H1 有持续增量：存在反复发生的跨设备任务，连续上下文改善任务结果',
      conditions: [
        { text: '存在反复发生的跨设备任务', evidence_needed: '真实任务回顾、任务频率', where: '文件管理资料；不够则上网；后续用户访谈' },
        { text: '连续上下文改善任务结果', evidence_needed: '同任务对照的完成率和耗时', where: '文件管理资料；不够则上网；后续用户访谈' },
        // T55 (v6:294): the premise H1 takes for granted, made explicit — the 80 configurations support this, not the increment
        { text: '跨设备体验已经在足够多的联想设备上可用', evidence_needed: '跨设备 AI 已覆盖的设备范围', where: '文件管理资料（Lenovo StoryHub）' },
      ],
      counter_search: '找控制重度用户后跨设备与单设备没有差异的数据',
    },
    {
      id: 'C2',
      key: 'K3',
      if_bad: M1_KEYS[2].ifBad,
      question: '跨设备的价值是否只是新鲜感？',
      statement: 'H2 没有独立增量：控制模型和任务后差异消失，价值来自新鲜感',
      conditions: [
        { text: '控制模型和任务后差异消失', evidence_needed: '通用助手与上下文助手的对照结果', where: '公开对照研究；Recon、OpenAI 使用研究' },
        { text: '价值来自新鲜感', evidence_needed: '多工具并用数据', where: '公开对照研究；Recon、OpenAI 使用研究' },
      ],
      counter_search: '找跨设备用户长期留存更高的数据',
    },
    {
      id: 'C3',
      key: 'K3',
      if_bad: M1_KEYS[2].ifBad,
      question: '授权成本会不会抵消跨设备的价值？',
      statement: 'H3 被授权成本抵消：用户认可价值，但拒绝必要的数据和行动权限',
      conditions: [
        { text: '用户认可跨设备的价值', evidence_needed: '不同权限层级下的授权意愿', where: 'Ping Identity、Gartner、Pew 调查' },
        { text: '拒绝必要的数据和行动权限', evidence_needed: '隐私顾虑比例', where: 'Ping Identity、Gartner、Pew 调查' },
      ],
      counter_search: '找用户愿意授予行动权限的数据',
    },
    // T55: retain the other keys as competing explanations; K3 stays H1–H3.
    {
      id: 'C4', key: 'K1', if_bad: M1_KEYS[0].ifBad,
      question: '有没有高频任务形成使用习惯？', statement: '高频任务能够形成持续使用习惯',
      conditions: [
        { text: '存在可核对的高频任务留存数据', evidence_needed: '能直接回答该条件的对照数据', where: '文件管理资料；不够则上网；后续访谈' },
        // T55 (v6:291 用过的人多，天天用的人少): the premise a broad habit needs, made explicit; Pew 49% / 24% decides it
        { text: '用过的人里，多数已经每天使用', evidence_needed: '用过与每天使用的比例', where: '文件管理资料（Pew 调查）' },
      ],
      counter_search: '查同任务对照中不支持假设的结果',
    },
    {
      id: 'C5', key: 'K1', if_bad: M1_KEYS[0].ifBad,
      question: '持续使用是否主要来自新鲜感？', statement: '使用习惯主要来自短期尝试而非重复任务',
      conditions: [{ text: '有长期任务频率与使用动机的对照', evidence_needed: '能直接回答该条件的对照数据', where: '文件管理资料；不够则上网；后续访谈' }],
      counter_search: '查同任务对照中不支持假设的结果',
    },
    {
      id: 'C6', key: 'K2', if_bad: M1_KEYS[1].ifBad,
      question: '个人上下文是否明显优于通用 AI？', statement: '个人上下文在同任务上带来独立增量',
      conditions: [{ text: '存在同任务对照实验', evidence_needed: '能直接回答该条件的对照数据', where: '文件管理资料；不够则上网；后续访谈' }],
      counter_search: '查同任务对照中不支持假设的结果',
    },
    {
      id: 'C7', key: 'K2', if_bad: M1_KEYS[1].ifBad,
      question: '通用助手是否已经足够？', statement: '控制任务后个人上下文不再有增量',
      conditions: [{ text: '存在控制用户和任务后的比较', evidence_needed: '能直接回答该条件的对照数据', where: '文件管理资料；不够则上网；后续访谈' }],
      counter_search: '查同任务对照中不支持假设的结果',
    },
    {
      id: 'C8', key: 'K4', if_bad: M1_KEYS[3].ifBad,
      question: '用户是否愿意授予所需权限？', statement: '用户普遍愿意开放所需权限',
      conditions: [{ text: '用户普遍接受主邮箱只读授权', evidence_needed: '能直接回答该条件的对照数据', where: '文件管理资料；不够则上网；后续访谈' }, { text: '公开数据证明所需权限都被接受', evidence_needed: '能直接回答该条件的对照数据', where: '文件管理资料；不够则上网；后续访谈' }],
      counter_search: '查同任务对照中不支持假设的结果',
    },
    {
      id: 'C9', key: 'K4', if_bad: M1_KEYS[3].ifBad,
      question: '分层授权是否能满足任务需要？', statement: '用户在看清任务收益后接受分层授权',
      conditions: [{ text: '存在收益与权限层级的同任务对照', evidence_needed: '能直接回答该条件的对照数据', where: '文件管理资料；不够则上网；后续访谈' }],
      counter_search: '查同任务对照中不支持假设的结果',
    },
  ],
};

/**
 * 复核 F: the perspective each M1 claim looks from (v6 2.14, 战略部: 用户 · 竞争 · 经济性 · 中国市场 · 监管). A personal-AI
 * study looks from its users (K1–K4) and its competitors (the general assistants of K2); the plan says why it leaves
 * 经济性 and 中国市场 for later. It also decides whom the interview advice names when no person was given.
 */
export const M1_CLAIM_PERSPECTIVE: Record<string, string[]> = { C6: ['用户', '竞争'], C7: ['用户', '竞争'] };

// ── 2.8 报告 v1 / 2.10 报告 v2 ──────────────────────────────────────────────

/** One sentence, at most 50 characters (the product's rule; v6's sample So what is longer, its first half is reason ①). */
export const M1_SO_WHAT_V1 = '联想应先找出会持续使用的任务，再决定跨设备投入，不把它当成所有用户的卖点';
export const M1_SO_WHAT_V2 = '验证范围收窄到电脑和手机之间来回接着做的日常工作';

export const M1_REASONS = [
  { title: '用的人多，天天用的人少', basis: [{ text: '美国成年人 49% 用过 AI 聊天工具，每天用的只有 24%', kind: '事实', source: 'Pew 2026' }] },
  { title: 'Qira 布局到位，价值未证明', basis: [{ text: 'Qira 已覆盖 80 多种 PC 配置，但没有公开数据证明它提高了用户留存', kind: '事实', source: 'Lenovo StoryHub' }] },
  { title: '用户要帮忙，不要失控', basis: [{ text: '即使每周能省下五小时，也只有 33% 愿意给 AI 主邮箱的只读权限', kind: '事实', source: 'Ping Identity 2026' }] },
] as const;

export const M1_GAPS = [
  { question: 'K2 个人上下文是否明显优于通用 AI？', missing: '没有同任务对比', how: '同任务实验' },
  { question: 'K3 跨设备是否解决重复出现的真实问题？', missing: '没有跨设备与单设备用户的留存对比', how: '产品数据；访谈 Qira 产品分析负责人' },
] as const;

/** 2.10: the interviews that touch a key question (K3, K4); K1 and K2 are not touched. */
export const M1_INTERVIEW_HITS = [
  // says: what the interview said about each judgment, by its id or its key question (v6 2.10, the v2 reasons ② and ③);
  // C3 is K3's H3 (授权成本), so what is said about permissions goes there; the product lead said nothing about it
  { interview: '访谈-Qira 产品分析负责人', keys: ['K3'], reason: '给了跨设备使用的口径和方向，但没有可核对的留存数字', says: { K3: '产品分析负责人给了跨设备使用的口径和方向，但没有可核对的留存数字', C3: '' } },
  {
    interview: '访谈-多设备重度用户',
    keys: ['K3', 'K4'],
    reason: '只在“电脑上准备、手机上跟进”的场景里提到明显帮助；愿意授权日历，不愿让 AI 代发邮件',
    says: { K3: '受访者只在“电脑上准备、手机上跟进”这类场景里提到明显帮助', C3: '受访者愿意让 AI 读日历，不愿让 AI 代发邮件', K4: '受访者愿意让 AI 读日历，不愿让 AI 代发邮件' },
  },
  { interview: '访谈-隐私与信任团队负责人', keys: ['K4'], reason: '只读授权容易接受，代为执行放弃的人明显多', says: { K4: '只读授权容易接受，让 AI 代为执行时放弃的人明显多' } },
] as const;

/** The Summary (task summary) in the M1 script: the hypotheses the prompt lists get their result line. */
export function m1SummaryAnswer(text: string): unknown {
  const k = /\[(E\d+)\]/.exec(text)?.[1];
  const cite = k ? ` [${k}]` : '';
  // what the prompt says each hypothesis came to (the engine's verdict), restated, never decided here
  const listed = [...text.matchAll(/^- (H\d+(?:-\d+)?) .* → (\S+?)（提议）/gm)].map((m) => ({ label: m[1], verdict: m[2] }));
  const evidence = [...text.matchAll(/\[(E\d+)\]（[^）]+）([^\n]*?)(?=；\[E\d+\]（|$)/gm)];
  const sourceKey = (pattern: RegExp) => evidence.find((e) => pattern.test(e[2]))?.[1];
  const reasonKeys = [
    [sourceKey(/Ever use.*49%/i), sourceKey(/NET Daily.*24%/i)],
    [sourceKey(/more than 80 supported PC/i)],
    [sourceKey(/only 33% indicating/i)],
  ];
  return {
    // T25: the So what written again after the interviews (the prompt marks the judgments they changed)
    so_what: text.includes('访谈追加：') ? M1_SO_WHAT_V2 : `${M1_SO_WHAT_V1}${cite}`,
    results: listed.map((h) => `${h.label} → ${h.verdict}（提议）`),
    workplan_impact: ['K3 的缺口转成访谈建议：先问 Qira 产品分析负责人'],
    reasons: M1_REASONS.map((r, i) => ({ ...r, basis: r.basis.map((b) => ({ ...b, refs: reasonKeys[i].filter((k): k is string => Boolean(k)) })) })),
    gaps: M1_GAPS,
    recommendations: [{ title: '先找出会持续使用的任务，再决定跨设备投入', how: '先验证电脑和手机之间来回接着做的日常工作', refs: ['K3'] }],
  };
}

// ── 2.11 决定 ───────────────────────────────────────────────────────────────

export const M1_DECISION = {
  decision: '跨设备功能先按用户和场景区分对待，暂不作为面向所有用户的主打卖点；先在电脑和手机之间来回接着做的日常工作里验证，再决定是否加大投入。',
  reason: '公开证据只证明 AI 采用广泛；访谈显示跨设备的价值只集中在少数场景；用户接受辅助建议多于自主执行。',
  scope: '在拿到跨设备留存数据前有效；数据出来后由项目负责人复审。',
};

/** The decision draft (task decision_draft) in the M1 script: reasons cite the first citable blocks of the prompt. */
export function m1DecisionAnswer(text: string): unknown {
  const workspace = /## 本 Workspace：(.+)/.exec(text)?.[1]?.trim() ?? M1_WORKSPACES[0];
  const citable = [...text.matchAll(/^- (\[\[[^\]]+#\^c\d+\]\])（([^）]*)）/gm)].filter((m) => !m[2].includes('不能当理由')).map((m) => m[1]);
  if (citable.length === 0) throw new Error('mock model (M1): the decision prompt lists nothing citable');
  const pick = (source: RegExp, i: number) => citable.find((l) => source.test(l)) ?? citable[i] ?? citable[0];
  const affects = [...text.matchAll(/^- (\[\[[^\]]+\]\])（Workspace）/gm)].map((m) => m[1]).filter((l) => l.includes('L2 凭什么赢'));
  return {
    name: `${workspace}决定-跨设备先按场景验证`,
    ...M1_DECISION,
    // v6 2.11: each reason cites the source that says it (the 24% is Pew's, the 80 PCs Lenovo's, the 33% Ping's)
    reasons: [
      { kind: '事实', text: '公开证据只证明 AI 采用广泛，天天用的人少', cites: [pick(/Pew/, 0)] },
      { kind: '推断', text: '跨设备的价值只集中在少数场景，所以先按场景验证', cites: [pick(/Qira|联想/, 1)] },
      { kind: '推断', text: '用户接受辅助建议多于自主执行，授权要分层', cites: [pick(/Ping/, 2)] },
    ],
    counter: ['报告专门找过反证，没有找到 A/B 级的'],
    gaps: ['跨设备与单设备用户的留存差异（需产品数据）', '个人上下文的增量（需同任务实验）'],
    reconsider: ['Qira 产品数据显示跨设备用户的留存明显高于单设备用户'],
    affects: affects.slice(0, 1),
  };
}

// ── 2.7 联网补查：S10、S12 ─────────────────────────────────────────────────

export interface M1WebPage {
  url: string;
  title: string;
  site_name: string;
  date: string;
  content: string;
}

const MOCK_WEB_DIR = path.join(process.cwd(), 'tests/fixtures/mock-web');

/** The fetched text of a mock-web fixture note (its 抓取原文 section). */
function pageOf(file: string): M1WebPage {
  const raw = readFileSync(path.join(MOCK_WEB_DIR, file), 'utf8');
  const field = (k: string) => new RegExp(`^${k}: "?([^"\\n]*)"?$`, 'm').exec(raw)?.[1] ?? '';
  const content = raw.split(/^## 抓取原文\s*$/m)[1]?.replace(/^\s*>.*\n/m, '').trim() ?? '';
  return { url: field('url'), title: file.replace(/\.md$/, ''), site_name: field('publisher'), date: `${field('published')}T00:00:00Z`, content };
}

export const M1_WEB_FILES = ['Recon Analytics 2026-10 AI 用户切换工具.md', 'Gartner 2026-05 消费者要 AI 帮忙购物，不要 AI 替自己下单.md'] as const;

/** A page the vault already holds (a search may find it again; the run reuses the note instead of fetching it). */
const inVault = (url: string, title: string, site_name: string): M1WebPage => ({ url, title, site_name, date: '2026-06-17T00:00:00Z', content: '' });

/**
 * T55: what each web query of the M1 claim table (m1-execution.ts) finds. S10 and S12 are new pages; the two cross-device
 * rounds of C1 find only Pew pages already in the vault, which say nothing about cross-device retention, so two rounds in
 * a row bring no new evidence and the stop rule ends the search. Any other query finds nothing.
 */
const M1_WEB_RESULTS: Record<string, () => M1WebPage[]> = {
  'cross-device continuity retention study': () => [inVault('https://www.pewresearch.org/internet/2026/06/17/how-opinions-and-use-of-ai-differ-by-age/', 'How Opinions and Use of AI Differ by Age', 'Pew Research Center')],
  'cross-device single-device user retention comparison': () => [inVault('https://www.pewresearch.org/internet/2026/06/17/why-dont-people-use-chatbots/', 'Why Don’t People Use Chatbots', 'Pew Research Center')],
  'AI users switching primary AI tool': () => [pageOf(M1_WEB_FILES[0])],
  'consumers let AI make purchase decisions survey': () => [pageOf(M1_WEB_FILES[1])],
};

/** The sentences an M1 page's fixture note quotes (「…」 lines): what the M1 model extracts from that page. */
export function m1PageQuotes(title: string): { quote: string; location: string }[] | null {
  const file = M1_WEB_FILES.find((f) => f.replace(/\.md$/, '') === title);
  if (!file) return null;
  const raw = readFileSync(path.join(MOCK_WEB_DIR, file), 'utf8');
  return [...raw.matchAll(/^- 「(.+?)」— 位置：(.+?) \^c\d+$/gm)].map((m) => ({ quote: m[1], location: m[2] }));
}

/** The public pages an M1 web query finds (null outside the M1 demo, so the generic mock answers). */
export function m1WebPages(query: string): M1WebPage[] | null {
  if (!isM1('')) return null;
  return M1_WEB_RESULTS[query]?.() ?? [];
}

export function m1WebPageByUrl(url: string): M1WebPage | null {
  if (!isM1('')) return null;
  return M1_WEB_FILES.map(pageOf).find((p) => p.url === url) ?? null;
}

// ── 2.1 新建项目：决策契约和议题树（T33，和 m1-qira 快照里的一致）──────────────────

export const M1_CONTRACT = {
  question: '联想应在个人 AI 中占据什么战略位置？2027 年应优先投入哪些方向？',
  decision: '战略定位、优先机会、资源配置',
  decision_owner: '智能设备业务群 · 个人 AI 战略与产品管理层',
  horizon: '2027 行动；展望 2028–2030',
  geography: '全球；中国单独分析',
  product_scope: 'PC、手机、平板、可穿戴及连接它们的个人 AI 服务',
  out_of_scope: ['企业级 AI 基础设施', '基础模型研发'],
  success: '能决定 2027 年的投入方向',
  known: ['联想 2026 年 1 月已发布 Qira'],
  bar: '关键判断至少 2 个独立来源',
};

export const M1_ISSUE_TREE = {
  question: M1_CONTRACT.question,
  lines: [
    {
      id: 'A',
      title: '市场如何演进',
      question: '什么决定竞争成败？',
      owner: 'junior-a',
      items: [
        { id: 'M1', title: '哪些用户会持续使用' },
        { id: 'M2', title: '体验与支撑技术' },
        { id: 'M3', title: '竞争格局与产业经济' },
        { id: 'M4', title: '2027 至 2030 情景' },
      ],
    },
    {
      id: 'B',
      title: '联想如何选择',
      question: '联想凭什么赢？',
      owner: 'junior-b',
      items: [
        { id: 'L1', title: '在哪里竞争' },
        { id: 'L2', title: '凭什么赢', waits_for: ['M1'] },
        { id: 'L3', title: '如何捕获价值' },
        { id: 'L4', title: '2027 年做什么' },
      ],
    },
  ],
};
