/**
 * set_selection (D-64 T37, phase files_chat): the AI proposes what the analyst should read — files to leave out, to
 * read again, to read first, the web on or off. It never writes: the proposal comes back as a card, and only the
 * analyst's click (POST /api/workspace/selection, a person's event) changes 资料选择.json. That is how "the analyst
 * agrees in the chat first" is held by code, not by the prompt.
 */
import { z } from 'zod';
import { isFrameNote, readSelection, type Selection } from '@/lib/research/selection';
import type { ToolSpec } from '../types';

export const setSelectionParameters = z.object({
  exclude: z.array(z.string()).optional().describe('Vault paths the AI should not read for this task.'),
  include: z.array(z.string()).optional().describe('Vault paths to read again (taken off the excluded list).'),
  star: z.array(z.string()).optional().describe('Vault paths to read first.'),
  unstar: z.array(z.string()).optional(),
  web: z.boolean().optional().describe('Whether the investigation may search the web.'),
  reason: z.string().trim().min(1).describe('一句中文：为什么这样选。'),
});

export interface SelectionProposal {
  /** The selection the analyst is asked to accept (the current one with the changes). */
  proposal: Selection;
  /** What changes, in words. */
  changes: string[];
  /** Paths that are not files of the vault (dropped). */
  unknown: string[];
  /** The frame of the task (project, contract, plans…): always read, so not selectable (dropped). The real model starred 项目. */
  frame: string[];
  /** Why something was dropped, in words, for the model. */
  note?: string;
  /** Always false: nothing is written until the analyst agrees on the card. */
  applied: false;
}

const name = (p: string) => p.split('/').pop()?.replace(/\.md$/, '') ?? p;

export const setSelectionTool: ToolSpec<typeof setSelectionParameters, SelectionProposal> = {
  name: 'set_selection',
  description: 'Propose a change to what the AI reads for this Workspace (leave out, read again, read first, web on/off). Nothing changes until the analyst agrees on the card.',
  parameters: setSelectionParameters,
  owner: 'M2',
  implemented: true,
  async execute(args, ctx) {
    const current = await readSelection(ctx.vault, ctx.workspacePath);
    const unknown: string[] = [];
    const frame: string[] = [];
    const known = async (ps: string[] | undefined) => {
      const out: string[] = [];
      for (const p of ps ?? []) (isFrameNote(p) ? frame : (await ctx.vault.exists(p)) ? out : unknown).push(p);
      return out;
    };
    const [exclude, include, star, unstar] = await Promise.all([known(args.exclude), known(args.include), known(args.star), known(args.unstar)]);
    const excluded = [...new Set([...current.excluded.filter((p) => !include.includes(p)), ...exclude])];
    const starred = [...new Set([...current.starred.filter((p) => !unstar.includes(p)), ...star])];
    const web = args.web ?? current.web;
    const changes = [
      ...exclude.map((p) => `不读：${name(p)}`),
      ...include.map((p) => `重新读：${name(p)}`),
      ...star.map((p) => `优先读：${name(p)}`),
      ...unstar.map((p) => `取消优先：${name(p)}`),
      ...(web !== current.web ? [web ? '打开联网' : '关掉联网'] : []),
    ];
    const note = frame.length ? `${frame.map(name).join('、')} 是任务框架（项目、契约、研究计划等），始终会读，不能勾选或标星，已从提议里去掉。` : undefined;
    return { proposal: { version: 1, excluded, starred, web }, changes, unknown, frame, ...(note ? { note } : {}), applied: false };
  },
  summarize: (a, r) => `提议调整资料选择：${r?.changes.join('；') || '没有变化'}（等分析师同意）${a.reason ? `。${a.reason}` : ''}`,
};
