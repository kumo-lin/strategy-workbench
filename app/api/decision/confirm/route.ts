/**
 * POST /api/decision/confirm — the Senior's buttons: save their edit, confirm (`decision.confirm`), or return the draft
 * with a reason (`decision.reject`). The Senior check is applyApprovalEvent's. D-64 T17: the edit comes as the three
 * fields (决定, 理由, 适用边界); a whole `body` is still taken until the panel moves to the fields (T41).
 */
import { z } from 'zod';
import { confirmDecision, loadDecision, loadDecisionCard, returnDecision, saveDecisionEdit, saveDecisionFields, withFields } from '@/lib/decisions/review';
import { getCurrentRole } from '@/lib/session/role';
import { getVault } from '@/lib/vault';
import { handleJson } from '@/lib/workplan/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z
  .object({
    decision: z.string().regex(/^20_项目\/[^/]+\/决策\/[^/]+\.md$/),
    /** The text as the Senior left it (the older panel); omit to confirm the draft as it is. */
    body: z.string().optional(),
    /** The three fields as the Senior left them. */
    fields: z.object({ decision: z.string(), reason: z.string(), scope: z.string() }).optional(),
    /** save = keep the edit, stay 推断; confirm = save, check and confirm; return = send it back with a reason. */
    action: z.enum(['save', 'confirm', 'return']).default('confirm'),
    /** Required for return. */
    reason: z.string().trim().min(1).max(2000).optional(),
  })
  .refine((i) => i.action !== 'save' || i.body !== undefined || i.fields !== undefined, { message: 'save needs fields', path: ['fields'] })
  .refine((i) => i.action !== 'return' || i.reason !== undefined, { message: '退回要写明理由', path: ['reason'] });

export async function POST(req: Request) {
  return handleJson(req, bodySchema, getCurrentRole, async (input, actor) => {
    const vault = getVault();
    const decisionPath = input.decision;
    let result: object;
    if (input.action === 'return') result = await returnDecision({ vault, actor, decisionPath, reason: input.reason! });
    else if (input.action === 'save') {
      result = input.fields
        ? await saveDecisionFields({ vault, actor, decisionPath, fields: input.fields })
        : await saveDecisionEdit({ vault, actor, decisionPath, body: input.body ?? '' });
    } else {
      if (input.fields) await saveDecisionFields({ vault, actor, decisionPath, fields: input.fields });
      const body = input.fields ? withFields((await loadDecision(vault, decisionPath)).body, input.fields) : input.body;
      result = await confirmDecision({ vault, actor, decisionPath, body });
    }
    // The card as stored now, so the page shows it without refetching.
    return { ...result, card: await loadDecisionCard(vault, decisionPath) };
  });
}
