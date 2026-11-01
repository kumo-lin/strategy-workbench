/**
 * WS-A full run, 报告 v3 (a draft): what kept it from the reader, and what read as code. Fixture: that report's sentences.
 *   1. "E7 Frontier Suite 为 99 美元" (Microsoft's edition) in H3-1's evidence table, while the run had an evidence E7:
 *      an edition name is not a key; a bare key code cannot settle is flagged (key_flags), the report is delivered.
 *   2. "推断：依赖待验证断言 [H3-1-A3]", "若 待验证断言 H1-A3「…」 不成立": the recommendation names the assertion in words
 *      and where it is (见 Q3-1), not by its key; the question tree's keys (H3-1-A3) are read too.
 *   3. "修正论点 1（选型权）" in 对 workplan 的影响: the prompt asks for the tree's ids; an old word is logged, not blocking.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildToolContext } from '@/lib/harness';
import { executeResearch } from '@/lib/research/execute';
import type { Evidence } from '@/lib/research/evidence';
import type { CheckedAssertion } from '@/lib/research/judge';
import { isFlagCheck, keyFlagsOf } from '@/lib/research/number-repair';
import { clearPageCache } from '@/lib/research/page-cache';
import { assertionGaps, expandAssertionKeys, expandCitations } from '@/lib/research/report';
import { bareKeyFailures, bareNumbers, checkNewLines, checkReportText, oldWordingHits } from '@/lib/research/selfcheck';
import { ROLES } from '../helpers/fixture-vault';
import { fakeWeb, PLAN, RDIR, RECOMMENDATION, scriptedModel, setup, WS } from './research-fixture';

vi.setConfig({ testTimeout: 90_000 });

let cleanup: (() => Promise<void>) | undefined;
afterEach(async () => {
  vi.unstubAllGlobals();
  await cleanup?.();
  cleanup = undefined;
});

const ISSUED = new Set(Array.from({ length: 80 }, (_, i) => `E${i + 1}`));
/** 报告 v3, H3-1's 支持的证据 table. */
const E7_ROW = '| Copilot 多个组合按用户每月明码标价：Business Standard 加 Copilot 为每用户每月 23.50 美元，Business Premium 加 Copilot 为 32 美元，E7 Frontier Suite 为 99 美元 | 23.50 美元、32 美元、99 美元 | C | [^7] |';

describe('1. a bare "E7": an edition name, a leaked key, or a guess', () => {
  it('"E7 Frontier Suite" in the evidence table is not a key, though this run issued E7 (what kept 报告 v3 a draft)', () => {
    expect(bareKeyFailures(E7_ROW, ISSUED)).toEqual([]);
    expect(checkNewLines([E7_ROW], ISSUED).filter((f) => /E7/.test(f.message))).toEqual([]);
    for (const name of ['Microsoft 365 E3 许可', 'M365 E5 用户', 'Office 365 E3', 'E5 Security 套件']) expect(bareKeyFailures(name, ISSUED)).toEqual([]);
  });

  it('code writes the claim\'s own bare key as its footnote, and leaves the edition name alone even when E7 is the claim\'s key', () => {
    const keyed = new Map<string, Evidence>([['E7', { ref: '[[资料#^c1]]', quote: '原文', grade: 'C', publisher: 'x' } as Evidence]]);
    const out = expandCitations('E7 Frontier Suite 为 99 美元，见 E7。', keyed).text;
    expect(out).toMatch(/^E7 Frontier Suite 为 99 美元，见 .*\[\[资料#\^c1\]\]/);
  });

  it('a bare key code cannot settle is flagged (key_flags), not a check that blocks', () => {
    const fs = bareKeyFailures('IT 主导采购，见 E7，预算分散', ISSUED);
    expect(fs.map((f) => f.code)).toEqual(['bare_evidence_key']);
    expect(fs.every(isFlagCheck)).toBe(true);
    expect(keyFlagsOf(fs)).toEqual([{ key: 'E7', text: 'IT 主导采购，见 E7，预算分散' }]);
  });

  it('a run: H2\'s reasoning names H1\'s key without brackets; the report is delivered with key_flags, no repair round for it', async () => {
    clearPageCache();
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 200 })));
    const fx = await setup({ approved: true, claims: 2 });
    cleanup = fx.cleanup;
    let first: string | undefined;
    const m = scriptedModel({
      judge: ({ supports, refutes }) => {
        const own = supports[0] ?? 'E1';
        const other = first ?? '';
        first ??= own;
        return {
          verdict: '成立',
          rebutted: refutes,
          revised_statement: null,
          support_lines: supports.slice(0, 2).map((k) => `IT 部门主导采购 [${k}]`),
          counter_lines: refutes.length ? [] : ['已专门检索反证，没有找到 A/B 级的反证'],
          challenge_responses: refutes.map((k) => ({ key: k, challenge: '说员工会绕开管理', response: `不否定 IT 的决策角色 [${own}]`, effect: '不影响判断' })),
          reasoning: `多家独立来源都指向 IT 主导 [${own}]${other ? `，和 ${other} 说的一致` : ''}`,
          model_knowledge: [],
          so_what: ['先打 IT 管理场景'],
          gaps: [],
          expert_questions: [],
        };
      },
    });
    const ctx = await buildToolContext({ vault: fx.vault, role: ROLES.juniorA, workspacePath: WS, researchDir: RDIR, track: 'research', now: () => new Date('2026-10-26T10:00:00Z') });
    const r = await executeResearch({ ctx, mode: 'full', model: m.model, webClient: fakeWeb() });
    const report = await fx.vault.read(r.reportPath);
    expect(first).toBeDefined();
    expect(r.failedChecks).toEqual([]);
    expect(report.data.delivery).toBe('已交付');
    expect(report.data.key_flags).toEqual([expect.objectContaining({ key: first })]);
    expect(m.tasks).not.toContain('repair');
    expect((await fx.vault.readLog(fx.ctx.logPath)).some((x) => x.action === 'research:key-flagged' && x.change.includes(first!))).toBe(true);
  });
});

describe('2. the assertions a recommendation leans on, in words', () => {
  const h31: CheckedAssertion = { key: 'H3-1-A3', text: '这笔钱更可能是从既有软件、安全与设备租赁预算里再分配出来的，不是净新增。', keys: ['E62'], status: '待验证', basis: '没有资料证据支持' };
  const h1: CheckedAssertion = { key: 'H1-A3', text: '有调研显示 AI 支出所有权分散，80% 的 AI 支出发生在 IT 预算之外，业务部门也有独立 AI 预算。', keys: ['E25'], status: '待验证', basis: '没有资料证据支持' };

  it('对决策的回答: "（推断：依赖待验证断言 [H3-1-A3]）" (the tree key, left raw in 报告 v3)', () => {
    expect(expandAssertionKeys('变现按席位与服务合同算，按份额替换算，不按净新增算（推断：依赖待验证断言 [H3-1-A3]）', [h1, h31], { tree: true })).toBe(
      '变现按席位与服务合同算，按份额替换算，不按净新增算（推断：依赖「这笔钱更可能是从既有软件、安全与设备租赁预算里再分配出来的，不是净新增」这条还没验证的判断（见 Q3-1））',
    );
  });

  it('什么情况下要改: "若 [H1-A3] 不成立", and the same unbracketed after the words; its numbers are the assertion\'s, not the cell\'s', () => {
    const want = '若 「有调研显示 AI 支出所有权分散，80% 的 AI 支出发生在 IT 预算之外，…」这条还没验证的判断（见 Q1） 不成立（AI 支出并没有那么分散、预算仍集中在 IT）→ 推荐改成：把准入包按 IT 单一买家设计';
    expect(expandAssertionKeys('若 [H1-A3] 不成立（AI 支出并没有那么分散、预算仍集中在 IT）→ 推荐改成：把准入包按 IT 单一买家设计', [h1], { tree: true })).toBe(want);
    expect(expandAssertionKeys('若 待验证断言 H1-A3 不成立（AI 支出并没有那么分散、预算仍集中在 IT）→ 推荐改成：把准入包按 IT 单一买家设计', [h1], { tree: true })).toBe(want);
    expect(bareNumbers(`| 什么情况下要改 | ${want} |`)).toEqual([]);
    expect(want).not.toMatch(/H\d+(?:-\d+)?-A\d+|断言/);
  });

  it('a key that is not an assertion of this run stays as written', () => {
    expect(expandAssertionKeys('依赖待验证断言 [H9-A1]', [h1], { tree: true })).toBe('依赖待验证断言 [H9-A1]');
  });

  it('the check that a recommendation leaning on an assertion says so reads the tree key too', () => {
    const rec = (action: string, change_if: string[]) => ({ ...RECOMMENDATION, action, change_if }) as never;
    expect(assertionGaps(rec('不按净新增算（推断：依赖待验证断言 [H3-1-A3]）', ['若 [H3-1-A3] 不成立 → 按净新增算']), [h31])).toEqual([]);
    expect(assertionGaps(rec('不按净新增算（推断：依赖待验证断言 [H3-1-A3]）', ['价格']), [h31])).toEqual(['“什么情况下要改”里没有写待验证断言 [H3-1-A3] 不成立时推荐改成什么']);
  });
});

describe('3. old words', () => {
  it('"修正论点 1（选型权）" in 对 workplan 的影响 and "层面" in Summary are logged; quotes, headings and 怎么查的 are not', () => {
    const body = [
      '# R 调查报告 v3',
      '',
      '## Summary',
      '- 核心问题：谁决定买？',
      '  - Q2 → 「可管」在受监管行业是强制合规项；但在采购文件层面，只有二手报道提到 POC「通过性指标项」',
      '',
      '## Q1 谁决定买？',
      '',
      '### 假设 H1：选型权在 IT（计划里的论点 1）',
      '- 理由：资料说「论点」[^1]',
      '',
      '## 怎么查的',
      '- workplan v2 的论点 1～4',
      '',
      '## 对 workplan 的影响',
      '- 修正论点 1（选型权）：把「购买决策和预算归属都在 IT 一侧」改成「进机队的工具由 IT 把关选型与准入，预算归属分散」。',
      '- 修正论点 2（准入要求）：限定在受监管行业。',
      '',
      '[^1]: “论点 落点”（C 级）[[资料#^c1]]',
    ].join('\n');
    expect(oldWordingHits(body)).toEqual([
      { word: '层面', count: 1, example: expect.stringContaining('采购文件层面') },
      { word: '论点', count: 2, example: expect.stringContaining('修正论点 1（选型权）') },
    ]);
    // not a check: nothing here keeps a report a draft
    const codes = (b: string) => checkReportText(b, [], ISSUED).map((f) => f.code).sort();
    expect(codes(body)).toEqual(codes(body.replaceAll('论点', '假设').replaceAll('层面', '里')));
  });

  it('the Summary prompt of a question tree asks for H2-1 / Q1, not "论点 N"', async () => {
    clearPageCache();
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 200 })));
    const fx = await setup({ approved: true, claims: 2 });
    cleanup = fx.cleanup;
    const note = await fx.vault.read(PLAN);
    const data = note.data as Record<string, unknown> & { claims: Record<string, unknown>[] };
    data.claims = data.claims.map((c, i) => ({ ...c, question: ['谁决定买？', '按什么放行？'][i], parent: null }));
    data.mece_check = '两道关';
    await fx.vault.write(PLAN, { frontmatter: data, body: note.body }, { overwrite: true });
    const prompts: string[] = [];
    const ctx = await buildToolContext({ vault: fx.vault, role: ROLES.juniorA, workspacePath: WS, researchDir: RDIR, track: 'research', now: () => new Date('2026-10-26T10:00:00Z') });
    await executeResearch({ ctx, mode: 'small', model: scriptedModel({ onPrompt: (p) => prompts.push(p) }).model, webClient: fakeWeb() });
    const summary = prompts.find((p) => p.includes('写报告最前面的 Summary'))!;
    expect(summary).toContain('提到假设和子问题时，用上面列出的编号（如 H2-1、Q1），不要写"论点 1""论点 2"');
  });
});
