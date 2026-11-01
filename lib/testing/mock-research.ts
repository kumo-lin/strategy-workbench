/**
 * Scripted answers for the orchestrated Deep Research model steps (lib/research/llm.ts: JSON in,
 * JSON out). Each step is recognised by a marker in its prompt, so the script follows the real
 * prompts (lib/harness/prompts/research-execute.ts) rather than a call counter. E2E only.
 */
import { m1ExecutionAnswer } from './scripts/m1-execution';
import { taskOf } from './mock-contract';
import { isM1, M1_INTERVIEW_HITS, M1_JUDGMENT, M1_KEYWORDS, m1DecisionAnswer, m1SummaryAnswer, m1TreeAnswer } from './scripts/m1';

/** The first pack id a tree prompt lists under `## 参考资料` (a `- K4《…》` line), or null when that section says nothing matched. */
function firstReferenceId(text: string): string | null {
  const lines = text.split('\n');
  const at = lines.findIndex((l) => /^## 参考资料/.test(l.trim()));
  if (at < 0) return null;
  for (const line of lines.slice(at + 1)) {
    if (/^##\s/.test(line.trim())) break;
    if (line.includes('（没有命中的资料')) return null;
    const m = /^-\s*(K\d+)《/.exec(line.trim());
    if (m) return m[1];
  }
  return null;
}

/** The tree of step ④ (lib/workplan/compose/tree.ts): 3 first-level sub-questions, 4 hypotheses; it must pass checkTree for a big question. */
/** The holistic judgment (and its revision): free text, long enough for the code's minimum. */
function workplanJudgmentAnswer(): string {
  return [
    '核心问题不是企业愿不愿意为 AI 付费，而是谁在采购里有否决权：如果 IT 部门能否决，可管理性就比价格更先决定能不能进短名单。',
    '竞争假设一：IT 能管才买单，可管理性排在价格之前；假设二：价格仍是第一位，可管理性只是加分项；假设三：业务部门自带预算，绕开 IT 采购。',
    '关键的不确定性有三件：采购标准里可管理性与价格的先后；预算由谁批；企业会不会为管理能力单独付钱。三件事的答案不同，押注的方向就不同。',
    '容易被忽略的解释：企业换机主要是系统到期，不是为了 AI，所以"AI 带来的溢价"本身可能不存在。',
    '最值得先验证：先看采购文件里把什么排在前面，这一步成本最低，也最能区分前两个假设。',
  ].join('\n');
}

/** The evaluator's answer: every question answered "没问题" with a reason (the code's gate needs one per question). */
function workplanEvalAnswer(): unknown {
  return { answers: [1, 2, 3, 4, 5, 6].map((q) => ({ q, verdict: '没问题', target: '', counterexample: '草案已经把竞争假设、关键不确定性和最先验证的事分开写了', fix: '' })) };
}

function workplanTreeAnswer(text: string): unknown {
  const core = (/^要回答的问题：(.*)$/m.exec(text)?.[1] ?? '').trim() || '企业买单的首要条件是不是 IT 能管？';
  const known = firstReferenceId(text);
  const leaf = (question: string, statement: string, short: string, knownBy: string[] = []) => ({
    question,
    hypothesis: {
      statement,
      falsifier: '采购文件里把可管理性排在价格之后',
      conditions: ['条件一'],
      known_by: knownBy,
      to_verify: [{ what: '查采购标准', where: '上网', support: '写明门槛', counter: '招标书' }],
      short,
    },
  });
  return {
    core_question: core,
    decision_options: '押、不押',
    day1_answer: '假设：IT 能管才付费',
    split_basis: '按决策选项拆，三个子问题合起来够回答核心问题',
    subquestions: [
      // D-64 T21: a tree marks 1–4 key questions
      { ...leaf('企业采购时谁拍板？', '拍板的是 IT 部门', 'IT 拍板', known ? [known] : []), knockout: true, ifBad: '不再按 IT 买方去设计卖点' },
      {
        question: '钱从哪里出？',
        children: [leaf('预算是不是来自 IT 部门？', '预算来自 IT 部门', 'IT 出钱'), leaf('会不会为管理能力单独付钱？', '会为管理能力单独付钱', '单独付费')],
      },
      leaf('什么条件下才批准采购？', '满足了管理门槛才批准', '管理门槛'),
    ],
    key_message: 'IT 能管，企业才买单',
    risks: ['价格可能比管理能力更重要'],
    next_actions: ['Junior 先查 Q1 的采购标准'],
  };
}

/** M3 "起草决定" (task decision_draft): reasons cite the first two blocks the prompt lists as citable, affects points at WS-B. */
function answerDecisionStep(text: string): unknown {
  const workspace = /## 本 Workspace：(.+)/.exec(text)?.[1]?.trim() ?? 'WS';
  const citable = [...text.matchAll(/^- (\[\[[^\]]+#\^c\d+\]\])（([^）]*)）/gm)].filter((m) => !m[2].includes('不能当理由')).map((m) => m[1]);
  if (citable.length === 0) throw new Error('mock model: the decision prompt lists nothing citable');
  const affects = [...text.matchAll(/^- (\[\[[^\]]+\]\])（Workspace）/gm)].map((m) => m[1]).filter((l) => /WS-B/.test(l));
  return {
    name: `${workspace}决定-先打IT管理场景`,
    decision: '1. 买方侧先验证 IT 管理场景。\n2. 不以 NPU 溢价作为买单理由。',
    reason: 'IT 部门主导采购，管理要求排在前面。',
    scope: '适用于企业买方的 AI PC 采购；不适用于个人用户。',
    reasons: [
      { kind: '事实', text: 'IT 部门在企业采购 AI PC 时主导决策', cites: [citable[0]] },
      { kind: '推断', text: '所以买方侧应先验证 IT 管理场景', cites: [citable[1] ?? citable[0]] },
    ],
    counter: ['报告专门找过反证，没有找到 A/B 级的'],
    gaps: ['缺少预算口径：要问 IT 负责人预算由谁批'],
    reconsider: ['出现 A/B 级调研显示价格才是首要条件'],
    affects: affects.slice(0, 1),
  };
}

/** The Summary (task summary): so_what cites the first evidence key; a question tree also gets its answers. */
function summaryAnswer(text: string): unknown {
  const k = /\[(E\d+)\]/.exec(text)?.[1];
  const cite = k ? ` [${k}]` : '';
  // the hypotheses the prompt lists (`- H1 …` / `- H2-1 …`, then →) and, for a question tree, the top-level sub-questions that were run
  const labels = [...text.matchAll(/^- (H\d+(?:-\d+)?) .* → /gm)].map((m) => m[1]);
  const asked = [...text.matchAll(/^- (Q\d+) .*：这次查了/gm)].map((m) => m[1]);
  return {
    ...(asked.length ? { answers: asked.map((id) => ({ id, answer: `IT 部门主导采购，管理要求排在前面${cite}` })), sufficiency: '这个子问题的回答足以回答核心问题：少了它就不知道企业买单先看什么。' } : {}),
    so_what: `买方的关键是 IT 可管理性${cite}`,
    ...(asked.length ? { split_basis: '按采购的先后拆：先看谁拍板，再看按什么放行' } : {}),
    results: (labels.length ? labels : ['H1']).map((l) => `${l} → 成立（提议）：多家独立来源支持`),
    workplan_impact: [`和 IT 负责人对齐管理需求${cite}`],
    // D-64 T23: the report's fixed structure
    reasons: [
      { title: 'IT 部门决定准入', basis: [{ text: 'IT 部门主导采购', kind: '事实', source: '资料库', refs: k ? [k] : [] }] },
      { title: '管理要求排在前面', basis: [{ text: '可管理性先于价格被考虑', kind: '推断', source: '资料库', refs: [] }] },
    ],
    gaps: [{ question: '预算由谁批？', missing: '公开资料没有预算口径', how: '访谈 IT 负责人' }],
    recommendations: [{ title: '先打 IT 管理场景', how: '先找管理要求严格的企业试点', refs: [labels[0] ?? 'H1'] }],
  };
}

const SUPPORT_QUERIES = { kb_queries: ['IT 可管理性', 'IT 部门', '预算'], web_queries: ['企业 AI PC 采购 IT 部门', 'AI PC 企业 IT 管理'] };

/**
 * Which prompt each branch below answers, and the text in it that identifies it. If one of these prompts changes its
 * marker or its JSON shape (or a new model call is added), this file must follow, or the e2e report is not delivered.
 *   lib/harness/prompts/research-execute.ts
 *     queryPlanPrompt 「请给出两组查询」 (「专门找**反证**」 = the counter round)   → kb_queries / web_queries
 *     extractPrompt   「页面文本开始」                                              → claims[{quote, location}]
 *     evaluatePrompt  「论断列表：」                                               → items[{id, stance, ...}]
 *     judgePrompt     「请提出判断」                                               → the judgment JSON (judgmentSchema); D-48 「逐条判上面"必须成立的条件"」 → conditions, 「- answer：」 → answer / reasons / short_statement
 *     responsesPrompt 「请逐条回应这几条反驳」 (many refutes: after the verdict)     → challenge_responses for its keys
 *     summaryPrompt   任务：写 Summary（T19）                                       → so_what / results / workplan_impact (+ answers / sufficiency / split_basis in a question-tree report)
 *     queryPlanPrompt focus gap  任务：补缺检索（T19）                              → the support queries
 *     citationVerifyPrompt 任务：核验引用（T19）                                    → every pair 撑得住
 *   lib/research/interview-followup.ts 任务：判断访谈影响（T25）                     → { claims, reason }
 *     recommendPrompt 「写"AI 的推荐判断（提议，待人拍板）"」                         → recommendationSchema (own call since M2 60f7593)
 *     shortenPrompt   「下面这几处超过了字数上限」                                    → items echoed as they were
 *     repairPrompt    「系统自检没有通过」                                          → echoes the JSON it was given
 *   lib/decisions/draft.ts  decisionPrompt, 任务：起草决定（T19, M3）
 *   lib/workplan/compose (D-56 ③ v2)  任务：定拆法 / 拆 workplan / 评审拆题 / 修补拆题 → the compose pipeline's JSON
 */
/**
 * D-64 T25 (task interview_affects): an M1 interview touches the judgments of its key questions (M1_INTERVIEW_HITS);
 * any other interview the first judgment listed.
 */
function interviewAffectsAnswer(text: string): unknown {
  const name = /^## 访谈：(.+)$/m.exec(text)?.[1]?.trim();
  const listed = [...text.matchAll(/^- (\S+?)（[^，）]+(?:，(K\d))?）/gm)].map((m) => ({ id: m[1], key: m[2] }));
  const hit = M1_INTERVIEW_HITS.find((h) => h.interview === name);
  if (!hit) return { claims: listed.slice(0, 1).map((c) => c.id), reason: '访谈提到了这个判断' };
  const says = hit.says as Record<string, string>;
  const said = (c: { id: string; key?: string }) => says[c.id] ?? says[c.key ?? ''] ?? '';
  const claims = listed.filter((c) => c.key && (hit.keys as readonly string[]).includes(c.key) && said(c));
  return { claims: claims.map((c) => c.id), reason: hit.reason, by_claim: Object.fromEntries(claims.map((c) => [c.id, said(c)])) };
}

export function answerResearchStep(text: string): unknown {
  // The compose pipeline (D-56 ③ v2) is keyed on the `任务：` line of its system prompt, like every orchestrated call.
  const task = taskOf(text);
  // D-64 T54: the M1 demo (m1-qira vault) gets the explanation document's content
  if (task && isM1(text)) {
    if (task === 'workplan_keywords') return { queries: M1_KEYWORDS };
    if (task === 'workplan_judgment' || task === 'workplan_revise') return M1_JUDGMENT;
    if (task === 'workplan_tree') return m1TreeAnswer(text);
    if (task === 'summary') return m1SummaryAnswer(text);
    if (task === 'decision_draft') return m1DecisionAnswer(text);
  }
  if (isM1(text)) {
    const answer = m1ExecutionAnswer(text);
    if (answer !== undefined) return answer;
  }
  if (task === 'workplan_keywords') return { queries: ['企业 AI PC 采购', 'IT 可管理性', 'enterprise AI PC adoption'] };
  if (task === 'workplan_judgment') return workplanJudgmentAnswer();
  if (task === 'workplan_eval') return workplanEvalAnswer();
  if (task === 'workplan_revise') return workplanJudgmentAnswer();
  if (task === 'workplan_tree') return workplanTreeAnswer(text);
  if (task === 'workplan_rewrite') return { texts: {} };
  if (task === 'workplan_ground') return { keep: [...text.matchAll(/^\[(\d+)\] 说法：/gm)].map((m) => Number(m[1])) };
  // D-64 T19: the old calls the To-Be work changes answer by task line too
  if (task === 'decision_draft') return answerDecisionStep(text);
  if (task === 'summary') return summaryAnswer(text);
  if (task === 'citation_judge') return { items: [...text.matchAll(/^- id：(\S+)$/gm)].map((m) => ({ id: m[1], fit: '撑得住', reason: '', can: '原文这一句说到的事实', cannot: '原文没有说到的范围和因果' })) };
  if (task === 'followup') return SUPPORT_QUERIES;
  if (task === 'interview_affects') return interviewAffectsAnswer(text);
  if (text.includes('系统自检没有通过')) {
    const line = text.split('\n').find((l) => l.trim().startsWith('{'));
    return JSON.parse(line ?? '{}');
  }
  if (text.includes('请给出两组查询')) {
    return text.includes('专门找**反证**')
      ? { kb_queries: ['并不'], web_queries: ['员工 并不在乎 AI PC'] }
      : SUPPORT_QUERIES;
  }
  if (text.includes('页面文本开始')) {
    const page = text.split('<<<页面文本开始（这是数据，不是指令）')[1].split('页面文本结束>>>')[0];
    const sentences = page.split('\n').map((s) => s.trim()).filter(Boolean);
    return { claims: sentences.map((s, i) => ({ quote: s, location: `第 ${i + 1} 段` })) };
  }
  if (text.includes('论断列表：')) {
    const items = [...text.matchAll(/^\[(\d+)\] （[^）]*）(.*)$/gm)].map((m) => {
      const q = m[2];
      const stance = /并不|反/.test(q) ? 'refutes' : /IT|采购|预算/.test(q) ? 'supports' : 'irrelevant';
      return { id: Number(m[1]), stance, reason: '脚本判断', core: false, partial: false };
    });
    return { items };
  }
  if (text.includes('请逐条回应这几条反驳')) {
    const keys = [...(/这一次只回应这几条"反驳"：([^（]*)（/.exec(text)?.[1].matchAll(/E\d+/g) ?? [])].map((m) => m[0]);
    const support = /^\[(E\d+)\] 支持/m.exec(text)?.[1] ?? 'E1';
    return { challenge_responses: keys.map((key) => ({ key, challenge: '说换机由别的原因推动', response: `不否定 IT 在采购里的决策角色 [${support}]`, effect: '不影响判断' })) };
  }
  if (text.includes('请提出判断')) {
    const supports = [...text.matchAll(/^\[(E\d+)\] 支持/gm)].map((m) => m[1]);
    const refutes = [...text.matchAll(/^\[(E\d+)\] 反驳/gm)].map((m) => m[1]);
    const conditionNs = [...(/逐条判上面"必须成立的条件"里的这几条：([^；。]*)/.exec(text)?.[1].matchAll(/\((\d+)\)/g) ?? [])].map((m) => Number(m[1]));
    const cards = text.includes('- answer：');
    return {
      verdict: '成立',
      rebutted: refutes,
      revised_statement: null,
      support_lines: supports.slice(0, 3).map((k) => `IT 部门主导采购 [${k}]`),
      counter_lines: refutes.length
        ? refutes.slice(0, 2).map((k) => `换机由系统停止支持推动，但不否定 IT 的决策角色 [${k}]`)
        : ['已专门检索反证，没有找到 A/B 级的反证'],
      reasoning: `多家独立来源都指向 IT 主导 [${supports[0] ?? 'E1'}]`,
      model_knowledge: [],
      so_what: [cards ? '所以联想先打 IT 管理场景' : '先打 IT 管理场景'],
      gaps: ['缺少预算口径'],
      expert_questions: ['预算由谁批？'],
      // D-48: a question-tree hypothesis judges the plan conditions it is asked for, each on the supports, and writes its card
      ...(conditionNs.length
        ? { conditions: conditionNs.map((n) => ({ n, status: '成立', keys: supports.slice(0, 4), note: '' })), changed: '没改' }
        : {}),
      ...(cards
        ? {
            answer: `IT 部门主导采购 [${supports[0] ?? 'E1'}]`,
            reasons: supports.slice(0, 2).map((k) => `IT 部门主导采购 [${k}]`),
            short_statement: 'IT 主导采购',
          }
        : {}),
    };
  }
  // Step 9b, "AI 的推荐判断" (M2: recommendPrompt in lib/harness/prompts/research-execute.ts, marker 「写"AI 的推荐判断（提议，待人拍板）"」).
  // Its own model call since M2 60f7593. The self-check (recommendationGaps in lib/research/report.ts) fails the report unless the
  // answer has: a decision_answer, a BUSINESS action (not a research step), a scale marked 推断 with its basis, metrics, alternatives
  // with >=1 dimension=layer and build/partner/buy all covered on dimension=acquire (action_kind counts as one), and change_if.
  // No bare numbers outside the scale estimate.
  // A question tree (D-48 第 2 轮) asks each cell as "<结论>。依据：…".
  if (text.includes('写"AI 的推荐判断（提议，待人拍板）"')) {
    const basis = text.includes('每一格先写一句结论') ? `。依据：IT 部门主导采购${/\[(E\d+)\]/.exec(text) ? ` [${/\[(E\d+)\]/.exec(text)![1]}]` : ''}` : '';
    return {
      decision_answer: `提议：联想先押管理和安全这一层，用合作的方式拿到能力${basis}`,
      action: `联想商用产品线与一家管理软件厂商合作，把设备管理能力预装并作为商用 AI PC 的卖点推出${basis}`,
      action_kind: '合作',
      scale: '先在少数重点客户里试点，由一个小团队负责，周期几个月',
      scale_inferred: true,
      scale_basis: '按只做小范围试点估算，没有直接的投入数据',
      metrics: ['试点客户的 IT 是否把管理能力列为采购条件', '试点中是否出现价格比管理更重要的说法'],
      alternatives: [
        { dimension: 'layer', option: '押端侧算力这一层', kind: '其他', why_not: '现有证据只说明 IT 关心管理，没有说明算力能带来溢价' },
        { dimension: 'acquire', option: '自己研发一套管理工具', kind: '自研', why_not: '证据还不足以支撑自研的投入，先借合作验证' },
        { dimension: 'acquire', option: '收购一家管理软件公司', kind: '收购', why_not: '不适用：证据远不够支撑收购这样的投入' },
      ],
      change_if: ['出现 A/B 级调研显示价格才是首要采购条件'],
    };
  }
  // D-48 第 5 轮 conclusionPrompt 「下面是各子问题已经定稿的回答」: the first answer's first clause, tagged with it
  if (text.includes('下面是各子问题已经定稿的回答')) {
    const a = /^- (Q\d+(?:-\d+)?)：(.*)$/m.exec(text);
    const first = a ? a[2].split(/[；。]/)[0].trim() : '还答不了';
    return { so_what: `${first}${a ? `[${a[1]}]` : ''}`, decision_answer: `提议：联想先押管理和安全这一层，用合作的方式拿到能力${a ? `[${a[1]}]` : ''}。依据：${a ? `${a[1]} 的回答[${a[1]}]` : '各子问题的回答'}` };
  }
  // D-48 第 3 轮 citationFitPrompt 「逐项判断：原文撑不撑得住」: every footnote holds; citationRepairPrompt then never comes
  if (text.includes('逐项判断：原文撑不撑得住')) {
    return { items: [...text.matchAll(/^- id：(\S+)$/gm)].map((m) => ({ id: m[1], fit: '撑得住', reason: '' })) };
  }
  if (text.includes('有一个脚注挂错了')) return { items: [] };
  // D-48 shortenPrompt 「下面这几处超过了字数上限」: the scripted texts are short; anything sent comes back as it was
  if (text.includes('下面这几处超过了字数上限')) {
    return { items: [...text.matchAll(/^- id：(\S+)（[^）]*）：(.*)$/gm)].map((m) => ({ id: m[1], text: m[2] })) };
  }
  throw new Error('mock model: unrecognised orchestrated prompt');
}
