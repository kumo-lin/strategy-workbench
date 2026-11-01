/** D-64 T23: the report's fixed structure (D63 §3.2): So what → 为什么 → 缺口 → 建议 → 附录. */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Evidence } from '@/lib/research/evidence';
import { executeResearch } from '@/lib/research/execute';
import { clearPageCache } from '@/lib/research/page-cache';
import { basisKind, keyGapRows, recommendationsOf, V2_HEADINGS } from '@/lib/research/report';
import { readJudgmentFile } from '@/lib/research/judgment-file';
import { summarySchema } from '@/lib/research/schemas';
import { fakeWeb, scriptedModel, setup } from '../m2/research-fixture';

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

const NEW_FIELDS = (k: string | undefined) => ({
  reasons: [
    { title: 'IT 部门拍板', basis: [{ text: '采购由 IT 部门主导', kind: '事实', source: '资料甲', refs: k ? [k] : [] }] },
    { title: '管理要求在前', basis: [{ text: '管理要求排在价格前面', kind: '推断', source: '资料甲', refs: [] }] },
    { title: '预算口径还不清楚', basis: [{ text: '受访者说预算由 IT 批', kind: '访谈支持', source: '访谈-IT 负责人', refs: [] }] },
    { title: '第四条不会显示', basis: [{ text: '多余', kind: '推断', source: '资料甲', refs: [] }] },
  ],
  gaps: [{ question: '预算由谁批？', missing: '没有预算口径', how: '访谈 IT 负责人' }],
  recommendations: [{ title: '先打 IT 管理场景', how: '先找 IT 部门试点', refs: ['H1'] }],
});

async function report(extra: NonNullable<Parameters<typeof scriptedModel>[0]>['summaryExtra'] = NEW_FIELDS, onPrompt?: (p: string) => void) {
  const fx = await setup({ expert: true });
  cleanup = fx.cleanup;
  const r = await executeResearch({ ctx: fx.ctx, mode: 'small', model: scriptedModel({ summaryExtra: extra, onPrompt }).model, webClient: fakeWeb() });
  return { ...fx, r, body: (await fx.vault.read(r.reportPath)).body };
}
const h2 = (body: string) => body.split('\n').filter((l) => /^## /.test(l));
const section = (body: string, h: string) => {
  const lines = body.split('\n');
  const i = lines.indexOf(h);
  const j = lines.findIndex((l, k) => k > i && /^## /.test(l));
  return lines.slice(i + 1, j < 0 ? undefined : j).filter((l) => l.trim());
};

describe('T23 report format', () => {
  it('1. the second-level headings start in the fixed order; the older sections stay inside the appendix', async () => {
    const { r, body } = await report();
    expect(r.delivered).toBe(true);
    const hs = h2(body);
    expect(hs.slice(0, 5)).toEqual([...V2_HEADINGS]);
    expect(hs.at(-1)).toBe('## 引文出处');
    // So what is the answer itself, cited
    expect(section(body, '## So what')[0]).toMatch(/^买方的关键是 IT 可管理性\[\^\d+\]/);
  });

  it('2. 为什么 has at most 3 reasons; each basis opens with its kind and closes with its source', async () => {
    const { body } = await report();
    const why = section(body, '## 为什么（三条支撑）');
    expect(why.filter((l) => /^\d+\. /.test(l))).toEqual(['1. IT 部门拍板', '2. 管理要求在前', '3. 预算口径还不清楚']);
    const basis = why.filter((l) => /^\s+- /.test(l));
    expect(basis).toHaveLength(3);
    for (const l of basis) expect(l).toMatch(/^\s+- (事实|推断|访谈支持)：.+（[^）]+）$/);
    expect(basis[0]).toMatch(/^\s+- 事实：采购由 IT 部门主导\[\^\d+\]（资料甲）$/);
  });

  it('3. the gap table: 问题 / 公开资料缺什么 / 怎么验证, one row per key question that combines to 证据不足 or 访谈支持', () => {
    const gaps = [
      { question: 'K3 跨设备是否解决重复出现的真实问题？', missing: '没有留存对比', how: '产品数据' },
      { question: 'K1 有没有高频任务？', missing: 'x', how: 'y' },
    ];
    const rows = keyGapRows(
      [
        { key: 'K1', verdict: '成立' },
        { key: 'K1', verdict: '证据不足' },
        { key: 'K3', verdict: '证据不足' },
        { key: 'K3', verdict: '不成立' },
        { key: 'K4', verdict: '访谈支持' },
      ],
      gaps,
    );
    expect(rows).toEqual([
      { question: 'K3 跨设备是否解决重复出现的真实问题？', missing: '没有留存对比', how: '产品数据' },
      { question: 'K4', missing: '（没有写）', how: '（没有写）' },
    ]);
    // a plan without key questions keeps the model's rows
    expect(keyGapRows([{ verdict: '证据不足' }], gaps)).toEqual(gaps);
  });

  it('3b. the table in the report', async () => {
    const { body } = await report();
    const gap = section(body, '## 缺乏信息、需要另外验证的问题');
    expect(gap[0]).toBe('| 问题 | 公开资料缺什么 | 怎么验证 |');
    expect(gap).toContain('| 预算由谁批？ | 没有预算口径 | 访谈 IT 负责人 |');
  });

  it('4. a basis only interviews carry is never labeled 事实', () => {
    const ev = (sourceKind: 'source' | 'expert') => ({ sourceKind }) as Evidence;
    const keyed = new Map([
      ['E1', ev('expert')],
      ['E2', ev('source')],
    ]);
    const b = (refs: string[], source = '资料') => ({ text: 't', kind: '事实' as const, source, refs });
    expect(basisKind(b(['E1']), keyed)).toBe('访谈支持');
    expect(basisKind(b(['E1', 'E2']), keyed)).toBe('事实');
    expect(basisKind(b([], '访谈-重度用户'), keyed)).toBe('访谈支持');
    expect(basisKind({ ...b(['E1']), kind: '推断' }, keyed)).toBe('推断');
  });

  it('5. older judgment files (the frozen v10 and v7) have no new fields: they keep the old renderer', async () => {
    const dir = 'demo-vault/.snapshots/S3-D48/20_项目/个人AI战略';
    for (const f of ['WS-A 买方/调查/买方采购逻辑（问题树）/报告 v10.judgment.json', 'W5 联想的位置/调查/联想的位置/报告 v7.judgment.json']) {
      const file = JSON.parse(readFileSync(path.join(dir, f), 'utf8'));
      const s = summarySchema.parse({ ...file.summary, recommendation: file.recommendation });
      expect(s.reasons, f).toBeUndefined();
      // its single recommendation reads as one item
      expect(recommendationsOf(s)).toEqual([{ title: file.recommendation.action, how: file.recommendation.scale, refs: [] }]);
    }
    // a run whose Summary has no new fields is rendered as before
    const { body } = await report(() => ({}));
    expect(h2(body)[0]).toBe('## Summary');
  });

  it('the judgment file stores the new fields', async () => {
    const { vault, r } = await report();
    const file = await readJudgmentFile(vault, r.reportPath);
    expect(file?.summary?.reasons).toHaveLength(3);
    expect(file?.summary?.recommendations?.[0]).toMatchObject({ title: '先打 IT 管理场景', refs: ['H1'] });
  });

  it('step 7: a recommendation that cites no judgment goes back to the Summary repair', async () => {
    const prompts: string[] = [];
    await report(
      (k: string | undefined) => ({ ...NEW_FIELDS(k), recommendations: [{ title: '先打 IT 管理场景', how: '先找 IT 部门试点', refs: [] }] }),
      (p) => prompts.push(p),
    );
    expect(prompts.some((p) => p.includes('系统自检没有通过') && p.includes('建议「先打 IT 管理场景」没有引用报告里的判断'))).toBe(true);
  });
});
