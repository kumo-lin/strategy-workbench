/**
 * D-21-4 v4 (b): the text a follow-up carries over from vN goes through the number rule too. The fixture is C's real
 * 报告 v4 (tests/fixtures/d21b-v4/v4-carried.md: the 4 carried clauses whose numbers are not in their originals, and
 * their footnotes) with the real source notes they cite (tests/fixtures/d21b-v4/sources/).
 */
import { readdirSync, readFileSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildToolContext } from '@/lib/harness';
import { fixCarriedNumbers, type Reword } from '@/lib/research/carried-numbers';
import { executeResearch } from '@/lib/research/execute';
import { addFollowUpSubQuestion, executeFollowUp } from '@/lib/research/followup';
import { numberMismatches } from '@/lib/research/number-check';
import { footnoteQuotes } from '@/lib/research/number-repair';
import { footnotesIn } from '@/lib/research/report';
import { createVault, type Vault } from '@/lib/vault';
import { ROLES } from '../helpers/fixture-vault';
import { fakeWeb, RDIR, scriptedModel, setup, WS } from './research-fixture';

vi.setConfig({ testTimeout: 60_000 });

const FX = 'tests/fixtures/d21b-v4';
const REPORT = '20_项目/个人AI战略/WS-A 买方/调查/买方采购逻辑/报告 v4.md';
const BODY = readFileSync(path.join(FX, 'v4-carried.md'), 'utf8').replace(/^<!--.*-->\n/, '');

let cleanup: (() => Promise<void>) | undefined;
afterEach(async () => {
  await cleanup?.();
  cleanup = undefined;
});

/** A vault with the real source notes and the v4 fragment as the report. */
async function v4Vault(): Promise<Vault> {
  const root = await mkdtemp(path.join(tmpdir(), 'sw-carried-'));
  cleanup = () => rm(root, { recursive: true, force: true });
  await mkdir(path.join(root, '10_资料库'), { recursive: true });
  for (const f of readdirSync(path.join(FX, 'sources'))) await writeFile(path.join(root, '10_资料库', f), readFileSync(path.join(FX, 'sources', f)));
  await mkdir(path.join(root, path.dirname(REPORT)), { recursive: true });
  await writeFile(path.join(root, REPORT), `---\nid: rep-v4\ntype: report\nstatus: 推断\nauthor: AI\n---\n\n${BODY}`);
  return createVault(root);
}

const mismatchesOf = async (vault: Vault, body: string) => numberMismatches(body, await footnoteQuotes(vault, body, REPORT));
const log = async () => {};

describe('the v4 fragment: what the number rule finds in the carried text', () => {
  it('5 numbers in 3 clauses, the same as v3 (the follow-up did not check them); H2\'s 19% repeats its challenge (D-21-4 g)', async () => {
    const vault = await v4Vault();
    const ms = await mismatchesOf(vault, BODY);
    expect(ms.map((m) => `${m.number}@[^${m.footnotes.join(',')}]`).sort()).toEqual(['12%@[^4]', '2000@[^2]', '25%@[^4]', '3000万@[^10]', '500@[^2]'].sort());
  });
});

describe('fixCarriedNumbers', () => {
  const lineWith = (body: string, s: string) => body.split('\n').find((l) => l.includes(s))!;

  it('H1: CIO 12% / CTO 25% re-cite the one sentence of the same source that has both ([^39]); [^4] (72% only) is dropped', async () => {
    const vault = await v4Vault();
    const r = await fixCarriedNumbers({ vault, log, fromPath: REPORT, vPrev: 4 }, BODY);
    const row = r.body.split('\n').find((l) => l.startsWith('| H1 '))!;
    expect(row).toContain('CIO 只占 12%、CTO 占 25%（[^39]）');
    const fix = r.fixes.find((f) => f.numbers.includes('12%'))!;
    expect(fix).toMatchObject({ how: 'recited', numbers: ['12%', '25%'] });
    expect(fix.note).toBe('  - 沿用的 v4 原文「，但技术岗决策权里 CIO 只占 12%、CTO 占 25%」：上一版的数字对不上原文，本版改了——改引 [^39]（含 12%、25% 的原句）');
  });

  it('H1: 500 / 2000 are in another block of the BlackFog note: a new footnote for it; [^2] stays (it has the 49%)', async () => {
    const vault = await v4Vault();
    const r = await fixCarriedNumbers({ vault, log, fromPath: REPORT, vPrev: 4 }, BODY);
    expect(lineWith(r.body, '对 500 人以上企业 2000 名员工')).toMatch(/\| \[\^2\]、\[\^70\] \|$/);
    expect(lineWith(r.body, '[^70]:')).toMatch(/^\[\^70\]: “The survey of 2,000 workers at companies with more than 500 employees.*\[\[CIO\.com 2026-01 BlackFog影子AI调查#\^c2\]\]$/);
  });

  it('H2: the 回应 cell\'s 19% is the challenge\'s number ([^69] on the row has it): not a mismatch, the line is left alone', async () => {
    const vault = await v4Vault();
    const r = await fixCarriedNumbers({ vault, log, fromPath: REPORT, vPrev: 4 }, BODY);
    expect(lineWith(r.body, '19% 与其他材料中安全治理占 48%')).toBe(lineWith(BODY, '19% 与其他材料中安全治理占 48%'));
    expect(r.fixes.some((f) => f.numbers.includes('19%'))).toBe(false);
  });

  it('H3: 3000 万 has no original of that magnitude ("$3,000/month" is not it): the model rewrites the clause, code checks the rewrite', async () => {
    const vault = await v4Vault();
    const seen: (string | undefined)[] = [];
    const reword: Reword = async (i) => {
      seen.push(i.problem);
      expect(i.numbers).toEqual(['3000万']);
      expect(i.quotes[0]).toBe('Microsoft 365 Copilot costs $30 per user each month.');
      // the first try keeps a number that is not in the original: refused, asked again
      return i.problem ? i.clause.replace('付费席位已超过 3000 万、', '') : i.clause.replace('3000 万', '3100 万');
    };
    const r = await fixCarriedNumbers({ vault, log, fromPath: REPORT, vPrev: 4, reword }, BODY);
    expect(seen).toEqual([undefined, '改写后仍有不在原文里的数字：3100万']);
    expect(r.unresolved).toEqual([]);
    expect(await mismatchesOf(vault, r.body)).toEqual([]); // the page shows no ⚠ 数字未在引文中出现
    const fix = r.fixes.find((f) => f.how === 'reworded')!;
    expect(fix.note).toMatch(/^ {2}- 沿用的 v4 原文「- 修正后的假设：.*」：上一版的数字对不上原文，本版改了——引用的原文里没有 3000万，去掉了这些数字，改为「/);
    expect(lineWith(r.body, '- 修正后的假设：')).not.toContain('3000');
    // EPCGroup's note is not touched: nothing to add from its page
    expect((await vault.read('10_资料库/EPCGroup 2026-10 Copilot定价与授权.md')).body).not.toContain('数字核对时补的块');
  });

  it('a rewrite with a footnote, a link or a table bar is refused; no acceptable rewrite: the clause stays and is returned', async () => {
    const vault = await v4Vault();
    const problems: (string | undefined)[] = [];
    const r = await fixCarriedNumbers({ vault, log, fromPath: REPORT, vPrev: 4, reword: async (i) => (problems.push(i.problem), '改了 [^10]') }, BODY);
    expect(problems).toEqual([undefined, '改写里不能有脚注、[[链接]]或表格的竖线：只写这半句话本身']);
    expect(r.unresolved.map((m) => m.number)).toEqual(['3000万']);
    expect(lineWith(r.body, '- 修正后的假设：')).toContain('3000 万');
    expect(r.fixes.map((f) => f.how)).toEqual(['recited', 'recited']);
  });

  it('nothing to fix: the body comes back unchanged', async () => {
    const vault = await v4Vault();
    const clean = '## Summary\n\n- 一句话答案：IT 掌握准入门槛[^4]\n\n## 引文出处\n\n' + BODY.split('\n').find((l) => l.startsWith('[^4]:'));
    const r = await fixCarriedNumbers({ vault, log, fromPath: REPORT, vPrev: 4 }, clean);
    expect(r).toEqual({ body: clean, fixes: [], unresolved: [] });
  });
});

describe('in a follow-up: vN\'s carried text with numbers outside their originals', () => {
  it('is repaired before v(N+1) is written: re-cited or reworded, listed in 本版变化, and v(N+1) is delivered with no mismatch', async () => {
    const fx = await setup({ approved: true });
    cleanup = fx.cleanup;
    const first = await executeResearch({ ctx: fx.ctx, mode: 'small', model: scriptedModel().model, webClient: fakeWeb() });
    expect(first.delivered).toBe(true);
    // vN predates the number rule: a carried 推导 line with "<k> 家" citing a counter footnote (报告 k ^c2, no number;
    // its ^c1 says "第 k 组") and "37%" citing [^1] (资料甲 has no 37 anywhere)
    const v1 = await fx.vault.read(first.reportPath);
    const before = v1.body.split('\n').find((l) => l.startsWith('- 推导（推断）：'))!;
    const [counterId, counterDef] = [...footnotesIn(v1.body).defs].find(([, d]) => /\[\[报告 \d+#\^c2\]\]$/.test(d))!;
    const source = /\[\[([^\]#]+)#\^c2\]\]$/.exec(counterDef)![1];
    const k = /报告 (\d+)/.exec(source)![1];
    const carried = `${before}；另有调查说换机由系统停止支持推动、涉及 ${k} 家企业[^${counterId}]；覆盖了 37% 的受访企业[^1]`;
    await fx.vault.write(first.reportPath, { frontmatter: v1.data, body: v1.body.replace(before, carried) }, { overwrite: true });

    const added = await addFollowUpSubQuestion({ vault: fx.vault, workspacePath: WS, researchDir: RDIR, role: ROLES.juniorA, claimId: 'C1', question: '员工自带 AI 是否绕开了 IT？' });
    const ctx = await buildToolContext({ vault: fx.vault, role: ROLES.juniorA, workspacePath: WS, researchDir: RDIR, track: 'research' });
    const m = scriptedModel({ reword: () => '覆盖了大多数受访企业' });
    const follow = await executeFollowUp({ ctx, claimId: 'C1', subQuestionId: added.subQuestionId, model: m.model, webClient: fakeWeb() });
    const v2 = await fx.vault.read(follow.reportPath);

    expect(follow.delivered).toBe(true);
    expect(m.tasks).toContain('number-carried');
    const line = v2.body.split('\n').find((l) => l.startsWith('- 推导（推断）：'))!;
    const recited = new RegExp(`涉及 ${k} 家企业\\[\\^(\\d+)\\]`).exec(line)?.[1];
    expect(recited).toBeDefined();
    expect(footnotesIn(v2.body).defs.get(Number(recited))).toMatch(new RegExp(`\\[\\[${source}#\\^c1\\]\\]$`));
    expect(line).toContain('；覆盖了大多数受访企业[^1]');
    expect(line).not.toContain('37%');
    expect(await numberMismatches(v2.body, await footnoteQuotes(fx.vault, v2.body, follow.reportPath))).toEqual([]);
    const change = v2.body.slice(v2.body.indexOf('## 本版变化'), v2.body.indexOf('\n## ', v2.body.indexOf('## 本版变化') + 1));
    expect(change).toContain('- 沿用的 v1 文字里，数字对不上所引原文的地方（数字核对，本版改了）：');
    expect(change.match(/上一版的数字对不上原文，本版改了/g)).toHaveLength(2);
    const log = await fx.vault.readLog(fx.ctx.logPath);
    expect(log.filter((r) => r.action === 'research:number-carried')).toHaveLength(2);
    // vN itself is never changed
    expect((await fx.vault.read(first.reportPath)).body).toContain(carried);
  });

  it('a carried mismatch that cannot be repaired is flagged (number_flags, log), not blocking: v(N+1) is delivered (D-21-4 f)', async () => {
    const fx = await setup({ approved: true });
    cleanup = fx.cleanup;
    const first = await executeResearch({ ctx: fx.ctx, mode: 'small', model: scriptedModel().model, webClient: fakeWeb() });
    const v1 = await fx.vault.read(first.reportPath);
    const before = v1.body.split('\n').find((l) => l.startsWith('- 推导（推断）：'))!;
    await fx.vault.write(first.reportPath, { frontmatter: v1.data, body: v1.body.replace(before, `${before}；覆盖了 37% 的受访企业[^1]`) }, { overwrite: true });
    const added = await addFollowUpSubQuestion({ vault: fx.vault, workspacePath: WS, researchDir: RDIR, role: ROLES.juniorA, claimId: 'C1', question: '员工自带 AI 是否绕开了 IT？' });
    const ctx = await buildToolContext({ vault: fx.vault, role: ROLES.juniorA, workspacePath: WS, researchDir: RDIR, track: 'research' });
    const follow = await executeFollowUp({ ctx, claimId: 'C1', subQuestionId: added.subQuestionId, model: scriptedModel({ reword: (c) => c }).model, webClient: fakeWeb() });
    const v2 = await fx.vault.read(follow.reportPath);
    expect(follow.delivered).toBe(true);
    expect(v2.data.failed_checks).toEqual([]);
    expect(v2.data.number_flags).toEqual([{ check: 'number_not_in_quote', text: '覆盖了 37% 的受访企业', numbers: ['37%'] }]);
    expect((await fx.vault.readLog(fx.ctx.logPath)).some((r) => r.action === 'research:number-flagged' && r.change.includes('37%'))).toBe(true);
    // not listed as repaired in 本版变化: it was not
    expect(v2.body).not.toContain('上一版的数字对不上原文，本版改了');
  });
});
