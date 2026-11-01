/**
 * compose_workplan (OWNER: M1) — steps 1–3 and 6 of the workplan harness (D-61): a free-form holistic judgment,
 * a strategic evaluation by a fresh call, one revision, then the tree is compiled from it, rendered into the usual
 * workplan note and written with the same guards as write_draft. Only offered once the user confirmed the frame
 * (lib/workplan/compose/gate.ts).
 */
import { z } from 'zod';
import { composeWorkplan, type ComposeResult } from '@/lib/workplan/compose/compose';
import type { ToolSpec } from '../types';

export const composeWorkplanParameters = z.object({});

export const composeWorkplanTool: ToolSpec<typeof composeWorkplanParameters, ComposeResult> = {
  name: 'compose_workplan',
  description:
    'Judge the confirmed question as a whole, have the judgment evaluated and revised once, compile its key uncertainties into a question tree with one falsifiable hypothesis per lowest sub-question, and write the workplan and its hypothesis notes. Takes a few minutes.',
  parameters: composeWorkplanParameters,
  owner: 'M1',
  implemented: true,
  execute: (_args, ctx) => composeWorkplan(ctx),
  summarize: (_a, r) =>
    r?.status === 'done' ? `拆题完成：workplan v${r.version}，${r.hypotheses} 个假设` : '拆题',
};
