/**
 * ask_user — the question card (PRD §6.3 step 2, §10.5). A CLIENT tool: no
 * server execute. The UI renders the call as a card; the user's answer is
 * sent back with `addToolResult` / `addToolOutput` as this call's output, and
 * the model continues. Adapted from the reference runtime's ask-user tool
 * (see THIRD_PARTY_NOTICES).
 */
import { z } from 'zod';
import type { ToolSpec } from '../types';

export const askUserParameters = z.object({
  question: z.string().trim().min(1).describe('The question, self-contained, phrased for the user.'),
  options: z
    .array(
      z.object({
        id: z.string().trim().min(1).describe('Short stable id, unique across options.'),
        label: z.string().trim().min(1).describe('Human-readable option label.'),
      }),
    )
    .optional()
    .refine((opts) => !opts || new Set(opts.map((o) => o.id)).size === opts.length, {
      message: 'option ids must be unique',
    })
    .describe('Optional choices rendered as buttons. The user can always type a free answer.'),
  multiSelect: z.boolean().optional().describe('True when several options may be picked.'),
});
export type AskUserInput = z.infer<typeof askUserParameters>;

/** What the UI sends back as the tool output. */
export const askUserOutputSchema = z.object({
  /** Picked option ids (empty for a free-text answer). */
  selected: z.array(z.string()),
  /** Free text the user typed, if any. */
  text: z.string().optional(),
});
export type AskUserOutput = z.infer<typeof askUserOutputSchema>;

export const askUserTool: ToolSpec<typeof askUserParameters, AskUserOutput> = {
  name: 'ask_user',
  description:
    'Ask the user a question and wait for the answer. Use it whenever a decision belongs to the human (scope, which claims, which option) instead of guessing. One question per call.',
  parameters: askUserParameters,
  owner: 'M0',
  implemented: true,
};
