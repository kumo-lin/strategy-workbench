/**
 * The thin agent loop (PRD §10.5 agent 运行时): one streamText call with the
 * phase's tools, a step cap, and logging of client-tool calls (ask_user has
 * no server execute, so the registry wrapper never sees it).
 */
import { stepCountIs, streamText, type LanguageModel, type ModelMessage, type ToolSet } from 'ai';
import { getModel } from '@/lib/models/provider';
import { buildSystemPrompt } from './prompts';
import { buildToolsForPhase, TOOL_SPECS, type ToolCallListener } from './registry';
import { COMPOSE_PHASE_TOOLS, composeToolGate } from '@/lib/workplan/compose/gate';
import type { ToolName } from './phases';
import type { ToolContext } from './types';

export interface RunAgentOptions {
  ctx: ToolContext;
  messages: ModelMessage[];
  /** Defaults to the configured provider (90_配置/模型.md). */
  model?: LanguageModel;
  /** Defaults to buildSystemPrompt(ctx). */
  system?: string;
  /** Default 12. */
  maxSteps?: number;
  onToolCall?: ToolCallListener;
}

export async function runAgent(opts: RunAgentOptions) {
  const { ctx } = opts;
  // Drafting the investigation plan is a judgment; every other phase keeps its existing resolution.
  const model = opts.model ?? (await getModel({ vault: ctx.vault, role: ctx.phase === 'research_plan' ? 'judgment' : undefined })).model;
  const system = opts.system ?? (await buildSystemPrompt(ctx));
  // A workplan co-creation is offered only the tools its state allows, re-read before every step: the step that
  // records the user's confirmation is followed by the step that composes (lib/workplan/compose/gate.ts).
  const all = buildToolsForPhase(ctx, opts.onToolCall, { allForSteps: true });
  const gate = await composeToolGate(ctx);
  const keep = (name: string) => name === 'read_task_context' || !gate || ('only' in gate ? COMPOSE_PHASE_TOOLS.includes(name as ToolName) : !gate.without.includes(name as ToolName));
  const tools: ToolSet = Object.fromEntries(Object.entries(all).filter(([name]) => keep(name)));
  // D-64 T20: the first step of a phase may only read the task context; the tool marks ctx when it has run
  const readFirst = () => (ctx.taskContextRead === false ? { activeTools: ['read_task_context' as keyof typeof tools] } : null);
  return streamText({
    model,
    system,
    messages: opts.messages,
    tools,
    ...(gate && 'only' in gate
      ? {
          prepareStep: async ({ steps }: { steps: { toolCalls: { toolName: string; input: unknown }[] }[] }) => {
            const first = readFirst();
            if (first) return first;
            const g = await composeToolGate(ctx);
            if (!g || !('only' in g)) return {};
            const activeTools = [...g.only] as (keyof typeof tools)[];
            // The step after the confirmation is the composing, not a sentence about it: a model that announces it and
            // stops has left the user waiting for something that never starts. (A forced tool choice is refused by the
            // provider in thinking mode, so the step offers that one tool and says what it is for.)
            const prev = steps[steps.length - 1];
            const justConfirmed = prev?.toolCalls.some((c) => c.toolName === 'frame_topic' && (c.input as { confirmed?: unknown } | null)?.confirmed === true);
            return justConfirmed && g.only.includes('compose_workplan' as ToolName)
              ? { activeTools: ['compose_workplan' as keyof typeof tools], system: `${system}\n\n【这一步】用户已经确认了题目。现在只做一件事：调用 compose_workplan。不要先写文字。` }
              : { activeTools };
          },
        }
      : { prepareStep: async () => readFirst() ?? {} }),
    stopWhen: stepCountIs(opts.maxSteps ?? 12),
    abortSignal: ctx.abortSignal,
    onStepFinish: async (step) => {
      for (const call of step.toolCalls) {
        const spec = TOOL_SPECS[call.toolName as ToolName];
        if (spec && !spec.execute) {
          const input = call.input as { question?: string; why?: string };
          await ctx.vault.appendLog(ctx.logPath, {
            time: ctx.now().toISOString(),
            actor: 'AI',
            action: `tool:${call.toolName}`,
            change: input.question ? `提问：${input.question}` : JSON.stringify(input),
            reason: `${input.why ?? '（未说明）'} · 阶段=${ctx.phase}`,
          });
        }
      }
    },
  });
}
