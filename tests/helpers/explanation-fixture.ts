/** T40 supplementary fixtures: valid reports with version-bound judgments, no model or production vault writes. */
export const EX_WS = '20_项目/P/WS-A';
export const EX_DIR = `${EX_WS}/调查/R1`;
export const EX_PLAN = `${EX_DIR}/计划 v1.md`;
export const EX_REPORT = (v: number) => `${EX_DIR}/报告 v${v}.md`;
const common = (id: string, type: string, extra: string, body: string) => `---\nid: ${id}\ntype: ${type}\nstatus: 进行中\ncreated: "2026-10-28"\nupdated: "2026-10-28"\nauthor: AI\nderived_from: ["[[团队]]"]\nrelates_to: ["[[团队]]"]\n${extra}\n---\n${body}\n`;
export const explanationPlan = (v = 1, key = 'K3') => common(`plan-${v}`, 'research_plan', `version: ${v}\nquestion: 跨设备是否带来增量？\npurpose: 决定下一步验证\napproved_by_owner: Junior A\napproved_at: "2026-10-28"\nexploratory: false\nclaims:\n  - { id: C1, statement: 跨设备有增量, key: ${key}, hypothesis: null, conditions: [需要留存数据], sub_questions: [{ id: C1-Q1, question: 留存差异是多少？, methods: [知识库] }], counter_search: 寻找没有增量的证据 }\n  - { id: C2, statement: 已证实的判断, key: K1, hypothesis: null, conditions: [有公开数据], sub_questions: [{ id: C2-Q1, question: 有什么反证？, methods: [知识库] }], counter_search: 寻找反证 }`, `# 调查计划 v${v}`).replace('status: 进行中', 'status: 已确认');
export const explanationReport = (v: number) => common(`report-${v}`, 'report', `version: ${v}\nresearch_plan: "[[${EX_PLAN.replace(/\.md$/, '')}|计划 v1]]"\nmode: team\nexploratory: false\ndelivery: 已交付\nverdicts_proposed: { C1: ${v === 1 ? '证据不足' : '访谈支持'}, C2: 成立 }`, `# 调查报告 v${v}\n\n## So what\n\n先验证高频场景。\n\n## 缺乏信息、需要另外验证的问题\n\n| 问题 | 公开资料缺什么 | 怎么验证 |\n|---|---|---|\n| K3 跨设备是否有增量？ | 没有跨设备与单设备用户的留存对比 | 产品数据 |\n\n## 访谈建议\n\n| 找谁 | 问什么 | 对应 |\n|---|---|---|\n| 产品分析负责人 | 留存差异是多少？ | H1 |\n${v === 2 ? '\n## 因为追加了访谈，结论变了什么\n\n| | v1 | v2 |\n|---|---|---|\n| K3 | 证据不足 | 访谈支持 |\n\n- 追加的访谈：[[20_项目/P/访谈/用户|用户]]（模拟访谈）\n' : ''}`);
export const explanationJudgment = (v = 2) => ({
  report: `报告 v${v}.md`, keyed: { E1: '[[资料甲#^c1]]' },
  claims: [
    { claimId: 'C1', label: 'H1', verdict: v === 1 ? '证据不足' : '访谈支持', conditions: [], judgment: { verdict: '证据不足', rebutted: [], revised_statement: null, support_lines: [], counter_lines: [], challenge_responses: [], model_knowledge: [], so_what: ['先验证'], reasoning: '旧条件，未重新核验', gaps: ['没有可核对的留存数字'], expert_questions: ['请产品分析负责人提供留存数据'] } },
    { claimId: 'C2', label: 'H2', verdict: '成立', conditions: [], judgment: { verdict: '成立', reasoning: '原报告的已确认依据', rebutted: [], revised_statement: null, support_lines: [], counter_lines: [], challenge_responses: [], model_knowledge: [], so_what: ['沿用'], gaps: [] as string[], expert_questions: [] as string[] } },
  ],
  summary: { so_what: '先验证', results: ['H1 → 证据不足', 'H2 → 成立'], workplan_impact: [], gaps: [{ question: 'K3 跨设备是否有增量？', missing: '没有跨设备与单设备用户的留存对比', how: '获取同口径的产品留存数据' }] },
});
export const explanationFiles = (): Record<string, string> => ({
  [EX_PLAN]: explanationPlan(), [`${EX_DIR}/计划 v2.md`]: explanationPlan(2, 'K4'),
  ...Object.fromEntries([1, 2].flatMap((v) => [[EX_REPORT(v), explanationReport(v)], [EX_REPORT(v).replace(/\.md$/, '.judgment.json'), JSON.stringify(explanationJudgment(v))]])),
});
