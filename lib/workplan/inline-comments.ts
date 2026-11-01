/**
 * Comments written on a workplan version itself (not in a review): machine data in the Workspace,
 * `<workspacePath>/评论/workplan v<N>.json`. The vault lists `.md` only, so the file is never read as a note
 * (same handling as the chat log). A workplan change may cite one as `[[<workspacePath>/评论/workplan v<N>#<id>]]`
 * (lib/workplan/draft-checks.ts accepts it next to the `^mN` blocks of review notes).
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import type { Vault } from '@/lib/vault';

export const inlineCommentSchema = z.object({
  /** `c1`, `c2` … in the order they were written. */
  id: z.string().regex(/^c\d+$/),
  author: z.string().min(1),
  text: z.string().trim().min(1),
  /** A heading of the workplan the comment is about. */
  target: z.string().optional(),
  created: z.string(),
});
export type InlineComment = z.infer<typeof inlineCommentSchema>;

const fileSchema = z.object({ version: z.literal(1), comments: z.array(inlineCommentSchema) });

function checkedWorkspace(workspacePath: string): string {
  if (workspacePath.startsWith('/') || workspacePath.includes('..')) throw new Error(`invalid workspace path: ${workspacePath}`);
  return workspacePath;
}

/** `<workspacePath>/评论/workplan v<N>.json` (vault-relative, posix). */
export const inlineCommentsPath = (workspacePath: string, version: number): string => {
  if (!Number.isInteger(version) || version < 1) throw new Error(`invalid workplan version: ${version}`);
  return path.posix.join(checkedWorkspace(workspacePath), '评论', `workplan v${version}.json`);
};

/** `[[<workspacePath>/评论/workplan v<N>#<id>]]`: what `workplan.changes[].comment` stores for such a comment. */
export const inlineCommentLink = (workspacePath: string, version: number, id: string): string =>
  `[[${path.posix.join(checkedWorkspace(workspacePath), '评论', `workplan v${version}`)}#${id}]]`;

/** The target of a link of that shape, or null when it is not one (a review comment, a note link ...). */
export function parseInlineCommentLink(link: string): { path: string; version: number; id: string } | null {
  const m = /^\[\[(.+\/评论\/workplan v(\d+))#(c\d+)(?:\|[^\]]*)?\]\]$/.exec(link.trim());
  return m ? { path: `${m[1]}.json`, version: Number(m[2]), id: m[3] } : null;
}

function absolute(vault: Vault, rel: string): string {
  const root = path.resolve(vault.root);
  const full = path.resolve(root, rel);
  if (!full.startsWith(root + path.sep)) throw new Error(`path escapes the vault: ${rel}`);
  return full;
}

/** The saved comments of a version; [] when there is no file or it cannot be read. */
export async function readInlineComments(vault: Vault, workspacePath: string, version: number): Promise<InlineComment[]> {
  try {
    const parsed = fileSchema.safeParse(JSON.parse(await readFile(absolute(vault, inlineCommentsPath(workspacePath, version)), 'utf8')));
    return parsed.success ? parsed.data.comments : [];
  } catch {
    return [];
  }
}

/** Add one comment (atomic write); returns it with its id and the link to cite. */
export async function addInlineComment(
  vault: Vault,
  workspacePath: string,
  version: number,
  input: { author: string; text: string; target?: string },
  now: Date = new Date(),
): Promise<{ comment: InlineComment; link: string }> {
  const existing = await readInlineComments(vault, workspacePath, version);
  const n = existing.reduce((max, c) => Math.max(max, Number(c.id.slice(1))), 0) + 1;
  const comment = inlineCommentSchema.parse({ id: `c${n}`, author: input.author, text: input.text, ...(input.target ? { target: input.target } : {}), created: now.toISOString() });
  const full = absolute(vault, inlineCommentsPath(workspacePath, version));
  await mkdir(path.dirname(full), { recursive: true });
  const tmp = `${full}.tmp`;
  await writeFile(tmp, `${JSON.stringify({ version: 1, comments: [...existing, comment] }, null, 1)}\n`, 'utf8');
  await rename(tmp, full);
  return { comment, link: inlineCommentLink(workspacePath, version, comment.id) };
}

/** Does this link point at a comment that exists in `workspacePath`'s own 评论 folder? */
export async function inlineCommentExists(vault: Vault, workspacePath: string, link: string): Promise<boolean> {
  const parsed = parseInlineCommentLink(link);
  if (!parsed || !parsed.path.startsWith(`${checkedWorkspace(workspacePath)}/评论/`)) return false;
  return (await readInlineComments(vault, workspacePath, parsed.version)).some((c) => c.id === parsed.id);
}
