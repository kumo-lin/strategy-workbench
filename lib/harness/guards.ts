/**
 * System-enforced AI rules (PRD §7, the ⚙ items). Prompts are not trusted to
 * enforce these.
 */
import { AI_AUTHOR, AI_WRITABLE_STATUSES, type NoteStatus } from '@/lib/notes/schema';

/** Fields only a human approval event may set (§7 rules 10, 11). */
export const HUMAN_ONLY_FIELDS = ['approved_by', 'approved_at', 'approved_by_owner', 'verdict', 'decided_by', 'published_by', 'published_at'] as const;

export class AiWriteDenied extends Error {
  name = 'AiWriteDenied';
}

/** Throws unless an AI-authored frontmatter respects the human-only rules. */
export function assertAiWritable(frontmatter: Record<string, unknown>): void {
  if (frontmatter.author !== AI_AUTHOR) throw new AiWriteDenied(`AI writes must have author: ${AI_AUTHOR}`);
  const status = frontmatter.status as NoteStatus;
  if (!AI_WRITABLE_STATUSES.includes(status)) {
    throw new AiWriteDenied(`AI may not set status "${status}" (allowed: ${AI_WRITABLE_STATUSES.join(', ')})`);
  }
  for (const f of HUMAN_ONLY_FIELDS) {
    const v = frontmatter[f];
    if (v !== undefined && v !== null) throw new AiWriteDenied(`AI may not set ${f}; only a human approval event can`);
  }
}
