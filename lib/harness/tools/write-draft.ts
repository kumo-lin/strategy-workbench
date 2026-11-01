/**
 * write_draft — the AI's only write path for content notes (PRD §10.2).
 *
 * Enforced here, not in prompts:
 *   - note type must be in WRITE_DRAFT_SCOPE[phase]
 *   - the note lands in the folder its type belongs to (§9.1)
 *   - author = AI, status ∈ {进行中, 推断, 探索性}, no human-only fields (§7)
 *   - derived_from / relates_to present and resolvable (vault.write, §9.3)
 *   - an approved / human-confirmed note is never overwritten (versions are kept)
 *   - research_plan / report get `exploratory` from ctx (D-8); after D-56 G1 is only an
 *     opinion, so nothing is "before approval" and new notes are never exploratory
 */
import { z } from 'zod';
import { AI_AUTHOR, AI_WRITABLE_STATUSES, NOTE_TYPES, type NoteType } from '@/lib/notes/schema';
import { VaultError } from '@/lib/vault';
import { WRITE_DRAFT_SCOPE } from '../phases';
import { assertAiWritable, HUMAN_ONLY_FIELDS } from '../guards';
// The one place the frozen core depends on a session-owned file (CONTRACT-CHANGE m1-1,
// approved by the dev console): workplan drafts need vault-reading checks (version chain,
// every changes[].comment resolves to a review comment block) at the AI's only write path.
// checkDraft returns immediately for every other note type.
import { checkDraft } from '@/lib/workplan/draft-checks';
import { ToolNotAllowedError, type ToolContext, type ToolSpec } from '../types';
import { localDate } from '@/lib/local-date';

export const writeDraftParameters = z.object({
  note_type: z.enum(NOTE_TYPES).describe('Note type. Only the types allowed in the current phase are accepted.'),
  name: z
    .string()
    .trim()
    .min(1)
    .describe('File name without .md. Versioned types: "workplan v2", "计划 v1", "报告 v1". Hypothesis: "WS-A-H2 <短述>".'),
  frontmatter: z
    .record(z.string(), z.unknown())
    .describe(
      'Type-specific fields plus id, derived_from and relates_to (lists of "[[wikilink]]", both required). type/author/created/updated are filled in for you.',
    ),
  body: z.string().describe('Markdown body.'),
  status: z.enum(AI_WRITABLE_STATUSES as [string, ...string[]]).default('进行中'),
});

const NAME_PATTERNS: Partial<Record<NoteType, RegExp>> = {
  workplan: /^workplan v\d+$/,
  research_plan: /^计划 v\d+$/,
  report: /^报告 v\d+$/,
};

/** Folder a draft of `type` must go to, given the request context. */
export function draftDir(type: NoteType, ctx: ToolContext): string {
  switch (type) {
    case 'workplan':
      return ctx.workspacePath;
    case 'hypothesis':
      return `${ctx.projectPath}/假设`;
    case 'research_plan':
    case 'report':
      if (!ctx.research) throw new ToolNotAllowedError('write_draft', ctx.phase, `${type} needs a research context`);
      return ctx.research.dir;
    default:
      throw new ToolNotAllowedError('write_draft', ctx.phase, `write_draft has no folder for type ${type}`);
  }
}

function today(d: Date): string {
  return localDate(d);
}

export interface WriteDraftResult {
  path: string;
  created: boolean;
  /** Things worth fixing that did not stop the write (the model sees them in the result). */
  notices?: string[];
}

/**
 * The write itself, with every guard above. `write_draft` calls it for the model; the workplan decomposition
 * (lib/workplan/compose/compose.ts) calls it for the notes its code renders, so both write through the same rules.
 */
export async function writeDraftNote(args: z.infer<typeof writeDraftParameters>, ctx: ToolContext, opts: { dryRun?: boolean } = {}): Promise<WriteDraftResult> {
  const type = args.note_type;
  if (!WRITE_DRAFT_SCOPE[ctx.phase].includes(type)) {
    throw new ToolNotAllowedError(
      'write_draft',
      ctx.phase,
      `write_draft cannot write ${type} in phase ${ctx.phase} (allowed: ${WRITE_DRAFT_SCOPE[ctx.phase].join(', ')})`,
    );
  }
  const pattern = NAME_PATTERNS[type];
  if (pattern && !pattern.test(args.name)) throw new Error(`name "${args.name}" must match ${pattern}`);
  if (/[\\/]/.test(args.name)) throw new Error('name must be a file name, not a path');

  const path = `${draftDir(type, ctx)}/${args.name}.md`;
  const now = ctx.now();
  let created = today(now);
  const existing = (await ctx.vault.exists(path)) ? await ctx.vault.read(path) : null;
  if (existing) {
    const st = existing.data.status as string;
    const humanSet = HUMAN_ONLY_FIELDS.some((f) => existing.data[f] !== undefined && existing.data[f] !== null);
    if (!AI_WRITABLE_STATUSES.includes(st as never) || humanSet) {
      throw new VaultError('exists', `${path} is approved/confirmed; write a new version instead of overwriting it`);
    }
    if (typeof existing.data.created === 'string') created = existing.data.created;
  }

  const fm: Record<string, unknown> = {
    id: args.frontmatter.id ?? `${type.replace('_', '-')}-${now.getTime().toString(36)}`,
    type,
    status: args.status,
    created,
    updated: today(now),
    author: AI_AUTHOR,
    ...args.frontmatter,
  };
  // Harness-owned fields win over whatever the model sent.
  Object.assign(fm, { type, author: AI_AUTHOR, status: args.status, created, updated: today(now) });
  if (type === 'research_plan' || type === 'report') {
    fm.exploratory = ctx.exploratory;
    if (ctx.exploratory && fm.status === '进行中') fm.status = '探索性';
  }
  // Human-only fields are reset, not trusted: only an ApprovalEvent sets them.
  for (const f of HUMAN_ONLY_FIELDS) if (f in fm) fm[f] = null;
  if (type === 'workplan') Object.assign(fm, { approved_by: null, approved_at: null });
  if (type === 'research_plan') Object.assign(fm, { approved_by_owner: null, approved_at: null });
  if (type === 'hypothesis') fm.verdict = null;
  assertAiWritable(fm);
  const notices = await checkDraft(type, fm, args.body, ctx, { path, overwriting: Boolean(existing) });

  // dryRun: every check above has run (a caller writing several notes tries all of them first, so a refusal leaves nothing half written)
  if (!opts.dryRun) await ctx.vault.write(path, { frontmatter: fm, body: args.body }, { overwrite: Boolean(existing) });
  return { path, created: !existing, ...(notices?.length ? { notices } : {}) };
}

export const writeDraftTool: ToolSpec<typeof writeDraftParameters, WriteDraftResult> = {
  name: 'write_draft',
  description:
    'Write a draft note (never final): workplan / hypothesis in the workplan phase, the research plan while planning, the report while executing. Every note must say what it derives from and what it relates to.',
  parameters: writeDraftParameters,
  owner: 'M0',
  implemented: true,
  execute: writeDraftNote,
  summarize: (a, r) => `${r?.created === false ? '更新' : '新建'}草稿 ${r?.path ?? a.name}（${a.note_type}）`,
};
