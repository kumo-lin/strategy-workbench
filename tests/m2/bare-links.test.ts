/**
 * M1's fourth walk-through, run 7: the report stayed a draft on "引用没有写出原文（引用必须是“原文” + 链接）：[[45% of
 * professionals use shadow AI tools – here's how to man#^c6]]" (three times). The model had written the block link into
 * its text with no quote. Code now writes the block's original into a footnote when the report is assembled
 * (lib/research/bare-links.ts); the citation check is unchanged. Fixture: the real ZDNET source note
 * (tests/fixtures/bare-links/sources).
 */
import { readdirSync, readFileSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildToolContext } from '@/lib/harness';
import { citeBareBlockLinks } from '@/lib/research/bare-links';
import { executeResearch } from '@/lib/research/execute';
import { addFollowUpSubQuestion, executeFollowUp } from '@/lib/research/followup';
import { citationFailures } from '@/lib/research/selfcheck';
import { createVault, type Vault } from '@/lib/vault';
import { ROLES } from '../helpers/fixture-vault';
import { fakeWeb, RDIR, RECOMMENDATION, scriptedModel, setup, WS } from './research-fixture';

vi.setConfig({ testTimeout: 60_000 });

const FX = 'tests/fixtures/bare-links/sources';
const NOTE = '45% of professionals use shadow AI tools – here’s how to man';
const LINK = `[[${NOTE}#^c6]]`;
const C6 = 'By tracking AI explorations, Roth and her team developed a strategy that allowed professionals to test tools safely.';

let cleanup: (() => Promise<void>) | undefined;
afterEach(async () => {
  await cleanup?.();
  cleanup = undefined;
});

async function copySources(root: string): Promise<void> {
  await mkdir(path.join(root, '10_资料库'), { recursive: true });
  for (const f of readdirSync(FX)) await writeFile(path.join(root, '10_资料库', f), readFileSync(path.join(FX, f)));
}

async function sourceVault(): Promise<Vault> {
  const root = await mkdtemp(path.join(tmpdir(), 'sw-bare-'));
  await copySources(root);
  cleanup = () => rm(root, { recursive: true, force: true });
  return createVault(root);
}

const log = async () => {};
const report = (lines: string[], defs: string[] = []) => ['# x 调查报告 v1', '', '## Summary', ...lines, '', '## 引文出处', ...(defs.length ? defs : ['（没有引用）']), ''].join('\n');

describe('a block link written without its quote', () => {
  it('M1 run 7: three bare links fail the citation check; after assembly they are one footnote with the block\'s original, and pass', async () => {
    const vault = await sourceVault();
    const body = report([`- 一句话答案：先跟踪再放行${LINK}`, `| 做什么 | 先跟踪员工用的工具 ${LINK} |`, `- 理由：同上 ${LINK}`]);
    const before = citationFailures(await vault.checkCitations(body));
    expect(before.map((f) => f.code)).toEqual(['missing_quote', 'missing_quote', 'missing_quote']);
    expect(before[0].message).toContain('引用没有写出原文');

    const out = await citeBareBlockLinks({ vault, log }, body);
    expect(out.cited.map((c) => c.footnote)).toEqual([1, 1, 1]);
    expect(out.body).toContain('先跟踪再放行[^1]');
    expect(out.body).not.toContain('（没有引用）');
    const def = out.body.split('\n').find((l) => l.startsWith('[^1]:'))!;
    expect(def).toContain(`“${C6}”`);
    expect(def.endsWith(LINK)).toBe(true);
    expect(out.body.split(LINK)).toHaveLength(2); // the link is now only in its footnote
    expect(citationFailures(await vault.checkCitations(out.body))).toEqual([]);
  });

  it('a block already cited keeps its footnote number', async () => {
    const vault = await sourceVault();
    const body = report(['- 一句话答案：已有脚注[^3]；又写了一次 ' + LINK], [`[^3]: “${C6}”（B 级，网络）${LINK}`]);
    const out = await citeBareBlockLinks({ vault, log }, body);
    expect(out.body).toContain('又写了一次 [^3]');
    expect(out.body.split('\n').filter((l) => /^\[\^\d+\]:/.test(l))).toHaveLength(1);
  });

  it('a block that does not exist is left as it is, and still keeps the report a draft', async () => {
    const vault = await sourceVault();
    const missing = `[[${NOTE}#^c9]]`;
    const body = report([`- 一句话答案：见 ${missing}`]);
    const out = await citeBareBlockLinks({ vault, log }, body);
    expect(out.body).toBe(body);
    expect(citationFailures(await vault.checkCitations(out.body)).map((f) => f.code)).toEqual(['block_not_found']);
  });

  it('a link that has its quote is not touched: the check compares that quote with the block, as before', async () => {
    const vault = await sourceVault();
    const wrong = report([`- 一句话答案：“Roth blocked every tool”${LINK}`]);
    expect((await citeBareBlockLinks({ vault, log }, wrong)).body).toBe(wrong);
    expect(citationFailures(await vault.checkCitations(wrong)).map((f) => f.code)).toEqual(['quote_mismatch']);
  });

  const judge = (k: { supports: string[] }) => ({
      verdict: '成立',
      rebutted: [],
      revised_statement: null,
      support_lines: [`IT 部门主导采购 [${k.supports[0]}]`],
      counter_lines: [],
      challenge_responses: [],
      reasoning: `IT 主导 [${k.supports[0]}]；先跟踪再放行 ${LINK}`,
      model_knowledge: [],
      so_what: [],
      gaps: [],
      expert_questions: [],
    });

  it('a whole small run: the model writes the bare link in its reasoning and its recommendation; the report is delivered', async () => {
    const fx = await setup({ approved: true });
    cleanup = fx.cleanup;
    await copySources(fx.root);
    const recommendation = { ...RECOMMENDATION, action: `${RECOMMENDATION.action}，先跟踪员工在用的工具 ${LINK}` };
    const out = await executeResearch({ ctx: fx.ctx, mode: 'small', model: scriptedModel({ judge, recommendation }).model, webClient: fakeWeb() });
    const note = await fx.vault.read(out.reportPath);
    expect(out.failedChecks).toEqual([]);
    expect(out.delivered).toBe(true);
    expect(note.body.split(LINK)).toHaveLength(2);
    expect(note.body).toMatch(new RegExp(`^\\[\\^\\d+\\]: “${C6.replace(/[.]/g, '\\.')}”`, 'm'));
    expect((await fx.vault.readLog(fx.ctx.logPath)).some((r) => r.action === 'research:citation-quoted' && r.change.includes('^c6'))).toBe(true);
  });

  it('a follow-up: the bare link in the new part is a footnote too; v2 is delivered', async () => {
    const fx = await setup({ approved: true });
    cleanup = fx.cleanup;
    await copySources(fx.root);
    expect((await executeResearch({ ctx: fx.ctx, mode: 'small', model: scriptedModel().model, webClient: fakeWeb() })).delivered).toBe(true);
    const added = await addFollowUpSubQuestion({ vault: fx.vault, workspacePath: WS, researchDir: RDIR, role: ROLES.juniorA, claimId: 'C1', question: '员工会不会绕开 IT' });
    const ctx = await buildToolContext({ vault: fx.vault, role: ROLES.juniorA, workspacePath: WS, researchDir: RDIR, track: 'research', now: () => new Date('2026-10-25T10:00:00Z') });
    const follow = await executeFollowUp({ ctx, claimId: 'C1', subQuestionId: added.subQuestionId, model: scriptedModel({ judge }).model, webClient: fakeWeb() });
    const v2 = await fx.vault.read(follow.reportPath);
    expect(follow.failedChecks).toEqual([]);
    expect(follow.delivered).toBe(true);
    expect(v2.body.split(LINK)).toHaveLength(2);
  });
});
