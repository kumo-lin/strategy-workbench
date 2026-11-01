/**
 * D-56 ⑦: the three-gate check runs on every report executeResearch writes and its result goes into the new
 * frontmatter field `citation_verify` (the page shows ✓ on verified footnotes, grey "相关资料" on the rest). The
 * body is never changed by this step and the step never blocks delivery. Both judges are scripted: no model, no network.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { runCitationVerify, type CitationVerifyRecord } from '@/lib/research/citation-verify';
import { executeResearch } from '@/lib/research/execute';
import { clearPageCache } from '@/lib/research/page-cache';
import { fakeWeb, scriptedModel, setup } from './research-fixture';

vi.setConfig({ testTimeout: 90_000 });

let cleanup: (() => Promise<void>) | undefined;
afterEach(async () => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  await cleanup?.();
  cleanup = undefined;
});

/** A mocked small run; both judges say 撑得住 unless `second` says otherwise. */
async function smallRun(second = scriptedModel()) {
  clearPageCache();
  vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 200 })));
  const fx = await setup({ approved: true });
  cleanup = fx.cleanup;
  const first = scriptedModel();
  const r = await executeResearch({ ctx: fx.ctx, mode: 'small', model: first.model, verifyModel: second.model, webClient: fakeWeb() });
  const report = await fx.vault.read(r.reportPath);
  const record = report.data.citation_verify as CitationVerifyRecord;
  return { fx, r, report, record, first };
}

describe('a mocked run with both judges', () => {
  it('all 撑得住: citation_verify in the frontmatter, one log line, the body untouched', async () => {
    const { fx, r, report, record } = await smallRun();
    expect(r.delivered).toBe(true);
    expect(record).toBeDefined();
    expect(record.checked).toBeGreaterThan(0);
    expect(record.checked).toBe(record.items.length);
    expect(record.verified).toBeGreaterThan(0);
    // only all three gates passing is verified
    for (const item of record.items) {
      if (item.entity.pass && item.deepseek.fit === '撑得住' && item.kimi.fit === '撑得住') expect(item.verified).toBe(true);
      if (item.verified) expect(item.entity.pass && item.deepseek.fit === '撑得住' && item.kimi.fit === '撑得住').toBe(true);
    }
    expect(typeof record.judges.first).toBe('string');
    expect(record.judges.second).toBe('injected');
    const log = await fx.vault.readLog(fx.ctx.logPath);
    expect(log.filter((x) => x.action === 'research:citation-verify')).toHaveLength(1);
    // the body is never changed by this step
    expect(report.body).not.toContain('三关');
    expect(report.body).not.toContain('citation_verify');
  });

  it('the second judge says 部分 every time: nothing verified, the report still delivered', async () => {
    const second = scriptedModel({ citationVerify: (items) => items.map((i) => ({ id: i.id, fit: '部分', reason: '只讲了一部分' })) });
    const { r, record } = await smallRun(second);
    expect(r.delivered).toBe(true);
    expect(r.failedChecks).toEqual([]);
    expect(record.checked).toBeGreaterThan(0);
    expect(record.verified).toBe(0);
    expect(record.items.every((x) => x.kimi.fit === '部分')).toBe(true);
  });

  it('both models are asked: citation-verify is on each one\'s task list', async () => {
    const second = scriptedModel();
    const { first } = await smallRun(second);
    expect(first.tasks).toContain('citation-verify');
    expect(second.tasks).toContain('citation-verify');
  });
});

describe('no second model', () => {
  it('judges.second null, nothing verified, one log line that names no key', async () => {
    vi.stubEnv('MOONSHOT_API_KEY', '');
    clearPageCache();
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 200 })));
    // the fixture's 90_配置/模型.md has no kimi provider: the second model cannot be made
    const fx = await setup({ approved: true });
    cleanup = fx.cleanup;
    const first = scriptedModel();
    const r = await executeResearch({ ctx: fx.ctx, mode: 'small', model: first.model, webClient: fakeWeb() });
    expect(r.delivered).toBe(true);
    const record = (await fx.vault.read(r.reportPath)).data.citation_verify as CitationVerifyRecord;
    expect(record.judges.second).toBeNull();
    expect(record.verified).toBe(0);
    expect(record.items.every((x) => x.kimi.fit === null)).toBe(true);
    const log = (await fx.vault.readLog(fx.ctx.logPath)).filter((x) => x.action === 'research:citation-verify-no-second');
    expect(log).toHaveLength(1);
    expect(log[0].change).not.toContain('MOONSHOT_API_KEY');
    expect(JSON.stringify(log[0])).not.toMatch(/sk-[A-Za-z0-9]/);
  });
});

describe('runCitationVerify itself', () => {
  it('a body with no first-layer footnote: null, no model call', async () => {
    const llm = vi.fn(async () => ({}));
    const log = vi.fn(async () => {});
    const out = await runCitationVerify({ llm, log, signal: undefined } as never, { vault: {} } as never, '# R\n\n## Summary\n\n没有脚注的一句话。\n', '调查/报告 v1.md', 'custom');
    expect(out).toBeNull();
    expect(llm).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
  });
});
