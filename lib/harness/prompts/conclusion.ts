/** Phase prompt: 结论和撰写 (PRD §6.2 step 5, §6.4). OWNER: M1 (M3 extends) — placeholder from M0. */
import type { ToolContext } from '../types';

export async function conclusionPrompt(_ctx: ToolContext): Promise<string> {
  return '阶段任务：整理结论，准备结论审批（M1/M3 待补）。';
}
