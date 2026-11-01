/** What the Workspace page really has, as the assistant is told it. Keep in sync with the UI (owner: M1; UI route changes must update this list). */
export const WORKPLAN_UI_FACTS: readonly string[] = [
  '左边是你和用户的对话；右边是研究计划的各个版本、意见和日志三个页签（界面上叫“研究计划”“意见”，不叫 workplan、comment）。',
  'workplan 只能由你用 write_draft 写；用户想改，就在对话里告诉你。',
  '你调用 submit_for_review 只会准备送审材料，界面上会弹出一张确认卡，用户点"提交给 Senior"才会真正提交。你不能提交，也不能说"已经提交"。',
  '审批、通过、打回只有 Senior 能在审批页做。',
  '界面上没有别的按钮或功能。不确定有没有的，就说"我不确定界面上有没有这个"，不要编。',
];

/** The facts as a '- ' bullet list joined with '\n'. */
export function uiFactsText(): string {
  return WORKPLAN_UI_FACTS.map((f) => `- ${f}`).join('\n');
}
