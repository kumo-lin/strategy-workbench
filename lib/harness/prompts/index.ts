/**
 * System prompt = base rules + phase prompt (PRD §10.2 context 组装).
 * OWNER: M0. Each phase file is owned by the session in its header.
 */
import type { Phase } from '../phases';
import type { ToolContext } from '../types';
import { basePrompt } from './base';
import { conclusionPrompt } from './conclusion';
import { filesChatPrompt } from './files-chat';
import { projectFramingPrompt } from './project-framing';
import { researchExecutePrompt } from './research-execute';
import { researchPlanPrompt } from './research-plan';
import { workplanPrompt } from './workplan';

const PHASE_PROMPTS: Record<Phase, (ctx: ToolContext) => Promise<string>> = {
  workplan: workplanPrompt,
  research_plan: researchPlanPrompt,
  research_execute: researchExecutePrompt,
  conclusion: conclusionPrompt,
  project_framing: projectFramingPrompt,
  files_chat: filesChatPrompt,
};

export async function buildSystemPrompt(ctx: ToolContext): Promise<string> {
  return `${basePrompt(ctx)}\n\n${await PHASE_PROMPTS[ctx.phase](ctx)}`;
}
