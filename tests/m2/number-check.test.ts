/**
 * Q-F (D-36): a cited sentence's numbers must be in the original it cites; a 回应 cell cites what the source says, not
 * the author's inference. Fixtures are real fragments of team 报告 v3 (tests/fixtures/qf-v3; the whole v3 is the S3
 * snapshot in demo-vault/.snapshots), [^4] included: its block says 72%, the Summary wrote "CIO 12%、CTO 25%".
 */
import { readFileSync } from 'node:fs';
import { cp, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { afterEach, describe, expect, it } from 'vitest';
import { ReportViewer } from '@/components/research/report-viewer';
import { parseMarkdown as parseLite } from '@/components/research/markdown-lite';
import { blockQuote, citedClauses, markNumberFlags, numberInQuote, numberMismatches, numbersIn, numbersInQuote, responseProblems } from '@/lib/research/number-check';
import { footnoteQuotes, numberFailures, pageSentences, withNewBlock } from '@/lib/research/number-repair';
import { resolveReportCitations } from '@/lib/research/citations';
import { restoreEvidence } from '@/lib/research/evidence-record';
import type { ClaimResult } from '@/lib/research/judge';
import { createVault } from '@/lib/vault';
import { parseMarkdown } from '@/lib/vault/frontmatter';

const FX = 'tests/fixtures/qf-v3';
const read = (f: string) => readFileSync(path.join(FX, f), 'utf8');
const NOTE = 'Technical Leaders Own 72% of Enterprise AI Purchasing Power';
const S3 = 'demo-vault/.snapshots/S3-C7-ws-a';
const V3 = '20_项目/个人AI战略/WS-A 买方/调查/买方采购逻辑/报告 v3.md';

/** footnote id → the quote shown in the footnote (what a reader sees when the block cannot be resolved). */
const shownQuotes = (defs: string) => new Map([...defs.matchAll(/^\[\^(\d+)\]:\s*“([\s\S]*?)”（/gm)].map((m) => [m[1], m[2]]));

describe('which digits are numbers', () => {
  it('percentages, amounts, counts and decimals; full-width and thousands separators normalised', () => {
    expect(numbersIn('CIO 只占 12%、CTO 占 25%').map((t) => t.raw)).toEqual(['12%', '25%']);
    expect(numbersIn('发现 1,223 种在用工具，１２％ 的企业').map((t) => t.value)).toEqual([1223, 12]);
    expect(numbersIn('付费席位超过 3000 万').map((t) => t.scaled)).toEqual([30_000_000]);
    expect(numbersIn('每用户每月 30 美元，涨了 2.5 倍').map((t) => t.value)).toEqual([30, 2.5]);
  });
  it('years, dates, identifiers, product names, quoted text and what code writes are not', () => {
    expect(numbersIn('2026–2027 年，2026-10-16，10 月 16 日')).toEqual([]);
    expect(numbersIn('H1 → 见 C2-Q5、[E12]、v3、D-20、§9.5、第 3 段、3Q26、ISO27001')).toEqual([]);
    expect(numbersIn('Windows 11 和 Microsoft 365 的管理')).toEqual([]);
    expect(numbersIn('它说“72% 的决策”；[[资料 2026#^c3]] [^4]')).toEqual([]);
    expect(numbersIn('H1-A1（已验证：2 个独立来源，最高 B 级）（C 级，网络 · AI 定级）')).toEqual([]);
    // a 4-digit number with a count word is a count, not a year
    expect(numbersIn('2000 名员工').map((t) => t.value)).toEqual([2000]);
  });
  it('compared by value: 72% = 72 percent, 3000 万 = 30 million, a quote rounded to the sentence\'s precision', () => {
    expect(numberInQuote(numbersIn('72%')[0], numbersInQuote('control 72 percent of decisions'))).toBe(true);
    expect(numberInQuote(numbersIn('3000 万')[0], numbersInQuote('more than 30 million paid seats'))).toBe(true);
    expect(numberInQuote(numbersIn('约 30%')[0], numbersInQuote('30.2% of firms'))).toBe(true);
    expect(numberInQuote(numbersIn('12%')[0], numbersInQuote('collectively control 72% of AI purchasing decisions'))).toBe(false);
  });
  it('a clause answers to the footnote group that ends it', () => {
    expect(citedClauses('IT 能看见实际使用（[^1]），影子 AI 在使用层（[^2]、[^3]）。但 CIO 只占 12%（[^4]）')).toEqual([
      { text: 'IT 能看见实际使用', footnotes: ['1'] },
      { text: '，影子 AI 在使用层', footnotes: ['2', '3'] },
      { text: '但 CIO 只占 12%', footnotes: ['4'] },
    ]);
  });
});

describe('the v3 fragments', () => {
  const summary = `## Summary\n${read('summary-h1.md')}\n## 引文出处\n${read('footnotes.md')}`;

  it('[^4]: the Summary\'s "CIO 12%、CTO 25%" is not in its block (72%); the other clauses of the row are fine', () => {
    const ms = numberMismatches(summary, shownQuotes(read('footnotes.md')));
    expect(ms.map((m) => [m.number, m.footnotes])).toEqual([
      ['12%', ['4']],
      ['25%', ['4']],
    ]);
    expect(ms[0]).toMatchObject({ section: 'Summary', text: expect.stringContaining('CIO 只占 12%、CTO 占 25%') });
  });

  it('the whole v3 (S3 snapshot), against the stored blocks: 5 numbers, by claim; the report file is not touched', async () => {
    const full = path.join(S3, V3);
    const before = await readFile(full, 'utf8');
    const { body } = parseMarkdown(before);
    const ms = numberMismatches(body, await footnoteQuotes(createVault(S3), body, V3));
    const by = (k: string) => ms.filter((m) => (m.claim ?? m.section) === k).map((m) => `${m.number}@[^${m.footnotes.join(',')}]`);
    expect(by('Summary')).toEqual(['12%@[^4]', '25%@[^4]']);
    expect(by('H1')).toEqual(['500@[^2]', '2000@[^2]']);
    // H2's 回应 "19% 与……口径不同[^57]" repeats its challenge, whose 出处 [^69] has the 19% (D-21-4 g, M4 audit A)
    expect(by('H2')).toEqual([]);
    expect(by('H3')).toEqual(['3000万@[^10]']);
    expect(ms).toHaveLength(5);
    expect(await readFile(full, 'utf8')).toBe(before);
  });

  it('回应 cells: the footnote hung after the author\'s inference is found (FACT [^1], [^57])', () => {
    const md = `${read('responses.md')}\n## 引文出处\n${read('footnotes.md')}`;
    const ps = responseProblems(md, shownQuotes(read('footnotes.md')));
    const kinds = ps.map((p) => `${p.kind}@[^${p.footnotes.join(',')}]`);
    expect(kinds).toContain('inference_cited@[^1]'); // "……把论点的适用范围压到……这一窄版本[^1]"
    expect(kinds).toContain('inference_cited@[^57]'); // "它足以让论点收窄……但不足以证明……[^57]"
    expect(ps.find((p) => p.footnotes.includes('57'))!.text).toContain('它足以让论点收窄到');
  });

  it('the format the prompt asks for passes: what the source says [^n]; 推断：the inference, no footnote', () => {
    const md = `### H1 x\n- 反证和挑战（逐条回应）：\n\n| 挑战 | 回应 | 结论 | 出处 |\n|---|---|---|---|\n| 封禁把支出推到个人账户 | 它讲的是在受管终端上发现了 1223 种在用工具[^1]；推断：IT 仍能看见使用，论点收窄到准入 | 收窄 | [^22] |\n\n## 引文出处\n${read('footnotes.md')}`;
    expect(responseProblems(md, shownQuotes(read('footnotes.md')))).toEqual([]);
    expect(numberMismatches(md, shownQuotes(read('footnotes.md')))).toEqual([]);
  });

  it('quoted words in a source clause must be the source\'s', () => {
    const md = `### H1 x\n- 反证和挑战（逐条回应）：\n\n| 挑战 | 回应 | 结论 | 出处 |\n|---|---|---|---|\n| x | 资料说「管住」本身不产生价值[^1] | 收窄 | [^1] |\n`;
    expect(responseProblems(md, new Map([['1', 'IT approved few tools but found 1,223 in use']]))).toEqual([expect.objectContaining({ kind: 'quote_not_in_source', quoted: '管住' })]);
  });

  it('a follow-up\'s response list is checked the same way', () => {
    const md = '### H2 x\n  - 逐条回应挑战：\n    - 安全是首要关切[^57] → 收窄：它足以让论点收窄到准入评审[^57]\n    - 安全是首要关切[^57] → 收窄：资料说 48% 的组织把安全列为首要关切[^57]；推断：论点收窄到准入\n';
    const ps = responseProblems(md, new Map([['57', 'cited by 48% of organisations']]));
    expect(ps).toEqual([expect.objectContaining({ kind: 'inference_cited', line: 3 })]);
  });
});

describe('on the page: a box and "⚠ 数字未在引文中出现" beside the flagged markers only', () => {
  it('only the [^4] after "CIO 12%、CTO 25%" is flagged, not every use of [^4]', () => {
    const md = `## Summary\n- 技术岗合计掌握 72%[^4]；CIO 只占 12%[^4]\n\n## 引文出处\n${read('footnotes.md')}`;
    const ms = numberMismatches(md, shownQuotes(read('footnotes.md')));
    const marked = markNumberFlags(md, ms);
    expect(marked.split('\n')[1]).toBe('- 技术岗合计掌握 72%[^4]；CIO 只占 12%[^4!]');
    const inline = parseLite(marked).flatMap((b) => (b.kind === 'list' ? b.items.flatMap((i) => i.inline) : []));
    expect(inline.filter((n) => n.kind === 'footnote').map((n) => (n.kind === 'footnote' ? !!n.numberFlag : null))).toEqual([false, true]);
  });

  it('the v3 report on screen: the box lists the 5 by claim, the tags sit beside them, nothing else changes', async () => {
    const { body } = parseMarkdown(await readFile(path.join(S3, V3), 'utf8'));
    const citations = await resolveReportCitations(createVault(S3), body, V3);
    const html = renderToString(createElement(ReportViewer, { markdown: body, citations })).replace(/<!-- -->/g, '');
    expect(html).toContain('data-testid="number-warnings"');
    expect(html).toContain('数字核对：5 处数字没有出现在所引的原文里');
    expect(html).toContain('Summary · 「，但技术岗决策权里 CIO 只占 12%、CTO 占 25%」里的 12% 不在 [^4] 的原文里');
    expect(html.match(/data-testid="number-warning-tag"/g)).toHaveLength(3); // 5 numbers on 3 marker groups (12%/25% share one, so do 500/2000)
  });
});

// ── in a run: a found original becomes a key the repair may cite ────────────

let root: string | null = null;
afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
  root = null;
});

async function vaultWithNote() {
  root = await mkdtemp(path.join(tmpdir(), 'sw-qf-'));
  await mkdir(path.join(root, '10_资料库'), { recursive: true });
  await cp(path.join(FX, `${NOTE}.md`), path.join(root, '10_资料库', `${NOTE}.md`));
  return createVault(root);
}

const resultWith = (keyed: [string, ClaimResult['keyed'] extends Map<string, infer E> ? E : never][]) => ({ claim: { id: 'C1' }, keyed: new Map(keyed) }) as unknown as ClaimResult;

describe('numberFailures (the self-check in a run)', () => {
  it('[^4] cites ^c3 (72%): the 12% sentence is ^c4 of the same source — offered as a new key, two ways out', async () => {
    const vault = await vaultWithNote();
    const [c3] = await restoreEvidence(vault, [{ claim: 'C1', sub: 'C1-Q1', ref: `[[${NOTE}#^c3]]`, stance: 'refutes', core: false, partial: false, round: 'web1', reason: '' }]);
    const r = resultWith([['E4', c3]]);
    const body = `## Summary\n- 理由：技术岗决策权里 CIO 只占 12%[^4]\n\n## 引文出处\n[^4]: “${c3.quote}”（C 级，网络 · AI 定级）[[${NOTE}#^c3]]\n`;
    const issued = new Set(['E4']);
    const [f, ...rest] = await numberFailures({ vault, log: async () => {}, results: [r], issuedKeys: issued }, body);
    expect(rest).toEqual([]);
    expect(f).toMatchObject({ code: 'number_not_in_quote', excerpt: '- 理由：技术岗决策权里 CIO 只占 12%[^4]' });
    expect(f.message).toContain('里的数字 12% 不在它引用的原文里（[E4] 的原文：“- Technical Supremacy');
    expect(f.message).toMatch(/二选一：改引 \[E5\]——同一份资料里含这个数字的原句：“- CTO Dominance: At 25%, CTOs hold more than double the decision-making authority of CIOs \(12%\)/);
    expect(f.message).toContain('或者删掉这个数字');
    expect(r.keyed.get('E5')).toMatchObject({ ref: `[[${NOTE}#^c4]]`, stance: 'refutes', claimId: 'C1' });
    expect(issued.has('E5')).toBe(true);
    // the next round offers the same key again, it does not add another
    await numberFailures({ vault, log: async () => {}, results: [r], issuedKeys: issued }, body);
    expect([...r.keyed.keys()]).toEqual(['E4', 'E5']);
  });

  it('a number only on the fetched page (838 organizations): the sentence is added to the note as a new block, logged', async () => {
    const vault = await vaultWithNote();
    const [c3] = await restoreEvidence(vault, [{ claim: 'C1', sub: 'C1-Q1', ref: `[[${NOTE}#^c3]]`, stance: 'supports', core: false, partial: false, round: 'web1', reason: '' }]);
    const r = resultWith([['E1', c3]]);
    const body = `## Summary\n- 理由：Futurum 调查了 838 家组织[^1]\n\n## 引文出处\n[^1]: “${c3.quote}”（C 级，网络 · AI 定级）[[${NOTE}#^c3]]\n`;
    const logs: string[] = [];
    const [f] = await numberFailures({ vault, log: async (a, c) => void logs.push(`${a} ${c}`), results: [r] }, body);
    expect(f.message).toMatch(/改引 \[E2\]——同一份资料里含这个数字的原句：“A comprehensive study of 838 organizations reveals/);
    expect(r.keyed.get('E2')).toMatchObject({ ref: `[[${NOTE}#^c6]]` });
    const note = await vault.read(`10_资料库/${NOTE}.md`);
    expect(note.body).toMatch(/^- 「A comprehensive study of 838 organizations[^」]*」— 位置：抓取原文（数字核对时补的块） \^c6$/m);
    expect((await vault.getBlocks(`10_资料库/${NOTE}.md`)).get('c6')).toBeDefined();
    expect(logs).toEqual([expect.stringMatching(/^research:block-added .*\^c6（含 838）/)]);
    // check_citations accepts the new block with its quote
    const cites = await vault.checkCitations(`“${r.keyed.get('E2')!.quote}” [[${NOTE}#^c6]]`);
    expect(cites.every((c) => c.ok)).toBe(true);
  });

  it('a number the source does not have anywhere: drop it (no key is made up)', async () => {
    const vault = await vaultWithNote();
    const [c3] = await restoreEvidence(vault, [{ claim: 'C1', sub: 'C1-Q1', ref: `[[${NOTE}#^c3]]`, stance: 'supports', core: false, partial: false, round: 'web1', reason: '' }]);
    const r = resultWith([['E1', c3]]);
    const body = `## Summary\n- 理由：技术岗掌握 64% 的决策[^1]\n\n## 引文出处\n[^1]: “${c3.quote}”（C 级）[[${NOTE}#^c3]]\n`;
    const [f] = await numberFailures({ vault, log: async () => {}, results: [r] }, body);
    expect(f.message).toContain('这份资料里找不到含这个数字的原句：删掉这个数字，或者换成原文里真有的说法');
    expect([...r.keyed.keys()]).toEqual(['E1']);
  });

  it('a follow-up checks only what it wrote: vN\'s lines are skipped', async () => {
    const vault = await vaultWithNote();
    const body = `## Summary\n- 理由：CIO 只占 12%[^4]\n\n## 引文出处\n[^4]: “collectively control 72% of AI purchasing decisions”（C 级）[[${NOTE}#^c3]]\n`;
    expect(await numberFailures({ vault, log: async () => {}, results: [], onlyLines: (_, t) => t !== '- 理由：CIO 只占 12%[^4]' }, body)).toEqual([]);
  });

  it('page sentences and a new block are plain text helpers', () => {
    expect(pageSentences('## 论断\n\n- 「x」 ^c1\n\n## 抓取原文\n\n# Title here is long enough\n\nA comprehensive study of 838 organizations reveals a shift. Short.\n')).toEqual(['Title here is long enough', 'A comprehensive study of 838 organizations reveals a shift.']);
    expect(withNewBlock('## 论断\n\n- 「a」 ^c1\n- 「b」 ^c2\n\n## 抓取原文\n…', 'new sentence', ['c1', 'c2'])).toEqual({ body: '## 论断\n\n- 「a」 ^c1\n- 「b」 ^c2\n- 「new sentence」— 位置：抓取原文（数字核对时补的块） ^c3\n\n## 抓取原文\n…', id: 'c3' });
    expect(blockQuote('「原文 72%」— 位置：p.3')).toBe('原文 72%');
  });
});

describe('in a mock run', () => {
  it('a support line with a number its quote does not have: repaired first, then flagged (number_flags, page tag), the report delivered (D-21-4 f)', async () => {
    const { setup, scriptedModel, fakeWeb } = await import('./research-fixture');
    const { executeResearch } = await import('@/lib/research/execute');
    const { clearPageCache } = await import('@/lib/research/page-cache');
    clearPageCache();
    const fx = await setup({ approved: true });
    try {
      const judge = (k: { supports: string[]; refutes: string[] }) => ({
        verdict: '成立',
        rebutted: k.refutes,
        revised_statement: null,
        support_lines: [`IT 部门主导了 77% 的采购 [${k.supports[0]}]`],
        counter_lines: [],
        challenge_responses: k.refutes.map((c) => ({ key: c, challenge: '员工会绕开', response: `资料说 IT 部门主导采购 [${k.supports[0]}]；推断：推不翻`, effect: '推不翻' })),
        reasoning: `IT 主导 [${k.supports[0]}]`,
        model_knowledge: [],
        so_what: [],
        gaps: [],
        expert_questions: [],
      });
      const m = scriptedModel({ judge, reword: (c) => c }); // the rewrite keeps the number: nothing fixes it
      const r = await executeResearch({ ctx: fx.ctx, mode: 'small', model: m.model, webClient: fakeWeb() });
      expect(m.tasks).toContain('repair'); // the repair round ran first
      expect(r.delivered).toBe(true);
      expect(r.failedChecks).toEqual([]);
      const report = await fx.vault.read(r.reportPath);
      expect(report.data.number_flags).toEqual([expect.objectContaining({ check: 'number_not_in_quote', numbers: ['77%'], text: expect.stringContaining('IT 部门主导了 77% 的采购') })]);
      expect((await fx.vault.readLog(fx.ctx.logPath)).some((x) => x.action === 'research:number-flagged' && x.change.includes('77%'))).toBe(true);
      // the page marks it, recomputed on display
      const citations = await resolveReportCitations(fx.vault, report.body, r.reportPath);
      const html = renderToString(createElement(ReportViewer, { markdown: report.body, citations })).replace(/<!-- -->/g, '');
      expect(html).toContain('data-testid="number-warnings"');
      expect(html).toContain('data-testid="number-warning-tag"');
    } finally {
      await fx.cleanup();
    }
  });
});

describe('N1: a decision footnote is cited by its quote and its note (no block)', () => {
  // M1's live small run on S0 (A2): [^7] and [^8] are the [W#] footnotes code wrote for the directive row
  const defs = readFileSync('tests/fixtures/n1/a2-decision-footnotes.md', 'utf8').trim();
  const body = (d: string) => `## Summary\n- AI 的推荐判断：按决定办[^7][^8]\n\n## 怎么查的\n\n## 逐个假设\n\n## 对 workplan 的影响\n\n## 引文出处\n${d}\n`;

  it('the self-check no longer says "没有写出原文和块链接" for them; the quote is checked against the decision note', async () => {
    const { checkReportText, decisionFailures } = await import('@/lib/research/selfcheck');
    expect(checkReportText(body(defs)).filter((f) => f.code === 'missing_quote')).toEqual([]);
    expect(await decisionFailures(createVault('demo-vault'), body(defs))).toEqual([]);
    // a quote the decision does not have is still caught
    const wrong = defs.replace('要论证付费意愿', '要论证购买意愿');
    expect((await decisionFailures(createVault('demo-vault'), body(wrong))).map((f) => f.code)).toEqual(['decision_quote_mismatch']);
  });

  it('a source footnote without a block is still refused; a decision footnote without a quote too', async () => {
    const { checkReportText } = await import('@/lib/research/selfcheck');
    const noBlock = '[^7]: “IT 部门主导采购”（C 级，网络 · AI 定级）[[资料甲]]\n[^8]: （决定）[[20_项目/个人AI战略/决策/W1决定-AI PC渗透不作为付费意愿证据]]';
    expect(checkReportText(body(noBlock)).filter((f) => f.code === 'missing_quote').map((f) => f.excerpt)).toEqual(['[^7]', '[^8]']);
  });
});
