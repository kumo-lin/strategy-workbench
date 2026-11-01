/**
 * The body of POST /api/research/plan: an edited plan from the plan page. zod drops keys a schema does not list, so
 * every field the editor carries must be here — the perspective fields (D-32/D-34) were missing, and each save lost
 * them: the saved version then showed every team perspective as left out. The question-tree fields (D-39) are listed
 * for the same reason.
 */
import { z } from 'zod';
import { RESEARCH_METHOD_LIST } from './plan-types';

const perspective = z.array(z.string().min(1)).optional();

export const planSaveRequestSchema = z.object({
  workspacePath: z.string(),
  researchDir: z.string(),
  plan: z.object({
    question: z.string().min(1),
    purpose: z.string().min(1),
    claims: z
      .array(
        z.object({
          id: z.string().regex(/^C\d+$/),
          statement: z.string().min(1),
          hypothesis: z.string().nullable(),
          // D-39: the sub-question this hypothesis answers, and the split top-level one it hangs under
          question: z.string().optional(),
          parent: z.string().regex(/^Q\d+$/).nullable().optional(),
          // a sentence, or the plan's three columns (empty ones are dropped when the version is saved)
          conditions: z.array(z.union([z.string(), z.object({ text: z.string(), evidence_needed: z.string().optional(), where: z.string().optional() })])),
          sub_questions: z
            .array(z.object({ id: z.string().regex(/^C\d+-Q\d+$/), question: z.string().min(1), methods: z.array(z.enum(RESEARCH_METHOD_LIST)).min(1), perspective }))
            .min(1),
          counter_search: z.string().min(1),
          perspective,
          // D-64 T36: the key question and what changes if it is bad (zod drops what it does not list)
          key: z.enum(['K1', 'K2', 'K3', 'K4']).optional(),
          if_bad: z.string().min(1).optional(),
        }),
      )
      .min(1),
    perspectives_skipped: z.array(z.object({ perspective: z.string().min(1), reason: z.string() })).optional(),
    question_tree: z.array(z.object({ id: z.string().regex(/^Q\d+$/), question: z.string() })).optional(),
    mece_check: z.string().optional(),
  }),
});
