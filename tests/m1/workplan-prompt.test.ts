/** Context assembly and scenario switching of the workplan phase prompt (M1 tasks 1.4 / 1.7). */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildSystemPrompt } from '@/lib/harness';
import type { Vault } from '@/lib/vault';
import { gatherWorkplanContext } from '@/lib/workplan/context';
import { addComment, decideReview, requestReview } from '@/lib/workplan/review-flow';
import { renderWorkplanPrompt, scenarioOf } from '@/lib/harness/prompts/workplan';
import { ctxFor, makeM1Vault, ROLES, WS } from './helpers';

const COMMON = (id: string, type: string, extra: string) =>
  `---\nid: ${id}\ntype: ${type}\nstatus: 已确认\ncreated: "2026-10-24"\nupdated: "2026-10-24"\nauthor: Senior\nderived_from: ["[[团队]]"]\nrelates_to: ["[[团队]]"]\n${extra}\n---\n`;

let vault: Vault;
let cleanup: () => Promise<void>;
beforeEach(async () => {
  ({ vault, cleanup } = await makeM1Vault({
    '00_团队知识/方法库/workplan共创.md': `${COMMON('m-wp', 'knowledge', 'kind: method\napproved_by: Senior\norigin_project: null')}\n先问支撑什么决策。\n`,
    '00_团队知识/方法库/comment意图解读.md': `${COMMON('m-ci', 'knowledge', 'kind: method\napproved_by: Senior\norigin_project: null')}\n字面要求和意图要分开。\n`,
    '20_项目/P/会议/2026-10-20 周会.md': `${COMMON('mtg', 'meeting', 'date: "2026-10-20"\nattendees: [VP]\nsimulated: true\ndecisions: []')}\n- 重点看 IT 能不能管 ^m1\n`,
    // the same Senior's comments in another workspace
    '20_项目/P/WS-B/review/G1 2026-10-10.md': `${COMMON('ws-b-g1', 'review', 'requester: Junior B\nreviewer: Senior\nresult: 打回\ngate: G1')}\n## Comment\n\n- （Senior）结论要先回答 so what ^m1\n`,
  }));
});
afterEach(async () => cleanup());

const W1 = `${WS}/workplan v1.md`;
const prompt = async () => renderWorkplanPrompt(await gatherWorkplanContext(await ctxFor(vault)));

/** The same v1, but a person wrote/edited it: the AI must not overwrite it. */
const HUMAN_WORKPLAN_V1 = `---
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
---
# WS-A workplan v1

## 论点与假设
- [[WS-A-H1 IT 可管理性]]
`;

describe('workplan phase prompt', () => {
  it('co-creation: method skills, directives, hypotheses and the draft to rewrite', async () => {
    const ctx = await ctxFor(vault);
    const c = await gatherWorkplanContext(ctx);
    expect(scenarioOf(c)).toBe('cocreate');
    expect(c.writeTarget).toMatchObject({ version: 1, overwrite: true });
    const p = renderWorkplanPrompt(c);
    expect(p).toContain('先问支撑什么决策');
    expect(p).toContain('字面要求和意图要分开');
    expect(p).toContain('重点看 IT 能不能管');
    expect(p).toContain('[[WS-A-H1 IT 可管理性]]');
    expect(p).toContain('还没送审，直接改写它');
    expect(p).toContain('一律用 ask_user 发成卡片');
    expect(p).toContain('这一轮就必须以 ask_user 结束'); // no question left in the text (5.0 finding 3.1)
    expect(p).toContain('共创最多问 3 个问题，追问也算在内'); // D-19
    expect(p).toContain('还可以问 3 个'); // the code-written budget block
    expect(p).toContain('## 风险和待确认'); // method library structure, item 7
    expect(p).toContain('不要说"草稿"');
    expect(p).toContain('正式名称叫**"初始假设"**'); // 项目.md calls them 草稿假设; the Junior hears 初始假设
    expect(p).toContain('你可以推荐，判断归人'); // PRD §7 rule 15 (D-20)
    expect(p).toContain('（推荐，待确认）');
    expect(p).toContain('选项要列全');
    expect(p).toContain('结论要先回答 so what'); // the Senior's earlier comment elsewhere
    // the frozen base rules come first
    expect(await buildSystemPrompt(ctx)).toMatch(/^你是这个 Workspace 的共创同事[\s\S]*一律用 ask_user 发成卡片/);
  });

  it('pending review: the Junior may keep working; the sent version stays frozen', async () => {
    await requestReview({ vault, actor: ROLES.juniorA, workspacePath: WS, gate: 'G1', subject: W1, summary: 's', focus: [] });
    const c = await gatherWorkplanContext(await ctxFor(vault));
    expect(scenarioOf(c)).toBe('awaiting_review');
    const p = renderWorkplanPrompt(c);
    expect(p).toContain('不用等他');
    expect(p).not.toContain('期间不能改 workplan');
    expect(p).not.toContain('## 提问额度'); // the ask budget is a co-creation thing
  });

  it('rejected: rework scenario, the unhandled comment with its exact link, next write is v2', async () => {
    const { reviewPath } = await requestReview({ vault, actor: ROLES.juniorA, workspacePath: WS, gate: 'G1', subject: W1, summary: 's', focus: [] });
    const { link } = await addComment({ vault, actor: ROLES.senior, reviewPath, text: '假设不可证伪', target: '论点与假设' });
    await decideReview({ vault, actor: ROLES.senior, reviewPath, decision: 'reject' });
    const c = await gatherWorkplanContext(await ctxFor(vault));
    expect(scenarioOf(c)).toBe('rework');
    expect(c.writeTarget).toMatchObject({ version: 2, overwrite: false, lockedReason: expect.stringContaining('送审') });
    const p = await prompt();
    expect(p).toContain('**未处理**');
    expect(p).toContain(link);
    expect(p).toContain('关于「论点与假设」');
    expect(p).toContain('以 v1 为底写新版本 v2');
    expect(p).toContain('再发给 Senior');
  });

  it('approved: executing scenario, no re-approval needed', async () => {
    const { reviewPath } = await requestReview({ vault, actor: ROLES.juniorA, workspacePath: WS, gate: 'G1', subject: W1, summary: 's', focus: [] });
    await addComment({ vault, actor: ROLES.senior, reviewPath, text: '补一条反证' });
    await decideReview({ vault, actor: ROLES.senior, reviewPath, decision: 'approve' });
    const p = await prompt();
    expect(p).toContain('Senior 已看过');
    expect(p).toContain('不用再发给 Senior');
    expect(p).toContain('Senior 已看过（Senior）');
    expect(p).not.toContain('G1 已通过');
  });

  it('data from before this change: with no G1 review the old stage rule still decides', async () => {
    const c = await gatherWorkplanContext(await ctxFor(vault));
    expect(c.reviews).toHaveLength(0);
    expect(scenarioOf({ ...c, workspace: { ...c.workspace, stage: '执行中' } })).toBe('executing');
    expect(scenarioOf({ ...c, workspace: { ...c.workspace, stage: 'workplan待审' } })).toBe('awaiting_review');
  });

  it('the G1 review decides the situation; the stage stays 拆题中 throughout', async () => {
    const gather = async () => gatherWorkplanContext(await ctxFor(vault));
    expect(scenarioOf(await gather())).toBe('cocreate');

    const first = await requestReview({ vault, actor: ROLES.juniorA, workspacePath: WS, gate: 'G1', subject: W1, summary: 's', focus: [] });
    expect((await gather()).workspace.stage).toBe('拆题中');
    expect(scenarioOf(await gather())).toBe('awaiting_review');

    await addComment({ vault, actor: ROLES.senior, reviewPath: first.reviewPath, text: '假设不可证伪' });
    await decideReview({ vault, actor: ROLES.senior, reviewPath: first.reviewPath, decision: 'reject' });
    expect((await gather()).workspace.stage).toBe('拆题中');
    expect(scenarioOf(await gather())).toBe('rework');

    const second = await requestReview({ vault, actor: ROLES.juniorA, workspacePath: WS, gate: 'G1', subject: W1, summary: 's', focus: [] });
    await decideReview({ vault, actor: ROLES.senior, reviewPath: second.reviewPath, decision: 'approve' });
    expect((await gather()).workspace.stage).toBe('拆题中');
    expect(scenarioOf(await gather())).toBe('executing');
  });

  it('a workplan a person edited by hand is frozen: the next write is a new version', async () => {
    const { vault: humanVault, cleanup: clean } = await makeM1Vault({ [`${WS}/workplan v1.md`]: HUMAN_WORKPLAN_V1 });
    try {
      const c = await gatherWorkplanContext(await ctxFor(humanVault));
      expect(c.writeTarget).toMatchObject({ version: 2, overwrite: false, lockedReason: expect.stringContaining('手改') });
    } finally {
      await clean();
    }
  });
});
