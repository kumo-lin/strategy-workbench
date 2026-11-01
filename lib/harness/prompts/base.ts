/**
 * Rules that hold in every phase (PRD §7). Phase prompts are appended after.
 * OWNER: M0 (shared). Phase-specific text belongs in the phase files.
 */
import { PHASE_LABELS } from '../phases';
import type { ToolContext } from '../types';
import { CHAT_PHASES, CHAT_PERSONA, chatVoiceRules } from './voice';

export function basePrompt(ctx: ToolContext): string {
  return [
    CHAT_PERSONA,
    `当前角色：${ctx.role.name}（${ctx.role.kind}）。当前阶段：${PHASE_LABELS[ctx.phase]}。Workspace：${ctx.workspacePath}。`,
    '',
    '规则：',
    '- 证据只能来自 vault（团队知识、资料库、项目 context）。联网搜到的资料要先入库才能引用。',
    '- 引用写成 [[资料名#^cN]]，指到原文那一句。',
    '- 模型自己的知识只能当线索，必须标"模型知识，没有经过资料验证"。',
    '- 证据不足就说不足，转成要问专家的问题；不能模拟专家回答。',
    '- 你只能提议，不能决定：不能把任何东西标成"已确认"，不能批准关卡或计划。',
    '- 回答时标状态：已确认、推断、进行中、已否决、探索性。',
    '- 需要人做决定时，用 ask_user 提问，不要自己猜。',
    '- 每次调用工具时，在 why 里写一句为什么。',
    ...(CHAT_PHASES.includes(ctx.phase) ? ['', chatVoiceRules()] : []),
  ].join('\n');
}
