/**
 * The five workplan chat eval questions (D-56 3c) and what to answer when the assistant asks. The text is fixed so
 * runs are comparable; the runner that asks them is a separate spec (m1_3d).
 */
export interface EvalQuestion {
  id: 1 | 2 | 3 | 4 | 5;
  /** Short label shown in the results. */
  title: string;
  /** The user's first message, exactly as written below. */
  text: string;
  /** What to answer when the assistant asks a card question (ask_user) or any follow-up. */
  answer: {
    /** Choose the first option whose label matches; else the confirm option, the typed text, then the first option. */
    pickLabel?: RegExp;
    /** Used when there are no options. */
    text?: string;
  };
  /** The most ask_user cards a good run needs; the check "问题数不超过 N" uses it. */
  maxAsks: number;
  /** One line in Chinese: what a good run does (shown to the human judges). */
  expectation: string;
  /** Which extra rule checks apply (the runner uses these). */
  extra: ('askedBeforeDraft' | 'referencesDirective' | 'doubtMarker' | 'knownNotToVerify')[];
}

export const EVAL_QUESTIONS: readonly EvalQuestion[] = [
  {
    id: 1,
    title: '题目清楚',
    text: '2026–2027 年，有统一机队管理的大中型企业，会为员工端侧个人 AI 的哪一部分付钱、按什么条件付？我想判断联想明年该押管理栈还是端侧算力。',
    answer: { text: '按你推荐的来。' },
    maxAsks: 2,
    expectation: '4 个槽第一句里都有了，不该追问（最多一张确认卡）；拆出的树有按采购决策链或付钱对象分层的维度，扎根在参考库的资料上。',
    extra: [],
  },
  {
    id: 2,
    title: '题目含糊',
    text: '帮我看看 AI PC 这件事到底怎么样。',
    answer: { text: '我想判断联想明年要不要在商用 AI PC 上押管理栈，对象是大中型企业的 IT 采购。' },
    maxAsks: 4,
    expectation: '4 个槽全空，第一步必须追问最卡的那一项（判断或对象），不能一次端出问卷；回答后的拆法和第 1 题一样。',
    extra: ['askedBeforeDraft'],
  },
  {
    id: 3,
    title: '跨领域',
    text: '内存涨价让整机贵了不少，这会怎么改变大企业明年的换机和采购方式？联想要不要借这个机会，把更多客户转到 TruScale 设备即服务上？',
    answer: { text: '对象是有统一机队管理的大企业；要判断的是明年要不要把 DaaS 当商用的主推方式。先按你推荐的来。' },
    maxAsks: 3,
    expectation: '按因果链（成本、客户的反应、联想的机会、联想自己的账）把供应链、企业采购和服务业务串成一条线，不是三块各写各的；不绕回端侧 AI。',
    extra: [],
  },
  {
    id: 4,
    title: '和方针冲突、前提可疑',
    text: '员工肯定愿意为 AI 单独付钱。我想明年推一个直接卖给员工个人的 AI 订阅，你帮我拆一下怎么做。',
    answer: { pickLabel: /要不要做|先判断|先验证/, text: '我还是想看看这条路，员工已经在自己用 AI 了。' },
    maxAsks: 5,
    expectation: '明说两处冲突（业务方针第 6 条不做卖给员工个人的订阅；高层周会里决定权在 IT），并指出"肯定愿意"没有证据；不直接按"怎么做"去拆。',
    extra: ['referencesDirective', 'doubtMarker'],
  },
  {
    id: 5,
    title: '很小的题',
    text: '企业 IT 现在能不能把 Windows 11 里自带的 Copilot 统一卸掉？',
    answer: { text: '想知道如果客户的 IT 不想要微软的 AI 助手，我们的 Qira 有没有机会。' },
    maxAsks: 3,
    expectation: '先问一句"你问这个是为了判断什么"；"IT 能卸载 Copilot"这条事实参考库里有，必须写在"已经知道的"，不能写成"还要去证实"；树最多 3 个子问题。',
    extra: ['knownNotToVerify'],
  },
];
