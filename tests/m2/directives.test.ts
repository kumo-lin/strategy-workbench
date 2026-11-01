/**
 * D-28: the recommendation says how the findings answer the exec directive the investigation started from
 * (2026-10-16 周会 ^m1 "重点看 IT 能不能管", ^m3 the three layers), quoting the blocks; still a proposal.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { directiveGaps, directiveRefs, expandDirectiveKeys } from '@/lib/research/directives';
import { executeResearch } from '@/lib/research/execute';
import { collectOrigins } from '@/lib/research/origin';
import { clearPageCache } from '@/lib/research/page-cache';
import { Footnotes } from '@/lib/research/report';
import { createVault } from '@/lib/vault';
import { fakeWeb, RECOMMENDATION, scriptedModel, setup } from './research-fixture';

let cleanup: (() => Promise<void>) | null = null;
beforeEach(() => {
  clearPageCache();
  vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 200 })));
});
afterEach(async () => {
  vi.unstubAllGlobals();
  await cleanup?.();
  cleanup = null;
});

describe('the directive keys', () => {
  it('on S3 (the D-21 investigation) the starting meeting gives M1 = ^m1 and M2 = ^m3, the W1 decisions W1 / W2', async () => {
    const vault = createVault('demo-vault/.snapshots/S3-C7-ws-a');
    const p = '20_项目/个人AI战略/WS-A 买方/调查/买方采购逻辑/计划 v1.md';
    const refs = directiveRefs(await collectOrigins(vault, p, (await vault.read(p)).data as never));
    expect(refs.filter((r) => r.kind === '会议').map((r) => [r.key, r.link])).toEqual([
      ['M1', '[[20_项目/个人AI战略/会议/2026-10-16 高层周会（模拟）#^m1]]'],
      ['M2', '[[20_项目/个人AI战略/会议/2026-10-16 高层周会（模拟）#^m3]]'],
    ]);
    expect(refs.filter((r) => r.kind === '决定').map((r) => r.key)).toEqual(['W1', 'W2']);
    expect(refs[0].quote).toContain('重点看 IT 能不能管');
  });

  it('a key becomes a footnote quoting the block, verified by check_citations; unknown keys stay as written', async () => {
    const vault = createVault('demo-vault/.snapshots/S3-C7-ws-a');
    const p = '20_项目/个人AI战略/WS-A 买方/调查/买方采购逻辑/计划 v1.md';
    const refs = directiveRefs(await collectOrigins(vault, p, (await vault.read(p)).data as never));
    const notes = new Footnotes();
    expect(expandDirectiveKeys('修正：方向成立但要收窄 [M1、M2]，[M9] 不存在', refs, notes)).toBe('修正：方向成立但要收窄 [^1][^2]，[M9] 不存在');
    const defs = notes.lines().join('\n');
    expect(defs).toContain('（高层指示）[[20_项目/个人AI战略/会议/2026-10-16 高层周会（模拟）#^m1]]');
    expect((await vault.checkCitations(defs)).every((c) => c.ok && c.quote)).toBe(true);
  });

  it('the row must exist, cite a directive block and say 支持 / 修正 / 推翻', () => {
    const refs = [{ key: 'M1', kind: '会议' as const, name: 'm', link: '[[m#^m1]]', quote: '重点看 IT 能不能管' }];
    const rec = (directive_response: string) => ({ ...RECOMMENDATION, directive_response }) as never;
    expect(directiveGaps(rec('修正：要收窄 [M1]'), refs)).toEqual([]);
    expect(directiveGaps(rec(''), refs)[0]).toMatch(/没有写“怎么回应高层指示”/);
    expect(directiveGaps(rec('修正：要收窄'), refs)).toEqual(['“怎么回应高层指示”没有引用高层指示的原块（写成 [M1] 这样的编号）']);
    expect(directiveGaps(rec('方向不错 [M1]'), refs)).toEqual(['“怎么回应高层指示”没有说清是支持、修正还是推翻']);
    expect(directiveGaps(rec(''), [])).toEqual([]); // no directive to answer: no row required
  });
});

describe('a run whose plan starts from the exec directive', () => {
  it('Summary carries 怎么回应高层指示, its footnote quotes the meeting block, and the report is delivered', async () => {
    const fx = await setup({ meeting: true });
    cleanup = fx.cleanup;
    const prompts: string[] = [];
    const r = await executeResearch({ ctx: fx.ctx, mode: 'small', model: scriptedModel({ onPrompt: (p) => prompts.push(p) }).model, webClient: fakeWeb() });
    expect(r.delivered).toBe(true);
    expect(prompts.find((p) => p.includes('写"AI 的推荐判断'))).toMatch(/^\[M1\]（高层指示，2026-10-16 高层周会）“/m);
    const body = (await fx.vault.read(r.reportPath)).body;
    const row = body.split('\n').find((l) => l.startsWith('| 怎么回应高层指示 |'))!;
    expect(row).toMatch(/^\| 怎么回应高层指示 \| 修正：重点看 IT 能不能管的方向成立，但只在管理严格的企业里\[\^(\d+)\] \|$/);
    const n = /\[\^(\d+)\]/.exec(row)![1];
    expect(body).toMatch(new RegExp(`^\\[\\^${n}\\]: “[^”]+”（高层指示）\\[\\[20_项目/P/会议/2026-10-16 高层周会#\\^m1\\]\\]$`, 'm'));
  });

  it('a recommendation that does not answer the directive is not delivered', async () => {
    const fx = await setup({ meeting: true });
    cleanup = fx.cleanup;
    const sm = scriptedModel({ recommendation: { ...RECOMMENDATION, directive_response: '' } });
    const r = await executeResearch({ ctx: fx.ctx, mode: 'small', model: sm.model, webClient: fakeWeb() });
    expect(r.delivered).toBe(false);
    expect(r.failedChecks.join('\n')).toMatch(/推荐判断不完整：没有写“怎么回应高层指示”/);
    expect(sm.tasks).toContain('recommend:repair');
  });
});
