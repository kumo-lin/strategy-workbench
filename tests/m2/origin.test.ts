/** "这次调查的出发点": the report says, in code-written lines with block citations, where the focus came from. */
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { directiveOrigin } from '@/evals/judges';
import { resolveReportCitations } from '@/lib/research/citations';
import { executeResearch } from '@/lib/research/execute';
import { clearPageCache } from '@/lib/research/page-cache';
import { collectOrigins, excerptOf, renderOriginLines } from '@/lib/research/origin';
import { createVault } from '@/lib/vault';
import { fakeWeb, MEETING, PLAN, scriptedModel, setup } from './research-fixture';

let cleanup: (() => Promise<void>) | null = null;
afterEach(async () => {
  vi.unstubAllGlobals();
  await cleanup?.();
  cleanup = null;
});

describe('excerptOf', () => {
  it('takes the sentence that carries the point, verbatim, without markdown emphasis', () => {
    const e = excerptOf('**VP**：嗯。我先插一句，方向先别飘。重点看 IT 能不能管。为什么？第一，我们卖给企业的东西，决定权在 CIO 和 IT 手里。');
    expect(e).toContain('重点看 IT 能不能管');
    expect(e.length).toBeLessThanOrEqual(90);
    expect(e).not.toContain('*');
  });
});

describe('the real S3 snapshot (WS-A 买方采购逻辑)', () => {
  const root = path.resolve('demo-vault/.snapshots/S3-C7-ws-a');
  const vault = createVault(root);
  const planPath = '20_项目/个人AI战略/WS-A 买方/调查/买方采购逻辑/计划 v1.md';

  it('finds the exec meeting (with its blocks and original words), the decisions and the project', async () => {
    const plan = (await vault.readTyped(planPath, 'research_plan')).note;
    const items = await collectOrigins(vault, planPath, plan);
    const meeting = items.filter((i) => i.kind === '会议');
    expect(meeting.length).toBeGreaterThanOrEqual(1);
    expect(meeting.some((i) => /#\^m1\]\]$/.test(i.link) && i.quote?.includes('重点看 IT 能不能管'))).toBe(true);
    expect(items.some((i) => i.kind === '项目')).toBe(true);
    // every block line passes the same citation check as the rest of the report
    const lines = renderOriginLines(items);
    const checks = await vault.checkCitations(lines.join('\n'));
    expect(checks.length).toBeGreaterThan(0);
    expect(checks.every((c) => c.ok && c.quote)).toBe(true);
    // M4's ④′ rule (D-17): the starting point quotes ^m1 「重点看 IT 能不能管」 and the quote passes check_citations
    const body = `## Summary\n- 买方的结论\n\n## 怎么查的\n${lines.join('\n')}\n\n## 逐个假设\n### H1 x\n- IT 可管理性\n`;
    expect(directiveOrigin(body, await resolveReportCitations(vault, body)).every((c) => c.pass)).toBe(true);
  });
});

describe('in a delivered report', () => {
  it('"这次调查的出发点" is in 怎么查的, the meeting link carries the original words, and the report still passes check_citations', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 200 })));
    clearPageCache();
    const fx = await setup({ meeting: true, approved: true });
    cleanup = fx.cleanup;
    const plan = (await fx.vault.read(PLAN)).data;
    await fx.vault.write(PLAN, { frontmatter: { ...plan, derived_from: ['[[20_项目/P/WS-A/workplan v1|workplan v1]]'] }, body: '# p\n' }, { overwrite: true });
    const r = await executeResearch({ ctx: fx.ctx, mode: 'small', model: scriptedModel().model, webClient: fakeWeb() });
    expect(r.failedChecks).toEqual([]);
    expect(r.delivered).toBe(true);
    const body = (await fx.vault.read(r.reportPath)).body;
    const how = body.slice(body.indexOf('## 怎么查的'), body.indexOf('## 逐个假设'));
    expect(how).toContain('这次调查的出发点');
    expect(how).toContain(`[[${MEETING.replace(/\.md$/, '')}#^m1]]`);
    expect(how).toMatch(/“[^”]*重点看 IT 能不能管[^”]*”/);
    // ④′ (D-17) on the real report text
    expect(directiveOrigin(body, await resolveReportCitations(fx.vault, body, r.reportPath)).every((c) => c.pass)).toBe(true);
    // the quote is checked against the block like every other citation
    const meetingChecks = (await fx.vault.checkCitations(body)).filter((c) => c.block === 'm1');
    expect(meetingChecks.length).toBeGreaterThan(0);
    expect(meetingChecks.every((c) => c.ok && c.quote)).toBe(true);
  });

  it('a plan that links to no meeting / decision / project says so instead of staying silent', () => {
    expect(renderOriginLines([])[0]).toContain('这次调查的出发点');
  });
});
