/** D-19: co-creation asks at most 3 questions; after that the model is told to draft (counted from the log). */
import { MockLanguageModelV3 } from 'ai/test';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildToolContext, runAgent } from '@/lib/harness';
import { askBudgetText } from '@/lib/harness/prompts/workplan';
import type { LogEntry, Vault } from '@/lib/vault';
import { COCREATE_ASK_LIMIT, countCocreateAsks } from '@/lib/workplan/ask-budget';
import { gatherWorkplanContext } from '@/lib/workplan/context';
import { ROLES } from '../helpers/fixture-vault';
import { ctxFor, LOG, makeM1Vault, step, WS } from './helpers';

const row = (action: string, change: string, reason = '· 阶段=workplan'): LogEntry => ({ time: '2026-10-25T01:00:00.000Z', actor: 'AI', action, change, reason });
const ask = (q = '要支撑什么决策？') => row('tool:ask_user', `提问：${q}`, `先对齐决策 · 阶段=workplan`);
const wroteWorkplan = (v = 1) => row('tool:write_draft', `新建草稿 ${WS}/workplan v${v}.md（workplan）`);

describe('countCocreateAsks', () => {
  it('counts workplan-phase asks since the last successful workplan write', () => {
    expect(countCocreateAsks([])).toBe(0);
    expect(countCocreateAsks([ask(), ask(), ask()])).toBe(3);
    expect(countCocreateAsks([ask(), ask(), ask(), wroteWorkplan(), ask()])).toBe(1);
  });
  it('ignores asks of other phases, failed writes and hypothesis writes', () => {
    expect(countCocreateAsks([ask(), row('tool:ask_user', '提问：x', 'why · 阶段=research_plan')])).toBe(1);
    expect(countCocreateAsks([ask(), row('tool:write_draft', '✗ 下一个版本应该是 workplan v1'), ask()])).toBe(2);
    expect(countCocreateAsks([ask(), row('tool:write_draft', '新建草稿 20_项目/P/假设/WS-A-H2 x.md（hypothesis）'), ask()])).toBe(2);
  });
});

describe('the prompt tells the model where it stands', () => {
  let vault: Vault;
  let cleanup: () => Promise<void>;
  // stage 拆题中 → the co-creation scenario
  beforeEach(async () => {
    ({ vault, cleanup } = await makeM1Vault());
  });
  afterEach(async () => cleanup());

  const seed = async (rows: LogEntry[]) => {
    for (const r of rows) await vault.appendLog(LOG, r);
  };

  it('under the limit: how many are left; at the limit: no more ask_user, draft now, open points go to 风险和待确认', async () => {
    await seed([ask(), ask()]);
    let c = await gatherWorkplanContext(await ctxFor(vault));
    expect(c.cocreateAsks).toBe(2);
    expect(askBudgetText(c.cocreateAsks)).toContain('还可以问 1 个');

    await seed([ask()]);
    c = await gatherWorkplanContext(await ctxFor(vault));
    expect(c.cocreateAsks).toBe(COCREATE_ASK_LIMIT);
    const text = askBudgetText(c.cocreateAsks);
    expect(text).toContain('不要再调用 ask_user');
    expect(text).toContain('write_draft');
    expect(text).toContain('风险和待确认');
  });

  it('the 4th turn (mock model, real harness): the system prompt the model gets says to draft instead of asking', async () => {
    await seed([ask('决策？'), ask('论点怎么拆？'), ask('怎么验证？')]);
    const ctx = await buildToolContext({ vault, role: ROLES.juniorA, workspacePath: WS, track: 'workspace' });
    const model = new MockLanguageModelV3({ doStream: [step({ text: '好，我直接起草。' })] });
    const r = await runAgent({ ctx, model, messages: [{ role: 'user', content: 'a' }] });
    await r.consumeStream();
    const system = model.doStreamCalls[0].prompt.find((m) => m.role === 'system');
    const text = typeof system?.content === 'string' ? system.content : '';
    expect(text).toContain('共创的提问已经用完');
    expect(text).toContain('已经问了 3 个');
  });

  it('after v1 is written the count restarts (comment reading is a different job)', async () => {
    await seed([ask(), ask(), ask(), wroteWorkplan(1)]);
    const c = await gatherWorkplanContext(await ctxFor(vault));
    expect(c.cocreateAsks).toBe(0);
  });
});
