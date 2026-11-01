/**
 * D-64 T33: the two writes of a new project's framing (phase project_framing). The AI drafts; only the Senior
 * confirms (lib/project/contract.ts confirmContract, from the project page).
 *   draft_contract   → 20_项目/<项目>/决策契约.md, status 推断 (D63 §3.1.1); refused once the Senior confirmed it
 *   draft_issue_tree → 项目.md `issue_tree` (D63 §3.1.2); a known item keeps its Workspace
 */
import { z } from 'zod';
import { loadRoles } from '@/lib/config/roles';
import { AI_AUTHOR, issueTreeSchema } from '@/lib/notes/schema';
import type { ToolSpec } from '../types';

const today = (d: Date) => d.toISOString().slice(0, 10);
const projectLink = (projectPath: string) => `[[${projectPath}/项目|项目]]`;

export const draftContractParameters = z.object({
  question: z.string().trim().min(1).describe('要回答的问题（改写后），一句话。'),
  original_question: z.string().trim().optional().describe('用户最初的题目，原话。'),
  decision: z.string().trim().min(1).describe('要做的决定：做完以后要在哪几个选项里选。'),
  decision_owner: z.string().trim().min(1).describe('决策负责人：谁来做这个决定。'),
  horizon: z.string().trim().min(1).describe('时间：行动的年份和展望的年份。'),
  geography: z.string().trim().min(1).describe('地域。'),
  product_scope: z.string().trim().min(1).describe('产品范围。'),
  out_of_scope: z.array(z.string().trim().min(1)).describe('不研究什么。'),
  success: z.string().trim().min(1).describe('成功的样子：看到什么就算做成了。'),
  known: z.array(z.string().trim().min(1)).describe('已知的事实（别再当不确定的事去查）。'),
  bar: z.string().trim().min(1).describe('证据门槛。'),
});

export const draftContractTool: ToolSpec<typeof draftContractParameters, { path: string }> = {
  name: 'draft_contract',
  description: 'Write the decision contract of this project (决策契约.md) from what the user confirmed. It stays 推断 until the Senior confirms it on the project page.',
  parameters: draftContractParameters,
  owner: 'M1',
  implemented: true,
  async execute(args, ctx) {
    const path = `${ctx.projectPath}/决策契约.md`;
    const existing = await ctx.vault.read(path).catch(() => null);
    if (existing?.data.status === '已确认') throw new Error('决策契约已经由 Senior 确认，不能再改；要改请 Senior 先在项目页退回');
    const now = ctx.now();
    const body = [
      '# 决策契约',
      '',
      '> AI 起草，状态“推断”，等 Senior 确认。',
      '',
      `- **要回答的问题**：${args.question}`,
      ...(args.original_question ? [`- **原题**：${args.original_question}`] : []),
      `- **要做的决定**：${args.decision}`,
      `- **决策负责人**：${args.decision_owner}`,
      `- **时间**：${args.horizon}`,
      `- **地域**：${args.geography}`,
      `- **产品范围**：${args.product_scope}`,
      `- **不研究**：${args.out_of_scope.join('、') || '—'}`,
      `- **成功的样子**：${args.success}`,
      `- **已知**：${args.known.join('；') || '—'}`,
      `- **证据门槛**：${args.bar}`,
      '',
    ].join('\n');
    await ctx.vault.write(
      path,
      {
        frontmatter: {
          id: String(existing?.data.id ?? `contract-${now.getTime().toString(36)}`),
          type: 'contract',
          status: '推断',
          created: String(existing?.data.created ?? today(now)),
          updated: today(now),
          author: AI_AUTHOR,
          derived_from: [projectLink(ctx.projectPath)],
          relates_to: [projectLink(ctx.projectPath)],
          ...args,
          original_question: args.original_question ?? null,
          approved_by: null,
          approved_at: null,
        },
        body,
      },
      { overwrite: Boolean(existing) },
    );
    return { path };
  },
  summarize: (_a, r) => `起草决策契约${r ? `（${r.path.split('/').pop()}，推断，等 Senior 确认）` : ''}`,
};

const lineSchema = z.object({
  id: z.string().trim().min(1).describe('工作线编号：A、B……'),
  title: z.string().trim().min(1),
  question: z.string().trim().min(1).describe('这条线要回答的问题，问句。'),
  owner: z.string().trim().nullable().optional().describe('负责人的角色 id（例如 junior-a），不知道就不填。'),
  items: z.array(z.object({ id: z.string().trim().min(1).describe('子课题编号：M1、L2……'), title: z.string().trim().min(1), waits_for: z.array(z.string()).optional() })).min(1),
});
export const draftIssueTreeParameters = z.object({ question: z.string().trim().min(1), lines: z.array(lineSchema).min(1) });

export const draftIssueTreeTool: ToolSpec<typeof draftIssueTreeParameters, { items: number; problems: string[] }> = {
  name: 'draft_issue_tree',
  description: 'Write the issue tree of this project (工作线 → 子课题, with who leads each line and which item waits for which). Items not started have no Workspace.',
  parameters: draftIssueTreeParameters,
  owner: 'M1',
  implemented: true,
  async execute(args, ctx) {
    const path = `${ctx.projectPath}/项目.md`;
    const note = await ctx.vault.read(path);
    const roleIds = new Set((await loadRoles(ctx.vault)).map((r) => r.id));
    const known = new Map<string, string | null>();
    const old = issueTreeSchema.safeParse(note.data.issue_tree);
    if (old.success) for (const l of old.data.lines) for (const it of l.items) known.set(it.id, it.workspace);
    const ids = args.lines.flatMap((l) => l.items.map((i) => i.id));
    const problems: string[] = [];
    const dup = ids.filter((id, i) => ids.indexOf(id) !== i);
    if (dup.length) throw new Error(`子课题编号重复：${[...new Set(dup)].join('、')}`);
    const tree = issueTreeSchema.parse({
      question: args.question,
      lines: args.lines.map((l) => {
        const owner = l.owner && roleIds.has(l.owner) ? l.owner : null;
        if (l.owner && !owner) problems.push(`${l.id} 的负责人 ${l.owner} 不是团队里的角色，先不指派`);
        return {
          id: l.id,
          title: l.title,
          question: l.question,
          owner,
          items: l.items.map((i) => {
            const waits = (i.waits_for ?? []).filter((w) => ids.includes(w) && w !== i.id);
            for (const w of i.waits_for ?? []) if (!waits.includes(w)) problems.push(`${i.id} 等的 ${w} 不在议题树里，去掉了`);
            return { id: i.id, title: i.title, workspace: known.get(i.id) ?? null, waits_for: waits };
          }),
        };
      }),
    });
    await ctx.vault.write(path, { frontmatter: { ...note.data, issue_tree: tree, updated: today(ctx.now()) }, body: note.body }, { overwrite: true });
    return { items: ids.length, problems };
  },
  summarize: (a, r) => `起草议题树：${a.lines.length} 条工作线、${r?.items ?? 0} 个子课题${r?.problems.length ? `；${r.problems.join('；')}` : ''}`,
};
