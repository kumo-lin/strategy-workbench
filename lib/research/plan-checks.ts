/**
 * Write-time check on a research plan draft (called from lib/workplan/draft-checks.ts, the hook
 * write_draft already runs). A plan may quote sources: 「原文」[[资料#^cN]]. The model sometimes puts its
 * own Chinese paraphrase inside 「」 right before the block link, which then reads as a verbatim
 * quote. Every block citation in the plan is therefore checked like a report's: the block must exist
 * and anything in 「」 / “” in front of the link must be in that block. A failure is thrown back to
 * the model with the true text of the block, so it can fix the draft.
 */
import type { ToolContext } from '@/lib/harness/types';
import { loadPerspectives } from '@/lib/config/perspectives';
import type { CitationCheck } from '@/lib/vault';
import type { Vault } from '@/lib/vault';
import { unknownPerspectives, type PerspectiveFields } from './perspectives';
import { treeChecks, type TreePlan } from './question-tree';

export function describePlanCitationFailure(c: CitationCheck): string {
  switch (c.error) {
    case 'quote_mismatch':
      return `「${c.quote ?? ''}」和 ${c.link} 指向的原文对不上。那个块里实际写的是：${c.blockText ?? '（读不到）'}。「」里只能逐字放资料原文；你自己的意译不要加「」（直接写成普通句子，后面附上 ${c.link}），或者改成块里的原话。`;
    case 'block_not_found':
      return `${c.link} 指向的块不存在${c.path ? `（资料 ${c.path} 里没有这个 ^块）` : ''}。先用 vault_read 看资料里真实的 ^cN，再引用。`;
    case 'note_not_found':
      return `${c.link} 指向的资料不存在。先用 vault_search 找到真实的资料名。`;
    case 'ambiguous':
      return `${c.link} 的资料名有歧义，请写完整路径。`;
    default:
      return `${c.link} 有问题`;
  }
}

export async function checkPlanDraft(body: string, ctx: Pick<ToolContext, 'vault'>, frontmatter?: Record<string, unknown>): Promise<void> {
  // perspectives must be the team list's own words (D-32); a missing one is only flagged on the plan page, never refused
  if (frontmatter && Array.isArray(frontmatter.claims)) {
    const list = await loadPerspectives(ctx.vault);
    const unknown = unknownPerspectives(frontmatter as unknown as PerspectiveFields, list);
    if (unknown.length) throw new Error(`计划里的视角“${unknown.join('、')}”不在团队的视角清单里，计划没有写入。perspective 只能从这些里选：${list.join('、')}。`);
    // D-39: the question tree's deterministic checks (one hypothesis per lowest-level sub-question, a verification plan each…)
    const tree = [...treeChecks(frontmatter as unknown as TreePlan), ...keyQuestionProblems(frontmatter.claims as never).map((message) => ({ message }))];
    if (tree.length) throw new Error(`计划的问题树有 ${tree.length} 处没通过检查，计划没有写入：\n${tree.map((t, i) => `${i + 1}. ${t.message}`).join('\n')}`);
  }
  const results = await ctx.vault.checkCitations(body);
  const failed = results.filter((r) => !r.ok);
  if (failed.length === 0) return;
  throw new Error(`计划里有 ${failed.length} 处引用没通过检查，计划没有写入：\n${failed.map((f, i) => `${i + 1}. ${describePlanCitationFailure(f)}`).join('\n')}`);
}

/**
 * What keeps a plan from being approved (D-39): the question tree's checks, on the version the owner approves. The
 * approval event itself is unchanged; the approve route asks this first. An older-format plan has none.
 */
export async function planApprovalProblems(vault: Pick<Vault, 'read'>, planPath: string): Promise<string[]> {
  const note = await vault.read(planPath);
  return note.note?.type === 'research_plan' ? [...treeChecks(note.note).map((t) => t.message), ...keyQuestionProblems(note.note.claims)] : [];
}

/**
 * D-64 T21 (step 4): every key question (K1–K4) the investigation plan takes up has 2 to 3 competing hypotheses.
 * A plan without keys (older format) has nothing to check.
 */
export function keyQuestionProblems(claims: { id: string; key?: string | null; statement: string }[]): string[] {
  const byKey = new Map<string, string[]>();
  for (const c of claims) if (c.key) byKey.set(c.key, [...(byKey.get(c.key) ?? []), c.id]);
  const out: string[] = [];
  for (const [key, ids] of byKey) {
    if (ids.length < 2) out.push(`${key} 下只有 1 个假设（${ids.join('、')}）：一个关键问题要并列 2 到 3 个竞争假设，各写条件、证据和去哪里查`);
    if (ids.length > 3) out.push(`${key} 下有 ${ids.length} 个假设（${ids.join('、')}）：最多 3 个，合并相近的`);
  }
  return out;
}
