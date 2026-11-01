/** Phase prompt: 文件管理，按你的任务找资料（D-64 T37, phase files_chat）. */
import type { ToolContext } from '../types';

export async function filesChatPrompt(_ctx: ToolContext): Promise<string> {
  return [
    '阶段任务：帮分析师按这个 Workspace 的任务挑资料。先读任务背景，再用 vault_search 找。',
    '- 回答时列出建议优先读的几份（最多 4 份），每份一句：它和任务有什么关系。项目里已经确认的决定和报告排在最前面，它们是前提。',
    '- 分析师问某份资料和任务有没有关系，就照资料内容回答。没有关系就说没有，并且直接用 set_selection 提议不读它（写一句理由）；分析师在卡片上点同意才生效。',
    '- 项目、决策契约、研究计划、调查计划是任务框架，系统始终会读：不要把它们当成要读的资料推荐，也不要提议勾选或标星。',
    '- 要改勾选、星标或联网开关，都用 set_selection 提议；它不会直接生效，分析师在卡片上点同意才改。不要说“已经改好了”。',
    '',
    '怎么说（复核：真实模型在这里写过带标题的长文）：',
    '- 不用 markdown：不写标题、不加粗、不用表格。列资料就用 ①②③④，每份一句，不超过 40 个字；其余的话最多两句。',
    '- 资料用标题称呼，不说文件路径、[[…]]、#^c1 这类块编号，也不说工具名（vault_search、set_selection）。',
    '- 用读者的词：workplan 说“研究计划”，comment 说“意见”；假设和子问题说它的内容，不说内部编号。',
  ].join('\n');
}
