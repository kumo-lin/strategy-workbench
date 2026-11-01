/** Shared fixtures for the M1 tests: a small Project with WS-A (owner Junior A, reviewer Senior). */
import { simulateReadableStream } from 'ai';
import { buildToolContext } from '@/lib/harness';
import type { Role } from '@/lib/config/roles';
import type { Vault } from '@/lib/vault';
import { makeFixtureVault, ROLES } from '../helpers/fixture-vault';

export { ROLES };
export const WS = '20_项目/P/WS-A';
export const WS_NOTE = `${WS}/workspace.md`;
export const LOG = `${WS}/日志.md`;
export const REVIEW_DIR = `${WS}/review`;

const common = (id: string, type: string, extra: string, author = 'Senior', status = '已确认') =>
  `---
id: ${id}
type: ${type}
status: ${status}
created: "2026-10-24"
updated: "2026-10-24"
author: ${author}
derived_from: ["[[团队]]"]
relates_to: ["[[团队]]"]
${extra}
---
`;

/** workplan v1 with a link to one hypothesis, so submit_for_review accepts it. */
const WORKPLAN_V1 = `${common('ws-a-wp-v1', 'workplan', 'version: 1\napproved_by: null\napproved_at: null\nchanges: []', 'AI', '进行中')}
# WS-A workplan v1

## 要回答的问题与要支撑的决策
明年要不要押注企业端 AI PC。

## 论点与假设
- 论点 1：[[WS-A-H1 IT 可管理性]]

## next action
- 调查 H1
`;

const HYPOTHESIS = `${common(
  'ws-a-h1',
  'hypothesis',
  `workspace: "[[20_项目/P/WS-A/workspace|WS-A]]"
statement: 企业买单的首要条件是 IT 能管
verdict_proposed: null
verdict: null
evidence: []
counter_evidence: []`,
  'AI',
  '进行中',
)}\n# H1\n`;

export async function makeM1Vault(extra: Record<string, string> = {}) {
  return makeFixtureVault({
    [`${WS}/workplan v1.md`]: WORKPLAN_V1,
    '20_项目/P/假设/WS-A-H1 IT 可管理性.md': HYPOTHESIS,
    ...extra,
  });
}

export async function ctxFor(vault: Vault, role: Role = ROLES.juniorA, workspacePath = WS) {
  return buildToolContext({ vault, role, workspacePath, track: 'workspace' });
}

const usage = { inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 1, text: 1, reasoning: 0 } };

/** One streamed model step: a list of tool calls, or plain text. */
export function step(part: { calls: { toolName: string; input: object }[] } | { text: string }) {
  const chunks =
    'text' in part
      ? [
          { type: 'text-start', id: 't' },
          { type: 'text-delta', id: 't', delta: part.text },
          { type: 'text-end', id: 't' },
          { type: 'finish', finishReason: { unified: 'stop', raw: 'stop' }, usage },
        ]
      : [
          ...part.calls.map((c, i) => ({ type: 'tool-call', toolCallId: `call-${c.toolName}-${i}`, toolName: c.toolName, input: JSON.stringify(c.input) })),
          { type: 'finish', finishReason: { unified: 'tool-calls', raw: 'tool_calls' }, usage },
        ];
  return { stream: simulateReadableStream({ chunks: chunks as never[] }) };
}

export async function stageOf(vault: Vault, workspacePath = WS): Promise<string> {
  return (await vault.readTyped(`${workspacePath}/workspace.md`, 'workspace')).note.stage;
}
