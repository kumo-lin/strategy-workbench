/** 5: a research plan is citation-checked when it is written; a paraphrase inside 「」 is rejected with the real text. */
import { afterEach, describe, expect, it } from 'vitest';
import { executeTool } from '@/lib/harness';
import { PLAN, setup } from './research-fixture';

let cleanup: (() => Promise<void>) | null = null;
afterEach(async () => {
  await cleanup?.();
  cleanup = null;
});

async function draft(body: string) {
  const fx = await setup({ approved: false });
  cleanup = fx.cleanup;
  const prev = (await fx.vault.read(PLAN)).data;
  const args = {
    note_type: 'research_plan',
    name: '计划 v2',
    frontmatter: {
      id: 'plan-r1-v2',
      version: 2,
      question: prev.question,
      purpose: prev.purpose,
      derived_from: ['[[20_项目/P/WS-A/workplan v1|workplan v1]]'],
      relates_to: ['[[20_项目/P/WS-A/workspace|WS-A]]'],
      claims: prev.claims,
      approved_by_owner: null,
      approved_at: null,
    },
    body,
    why: '写计划',
  };
  expect(fx.ctx.phase).toBe('research_plan');
  return { fx, run: () => executeTool('write_draft', args, fx.ctx) };
}

describe('research plan citations', () => {
  it('a genuine quote next to its block link is accepted', async () => {
    const { run, fx } = await draft('# 计划 v2\n- 资料里说「IT 可管理性是企业采购 AI PC 的首要考量。」[[资料甲#^c1]]（只能当线索）\n- 普通句子，附上出处 [[资料甲#^c2]]');
    await run();
    expect(await fx.vault.exists(PLAN.replace('v1', 'v2'))).toBe(true);
  });

  it('the model\'s own paraphrase in 「」 next to a block link is rejected, and the error shows what the block really says', async () => {
    const { run, fx } = await draft('# 计划 v2\n- 「企业买单看 IT 能不能管得住」[[资料甲#^c1]]');
    await expect(run()).rejects.toThrow(/对不上[\s\S]*IT 可管理性是企业采购 AI PC 的首要考量[\s\S]*意译不要加「」/);
    expect(await fx.vault.exists(PLAN.replace('v1', 'v2'))).toBe(false);
    expect((await fx.vault.readLog(fx.ctx.logPath)).at(-1)?.change).toMatch(/✗/); // the refusal is logged
  });

  it('original in 「」 followed by a marked paraphrase in （意译：…） is accepted (the format the prompt teaches)', async () => {
    const { run, fx } = await draft('# 计划 v2\n- 「IT 可管理性是企业采购 AI PC 的首要考量。」（意译：IT 能不能管最重要）[[资料甲#^c1]]');
    await run();
    expect(await fx.vault.exists(PLAN.replace('v1', 'v2'))).toBe(true);
  });

  it('a block that does not exist is rejected; unquoted paraphrase with a link is fine', async () => {
    const bad = await draft('# 计划 v2\n- 见 [[资料甲#^c99]]');
    await expect(bad.run()).rejects.toThrow(/块不存在/);
    await cleanup?.();
    const ok = await draft('# 计划 v2\n- 企业采购更看重可管理性 [[资料甲#^c1]]');
    await ok.run();
  });
});

import { researchPlanPrompt } from '@/lib/harness/prompts/research-plan';

describe('the plan prompt states the quoting rule the write-time check enforces', () => {
  it('「」 holds only verbatim source text; paraphrase goes without quotes; original + 意译 is the way to give both', async () => {
    const fx = await setup({ approved: false });
    cleanup = fx.cleanup;
    const p = await researchPlanPrompt(fx.ctx);
    expect(p).toMatch(/「」和 “” 只能放资料原文/);
    expect(p).toMatch(/逐字照抄/);
    expect(p).toMatch(/意译、翻译、概括一律不加引号/);
    expect(p).toMatch(/（意译：/);
    expect(p).toMatch(/写入被拒时，报错里会给出那一块的真实原文/);
  });
});
