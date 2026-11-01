/** m1_3b: the workplan prompt tells the model to look things up first, ask when vague, flag conflicts, and name notes by title. */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Vault } from '@/lib/vault';
import { gatherWorkplanContext } from '@/lib/workplan/context';
import { addComment, decideReview, requestReview } from '@/lib/workplan/review-flow';
import { renderWorkplanPrompt, scenarioOf } from '@/lib/harness/prompts/workplan';
import { uiFactsText } from '@/lib/workplan/ui-facts';
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
  }));
});
afterEach(async () => cleanup());

const W1 = `${WS}/workplan v1.md`;
const prompt = async () => renderWorkplanPrompt(await gatherWorkplanContext(await ctxFor(vault)));
const submitted = () => requestReview({ vault, actor: ROLES.juniorA, workspacePath: WS, gate: 'G1', subject: W1, summary: 's', focus: [] });

describe('workplan prompt: look things up first, ask when vague, flag conflicts', () => {
  it('cocreate looks things up before the first question and pushes back on a conflict', async () => {
    const p = await prompt();
    expect(p).toContain('开工前先查，再问（共创的第一轮）');
    expect(p).toContain('题目含糊就先追问');
    expect(p).toContain('指出来，不要顺着走');
    expect(p).toContain('不预设行业和产品');
  });

  it('the cocreate prompt gives the card and body length limits as numbers', async () => {
    const p = await prompt();
    expect(p).toContain('不超过 100 个字');
    expect(p).toContain('合起来不超过 80 个字');
  });

  it('awaiting review has no pre-work lookup section, but does have the UI facts', async () => {
    await submitted();
    const c = await gatherWorkplanContext(await ctxFor(vault));
    expect(scenarioOf(c)).toBe('awaiting_review');
    const p = renderWorkplanPrompt(c);
    expect(p).not.toContain('开工前先查，再问');
    expect(p).toContain('界面上有什么（没有的功能不要说有）');
    expect(p).toContain('你不能提交，也不能说"已经提交"');
  });

  it('rework has no pre-work lookup section, but does have the UI facts', async () => {
    const { reviewPath } = await submitted();
    await addComment({ vault, actor: ROLES.senior, reviewPath, text: '假设不可证伪' });
    await decideReview({ vault, actor: ROLES.senior, reviewPath, decision: 'reject' });
    const c = await gatherWorkplanContext(await ctxFor(vault));
    expect(scenarioOf(c)).toBe('rework');
    const p = renderWorkplanPrompt(c);
    expect(p).not.toContain('开工前先查，再问');
    expect(p).toContain('界面上有什么（没有的功能不要说有）');
    expect(p).toContain('你不能提交，也不能说"已经提交"');
  });

  it('executing has no pre-work lookup section, but does have the UI facts', async () => {
    const { reviewPath } = await submitted();
    await addComment({ vault, actor: ROLES.senior, reviewPath, text: '补一条反证' });
    await decideReview({ vault, actor: ROLES.senior, reviewPath, decision: 'approve' });
    const c = await gatherWorkplanContext(await ctxFor(vault));
    expect(scenarioOf(c)).toBe('executing');
    const p = renderWorkplanPrompt(c);
    expect(p).not.toContain('开工前先查，再问');
    expect(p).toContain('界面上有什么（没有的功能不要说有）');
    expect(p).toContain('你不能提交，也不能说"已经提交"');
  });

  it('the cocreate prompt no longer points at file names', async () => {
    const p = await prompt();
    expect(p).not.toContain('说"项目.md 的议题树里……"');
    expect(p).not.toContain('标明来源（路径或链接）');
    expect(p).not.toContain('写资料名或 [[链接]]');
    expect(p).toContain('正式名称叫**"初始假设"**');
    expect(p).toContain('不要说"草稿"');
  });

  it('an excerpt names the title and keeps the path for tools only', async () => {
    const p = await prompt();
    expect(p).toContain('### 2026-10-20 周会（模拟的会议转写稿）');
    expect(p).toContain('称呼：《2026-10-20 周会》（对用户说话时只用这个标题）');
    expect(p).toContain('vault_read 用的路径（只给工具用，不要对用户说）：20_项目/P/会议/2026-10-20 周会.md');
    expect(p.split('\n').some((line) => line.startsWith('路径：'))).toBe(false);
  });

  it('uiFactsText is five bullet lines', () => {
    const lines = uiFactsText().split('\n');
    expect(lines.filter((line) => line.startsWith('- '))).toHaveLength(5);
  });
});
