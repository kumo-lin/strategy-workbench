/**
 * D-56 ⑤b: the 访谈建议 card — who the owner should interview, what to ask, and what to do next. Assembled by code
 * from what the judgment already holds (each claim's expert_questions and its 待验证 assertions); no model call.
 * Pure.
 */
import { cell } from './report';

export interface InterviewAsk {
  claimLabel: string;
  who: string;
  /** The model named who to ask (the question began "问X："); false = code picked it from the perspective. */
  whoFromModel: boolean;
  question: string;
}

const oneLine = (s: string) => s.replace(/\s*\n\s*/g, ' ').trim();

/** `问<who>：<question>` / `问 <who>: <question>` → who + question; anything else stays one plain question. */
const WHO_QUESTION = /^\s*问\s*([^：:]+?)\s*[：:]\s*(\S.*)$/;

export function parseExpertQuestion(q: string): { who: string | null; question: string } {
  const m = WHO_QUESTION.exec(q);
  const who = m?.[1].trim() ?? '';
  const question = m?.[2].trim() ?? '';
  return who && question ? { who, question } : { who: null, question: q.trim() };
}

/** Default interviewee by the sub-question's / claim's perspective (first one that has an entry), else '熟悉这个问题的业内人士'. */
export const DEFAULT_WHO: Record<string, string> = {
  买方: '企业 IT / 采购负责人',
  竞争对手: '熟悉竞品的渠道或行业分析师',
  我方自身的布局: '联想商用产品 / 方案服务的负责人',
  监管: '受监管行业的合规负责人',
  技术供给: '芯片 / OS / 平台厂商的产品或技术负责人',
  目标用户: '目标用户本人',
  渠道与媒介: '渠道或媒介负责人',
  竞品: '熟悉竞品的行业分析师',
  品牌: '品牌负责人',
  监管与合规: '合规负责人',
  // v6 2.14's perspective list for 战略部 (a consumer study): the people a personal-AI question can be asked of.
  用户: '多设备重度用户',
  竞争: '熟悉竞品的行业分析师',
  经济性: '负责投入产出的业务负责人',
  中国市场: '中国市场的一线销售或渠道负责人',
};

export function defaultWho(perspectives: string[] | undefined): string {
  for (const p of perspectives ?? []) {
    const who = DEFAULT_WHO[p.trim()];
    if (who) return who;
  }
  return '熟悉这个问题的业内人士';
}

/** "核实「…」（H2-A2 待验证：只有 1 个独立来源）": the wording the claim section's 要问专家 line uses too. */
export function unverifiedAsk(a: { key: string; text: string; basis: string }): string {
  return `核实「${oneLine(a.text)}」（${a.key} 待验证：${a.basis}）`;
}

export interface InterviewClaim {
  label: string;
  perspectives?: string[];
  expertQuestions: string[];
  unverified: { key: string; text: string; basis: string }[];
}

/** One ask per expert question and per 待验证 assertion, in claim order; duplicates (same question text) once. */
export function interviewAsks(claims: InterviewClaim[]): InterviewAsk[] {
  const out: InterviewAsk[] = [];
  const seen = new Set<string>();
  const add = (ask: InterviewAsk) => {
    if (seen.has(ask.question)) return;
    seen.add(ask.question);
    out.push(ask);
  };
  for (const c of claims) {
    const fallback = defaultWho(c.perspectives);
    for (const q of c.expertQuestions) {
      const parsed = parseExpertQuestion(q);
      add({ claimLabel: c.label, who: parsed.who ?? fallback, whoFromModel: parsed.who !== null, question: parsed.question });
    }
    for (const a of c.unverified) add({ claimLabel: c.label, who: fallback, whoFromModel: false, question: unverifiedAsk(a) });
  }
  return out;
}

export const NEXT_STEP = '约访 → 把访谈记录放进“文件” → 用访谈更新这份报告（追加调查）';

/** The section's lines (markdown), or [] when there is no ask. */
export function renderInterviewCard(asks: InterviewAsk[]): string[] {
  if (!asks.length) return [];
  return [
    '## 访谈建议',
    '- 找谁 · 问什么（AI 提议，约不约、问不问由人定）：',
    '',
    '| 找谁 | 问什么 | 对应 |',
    '|---|---|---|',
    ...asks.map((a) => `| ${cell(`${a.who}${a.whoFromModel ? '' : '（按视角推荐）'}`)} | ${cell(a.question)} | ${cell(a.claimLabel)} |`),
    '',
    `- 下一步：${NEXT_STEP}`,
  ];
}
