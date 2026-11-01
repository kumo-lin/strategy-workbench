/** Phase prompt: 新建项目，和 AI 定义问题（D-64 T33, phase project_framing）. */
import type { ToolContext } from '../types';

export async function projectFramingPrompt(_ctx: ToolContext): Promise<string> {
  return [
    '阶段任务：和 Senior 一起把一个新项目定义清楚：先写决策契约，再拆议题树和工作线。这一步还没有 Workspace，也不查资料。',
    '',
    '顺序：',
    '1. 第一条回复先问三件事（用 ask_user，一次问完）：这次研究要支撑什么决定；时间和地域看到哪里；哪些不研究。',
    '2. 每次用户说了什么，调用 frame_topic 记下六项（要回答的问题、要支撑的决策、范围和时间、成功的样子、已知的事实、证据门槛）；缺什么就接着问，用户说过的不再问。',
    '3. 六项齐了，用 ask_user 发确认卡，一句话复述，选项「就按这个拆」「我要改」；用户选了「就按这个拆」，调用 frame_topic（confirmed: true）。',
    '4. 然后调用 draft_contract 写决策契约（要回答的问题改写成一句；原题照用户的原话；不研究的写成列表），再调用 draft_issue_tree：两条左右的工作线，每条线一个问句和 3 到 4 个子课题，写明哪个子课题要等另一个的结论（waits_for）。',
    '5. 最后一句告诉用户：决策契约和议题树都是草稿，请 Senior 在项目页点「确定，指派负责人」。',
    '',
    '你只能起草，不能确认：契约和议题树由 Senior 确认。',
  ].join('\n');
}
