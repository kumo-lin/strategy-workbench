/**
 * Fixture for the M3 tests: WS-A has a delivered report that cites two blocks of 资料甲;
 * WS-B (Junior B) has an approved research plan of its own. 资料甲 has a third block (^c3)
 * that the report does NOT cite.
 */
import { MockLanguageModelV3 } from 'ai/test';
import type { Role } from '@/lib/config/roles';
import { buildToolContext } from '@/lib/harness';
import { makeFixtureVault, ROLES } from '../helpers/fixture-vault';
import { planNote } from '../m2/research-fixture';

export { ROLES };
export const WS_A = '20_项目/P/WS-A';
export const WS_B = '20_项目/P/WS-B';
export const RDIR_A = `${WS_A}/调查/R1`;
export const RDIR_B = `${WS_B}/调查/R1`;
export const REPORT = `${RDIR_A}/报告 v1.md`;
export const DECISIONS = '20_项目/P/决策';

const fm = (lines: string) => `---\n${lines.trim()}\n---\n`;

const HYP = `${fm(`
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
verdict_proposed: 成立
verdict: null
evidence: []
counter_evidence: []
`)}\n# WS-A-H1\n`;

export function reportNote(opts: { delivery?: '已交付' | '草稿' } = {}) {
  return `${fm(`
id: report-r1-v1
type: report
status: 进行中
created: "2026-10-24"
updated: "2026-10-24"
author: AI
derived_from: ["[[20_项目/P/WS-A/调查/R1/计划 v1|计划 v1]]"]
relates_to: ["[[20_项目/P/WS-A/workspace|WS-A]]", "[[WS-A-H1 IT 可管理]]"]
version: 1
research_plan: "[[20_项目/P/WS-A/调查/R1/计划 v1|计划 v1]]"
mode: team
exploratory: false
delivery: ${opts.delivery ?? '已交付'}
`)}
# R1 调查报告 v1

## Summary
- So what：买方的关键是 IT 可管理性

## 逐个假设
### C1 IT 可管理性决定采购  [[WS-A-H1 IT 可管理]]
- 提议的判断：成立（AI 提议）
- 支持的证据：
  - “IT 可管理性是企业采购 AI PC 的首要考量。”（B 级，网络 · AI 定级）[[资料甲#^c1]]
  - “预算主要来自 IT 部门。”（B 级，网络 · AI 定级）[[资料甲#^c2]]
- 反证：
  - 没有找到 A/B 级的反证
`;
}

let seq = 0;
/** The report plus a second claim judged 证据不足 whose only evidence is 资料甲 ^c3. */
export function reportWithInsufficient() {
  return `${reportNote()}
### C2 预算由 IT 决定
- 提议的判断：证据不足（AI 提议）
- 支持的证据：
  - “一段跨两行的 段落论断。”（B 级，网络 · AI 定级）[[资料甲#^c3]]
- 反证：
  - 没有找到 A/B 级的反证
`;
}

export const confirmedDecision = (name: string, extra: { status?: string; relates?: string; affects?: string } = {}) =>
  `${fm(`
id: dec-test-${++seq}
type: decision
status: ${extra.status ?? '已确认'}
created: "2026-10-24"
updated: "2026-10-24"
author: AI
derived_from: ["[[20_项目/P/WS-A/调查/R1/报告 v1|报告 v1]]"]
relates_to: [${extra.relates ?? '"[[20_项目/P/WS-A/workspace|WS-A]]", "[[20_项目/P/项目|项目]]"'}]
decided_by: ${extra.status === '推断' ? 'null' : 'Senior'}
trigger: "[[20_项目/P/WS-A/调查/R1/报告 v1|报告 v1]]"
reason: 理由一句话
affects: [${extra.affects ?? '"[[20_项目/P/WS-B/workspace|WS-B]]"'}]
`)}
# ${name}

## 决定

${name} 的决定正文。

## 理由

- 先别的。
`;

export async function makeM3Vault(extra: Record<string, string> = {}) {
  return makeFixtureVault({
    [`${WS_A}/调查/R1/计划 v1.md`]: planNote({ approved: true }),
    [REPORT]: reportNote(),
    '20_项目/P/假设/WS-A-H1 IT 可管理.md': HYP,
    [`${RDIR_B}/计划 v1.md`]: planNote({ approved: true }),
    ...extra,
  });
}

export async function ctxFor(vault: Awaited<ReturnType<typeof makeM3Vault>>['vault'], role: Role, workspacePath = WS_A, researchDir = RDIR_A) {
  return buildToolContext({ vault, role, workspacePath, track: 'research', researchDir, now: () => new Date('2026-10-25T10:00:00Z') });
}

const usage = { inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 1, text: 1, reasoning: 0 } };

/** A model that always answers with this JSON. */
export function jsonModel(answer: unknown | (() => unknown)) {
  const calls: string[] = [];
  const model = new MockLanguageModelV3({
    doGenerate: async (options) => {
      calls.push(JSON.stringify((options as { prompt: unknown }).prompt));
      return {
        content: [{ type: 'text', text: JSON.stringify(typeof answer === 'function' ? (answer as () => unknown)() : answer) }],
        finishReason: { unified: 'stop', raw: 'stop' },
        usage,
        warnings: [],
      };
    },
  });
  return { model, calls };
}

export const GOOD_DRAFT = {
  name: 'WS-A决定-先打IT管理场景',
  decision: '买方侧先验证 IT 管理场景，不以 NPU 溢价作为买单理由。',
  reason: 'IT 部门主导采购，且预算在 IT。',
  scope: '适用于企业买方的 AI PC 采购；不适用于个人用户。',
  reasons: [
    { kind: '事实', text: 'IT 可管理性是采购时的首要考量', cites: ['[[资料甲#^c1]]'] },
    { kind: '推断', text: '预算归 IT，所以买单的人就是管 IT 的人', cites: ['[[资料甲#^c2]]', '[[资料甲#^c1]]'] },
  ],
  counter: ['报告没有找到 A/B 级的反证'],
  gaps: ['缺少预算口径'],
  reconsider: ['出现 A/B 级证据显示价格才是首要条件'],
  affects: ['[[20_项目/P/WS-B/workspace|WS-B]]'],
};
