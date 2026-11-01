import type { ModelRole } from '@/lib/config/models';

const JUDGMENT_TASKS = ['summary', 'summary:conclusion', 'recommend', 'recommend:repair'];

/** The role of a `run.llm(task, …)` call, by its task name. */
export function roleOfTask(task: string): ModelRole {
  return task.startsWith('judge:') || JUDGMENT_TASKS.includes(task) ? 'judgment' : 'execution';
}
