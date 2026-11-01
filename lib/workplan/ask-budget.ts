/**
 * How many ask_user questions the co-creation of a workplan may use (D-19: at most 3).
 * Counted from the Workspace log, which the harness appends to for every ask_user call,
 * so the count survives a page reload, a second browser, or a cleared chat history.
 * The count restarts after each workplan draft is written: the questions that come
 * with reading a Senior's comment belong to a different job. It also restarts after
 * a "重新做一版" request (lib/workplan/redo.ts): that starts a fresh co-creation.
 */
import type { LogEntry } from '@/lib/vault';

export const COCREATE_ASK_LIMIT = 3;

/** Log action of an explicit "redo the workplan" request. Re-exported by ./redo. */
export const REDO_ACTION = 'workplan:redo';

const isAsk = (r: LogEntry) => r.action === 'tool:ask_user' && r.reason.includes('阶段=workplan');
export const isWorkplanWrite = (r: LogEntry) =>
  r.action === 'tool:write_draft' && !r.change.startsWith('✗') && r.change.endsWith('（workplan）');

/** ask_user calls in the workplan phase since the last successful workplan write or redo request (oldest first). */
export function countCocreateAsks(log: readonly LogEntry[]): number {
  let n = 0;
  for (const r of log) {
    if (isWorkplanWrite(r) || r.action === REDO_ACTION) n = 0;
    else if (isAsk(r)) n += 1;
  }
  return n;
}
