/**
 * The contract between the app's prompts and the mock model (`MODEL_MOCK=1`): every AI task a
 * button starts puts exactly one `任务：<label>` line in its system prompt, and the mock picks its
 * script from that line plus how many tool calls it already made — never from the words the user
 * typed. Pure functions; no I/O.
 */
export const MOCK_TASKS = {
  project_split: '拆题',
  workplan_cocreate: '共创 workplan',
  workplan_revise_comment: '按评论改 workplan',
  workplan_revise_opinion: '按 Senior 的意见改 workplan',
  research_plan: '拟调查计划',
  // The model calls inside compose_workplan (D-61): no button, so no user text to key on either.
  workplan_keywords: '检索词',
  workplan_judgment: '整体判断',
  workplan_eval: '战略评估',
  workplan_revise: '修订整体判断',
  workplan_tree: '拆 workplan',
  workplan_ground: '核对依据',
  workplan_rewrite: '改写措辞',
  // D-64 T19: old orchestrated calls the To-Be work changes, moved off their Chinese marker sentences.
  decision_draft: '起草决定',
  summary: '写 Summary',
  citation_judge: '核验引用',
  followup: '补缺检索',
  // D-64 T25: which judgments an interview touches
  interview_affects: '判断访谈影响',
} as const;
export type MockTask = keyof typeof MOCK_TASKS;

const TASK_BY_LABEL = Object.fromEntries(Object.entries(MOCK_TASKS).map(([k, v]) => [v, k])) as Record<string, MockTask>;

/** The line a prompt must contain for `task`, e.g. `任务：共创 workplan`. */
export function taskLine(task: MockTask): string {
  return `任务：${MOCK_TASKS[task]}`;
}

/** Which task a system prompt asks for: the first line that starts (after optional spaces) with `任务：` and whose label is one of MOCK_TASKS; otherwise null. */
export function taskOf(system: string): MockTask | null {
  for (const line of system.split('\n')) {
    const m = /^\s*任务：(.*)$/.exec(line);
    if (!m) continue;
    // Only trailing spaces and `。` are ignored; a label that merely starts with another one matches nothing.
    const label = m[1].trim().replace(/。+$/, '').trimEnd();
    const task = TASK_BY_LABEL[label];
    if (task) return task;
  }
  return null;
}

/** The first `max` characters (default 12, counted in Unicode code points, not UTF-16 units) of the user's text, trimmed, with every run of whitespace collapsed to one space. Used by the mock to echo the user's words back in a follow-up question. */
export function echoOf(userText: string, max = 12): string {
  const flat = userText.replace(/\s+/g, ' ').trim();
  return Array.from(flat).slice(0, max).join('');
}
