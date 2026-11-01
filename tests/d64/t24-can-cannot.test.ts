/** D-64 T24: a citation says what it can support and what it cannot (the second check of the three). */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { citationVerifyPrompt } from '@/lib/harness/prompts/research-execute';
import type { CitationSite } from '@/lib/research/citation-fit';
import { verifyCitations, type FitJudge, type VerifyPair } from '@/lib/research/citation-verify';
import { firstLayerClauses } from '@/lib/research/entity-check';
import { executeResearch } from '@/lib/research/execute';
import { clearPageCache } from '@/lib/research/page-cache';
import { fakeWeb, scriptedModel, setup } from '../m2/research-fixture';

const pair: VerifyPair = {
  id: 'p1',
  footnote: '[^1]',
  ref: '[[联想 2026-09 Qira扩展#^c1]]',
  sentence: 'Qira 已覆盖 80 多种 PC 配置',
  quote: 'Lenovo has brought Qira to more than 80 supported PC configurations',
  source: 'Lenovo has brought Qira to more than 80 supported PC configurations\nQira 80 PC 配置',
};
const judge =
  (out: Record<string, unknown>): FitJudge =>
  async (items: CitationSite[]) =>
    new Map(items.map((i) => [i.id, { fit: '撑得住' as const, reason: '原文直接说了', ...out }]));
const holds = judge({});
const CAN = { can: '联想的公开产品定位', cannot: '用户会持续使用或付费' };

describe('T24 can / cannot', () => {
  it('the second check returns a non-empty can and cannot, kept on the item', async () => {
    const r = await verifyCitations([pair], { deepseek: judge(CAN), kimi: holds });
    expect(r.items[0]).toMatchObject({ verified: true, can: CAN.can, cannot: CAN.cannot });
    expect(r.items[0].deepseek).toMatchObject(CAN);
  });

  it('can and cannot the same, or one empty: the second check counts as not passed', async () => {
    for (const bad of [{ can: '用户会付费', cannot: '用户会付费' }, { can: '', cannot: '用户会付费' }, { can: '联想的定位', cannot: ' ' }, {}]) {
      const r = await verifyCitations([pair], { deepseek: judge(bad), kimi: holds });
      expect(r.items[0].verified, JSON.stringify(bad)).toBe(false);
      expect(r.counts.failed.deepseek).toBe(1);
    }
  });

  it('the prompt asks for can and cannot', () => {
    const p = citationVerifyPrompt([{ id: 'p1', sentence: pair.sentence, key: '^1', quote: pair.quote }]).prompt;
    expect(p).toContain('"can"');
    expect(p).toContain('"cannot"');
    expect(p).toContain('不能支持');
  });

  it('the new report\'s So what and 为什么 lines are checked too (their labels are not part of the clause)', () => {
    const body = ['# R', '', '## So what', '', '用的人多，天天用的少[^1]', '', '## 为什么（三条支撑）', '', '1. 用的人多', '   - 事实：每天用的只有 24%[^2]（Pew 2026）', '', '## 引文出处', '[^1]: x'].join('\n');
    expect(firstLayerClauses(body)).toEqual([
      { sentence: '用的人多，天天用的少', footnotes: ['1'] },
      { sentence: '每天用的只有 24%', footnotes: ['2'] },
    ]);
  });
});

describe('T24 in a run', () => {
  beforeEach(() => {
    clearPageCache();
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 200 })));
  });
  let cleanup: (() => Promise<void>) | null = null;
  afterEach(async () => {
    vi.unstubAllGlobals();
    await cleanup?.();
  });

  it('citation_verify.items[] in the report frontmatter carries can and cannot', async () => {
    const fx = await setup();
    cleanup = fx.cleanup;
    const r = await executeResearch({ ctx: fx.ctx, mode: 'small', model: scriptedModel().model, webClient: fakeWeb() });
    const items = ((await fx.vault.read(r.reportPath)).data.citation_verify as { items: { can: string; cannot: string }[] }).items;
    expect(items.length).toBeGreaterThan(0);
    for (const i of items) {
      expect(i.can.trim()).not.toBe('');
      expect(i.cannot.trim()).not.toBe('');
    }
  });
});
