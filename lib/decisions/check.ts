/**
 * The rule behind "决定 + 理由" (PRD §6.4, §7 rules 10–13): every reason carries a block
 * citation to evidence THE REPORT ITSELF cites, with the quote written before it. The
 * system checks this when the AI drafts, when the Senior saves an edit and again at
 * confirmation, so a decision can never claim more than its report.
 */
import { withFootnotesInline } from '@/lib/research/report';
import { extractWikiLinks, type Vault } from '@/lib/vault';

export const REASONS_HEADING = '## 理由';

/** The top-level list items of the "## 理由" section (an item may continue on indented lines). */
export function reasonItems(body: string): string[] {
  const lines = body.split(/\r?\n/);
  const start = lines.findIndex((l) => l.trim() === REASONS_HEADING);
  if (start < 0) return [];
  const items: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (/^#{1,6}\s/.test(line)) break;
    if (/^[-*]\s+/.test(line)) items.push(line.replace(/^[-*]\s+/, ''));
    else if (items.length && line.trim() && /^\s/.test(line)) items[items.length - 1] += ` ${line.trim()}`;
  }
  return items;
}

/** `path#block` of every block citation in a text that resolves, so two spellings of one link compare equal. */
export async function citedBlocks(vault: Vault, text: string, fromPath: string): Promise<Set<string>> {
  const out = new Set<string>();
  for (const c of await vault.checkCitations(text, { fromPath })) if (c.path && c.block) out.add(`${c.path}#${c.block}`);
  return out;
}

const VERDICT_LINE = /提议的判断[^：:\n]*[：:]\s*\**\s*(成立|不成立|需要修改|需要修正|证据不足)/;

/**
 * Blocks the report cites ONLY under hypotheses it judged 证据不足. Such a claim says "we do not
 * know yet", so it can be a gap or a reason to reconsider, never ground for a decision.
 */
export async function insufficientOnlyBlocks(vault: Vault, reportBody: string, reportPath: string): Promise<Set<string>> {
  // a question-tree report (D-39) puts a hypothesis under "### 假设 H1" or "#### 假设 H2-1"
  const sections = reportBody.split(/^(?=#{3,4} )/m).filter((s) => /^#{3,4} /.test(s));
  const weak = new Set<string>();
  const firm = new Set<string>();
  for (const sec of sections) {
    const verdict = VERDICT_LINE.exec(sec.split(/^## /m)[0])?.[1];
    if (!verdict) continue;
    // D-20 reports cite through footnotes: a marker in the section stands for the block citation in its definition
    const text = withFootnotesInline(sec.split(/^## /m)[0], reportBody);
    for (const b of await citedBlocks(vault, text, reportPath)) (verdict === '证据不足' ? weak : firm).add(b);
  }
  return new Set([...weak].filter((b) => !firm.has(b)));
}

export interface DecisionCheck {
  ok: boolean;
  /** Chinese, one per problem. */
  problems: string[];
}

/** Check a decision body against its report. */
export async function checkDecisionBody(
  vault: Vault,
  opts: { decisionPath: string; reportPath: string; body: string; /** citedBlocks of the report, when the caller already has it */ inReport?: Set<string> },
): Promise<DecisionCheck> {
  const { decisionPath, reportPath, body } = opts;
  const problems: string[] = [];
  const reasons = reasonItems(body);
  if (reasons.length === 0) problems.push(`正文里没有「${REASONS_HEADING}」一节，或这一节下面没有列出理由`);

  const inReport = opts.inReport ?? (await citedBlocks(vault, (await vault.read(reportPath)).body, reportPath));

  const checks = new Map((await vault.checkCitations(body, { fromPath: decisionPath })).map((c) => [c.link, c]));
  for (const [i, reason] of reasons.entries()) {
    const label = `理由 ${i + 1}「${reason.replace(/\s+/g, ' ').slice(0, 24)}…」`;
    const links = extractWikiLinks(reason).filter((l) => l.block);
    if (links.length === 0) {
      problems.push(`${label}没有报告里的块引用`);
      continue;
    }
    for (const l of links) {
      const c = checks.get(l.raw) ?? (await vault.checkCitation(l.raw, { fromPath: decisionPath }));
      if (!c.ok) problems.push(`${label}的引用 ${l.raw} 对不上（${c.error ?? '未知'}）`);
      else if (!c.quote) problems.push(`${label}的引用 ${l.raw} 前面没有写出原文`);
      else if (!inReport.has(`${c.path}#${c.block}`)) problems.push(`${label}的引用 ${l.raw} 报告里没有引用过：决定不能比报告说得更满`);
    }
  }
  return { ok: problems.length === 0, problems };
}
