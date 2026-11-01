/**
 * "重新做一版 workplan" (M1 task 4b). The Junior asks for a fresh version; the old
 * one stays on disk and the next write goes to v(N+1) instead of overwriting it.
 *
 * The request is a Workspace log entry (`workplan:redo`), not a new frontmatter
 * field: the log is already the append-only record of what happened, and the
 * workplan file itself does not change (no schema / contract change).
 */
import type { Role } from '@/lib/config/roles';
import type { LogEntry, Vault } from '@/lib/vault';
import { REDO_ACTION, isWorkplanWrite } from './ask-budget';
import { ReviewFlowError } from './review-flow';
import { resetForRedo, updateState } from './compose/state';
import { listWorkplans } from './state';

export { REDO_ACTION };

/** True when the last redo entry in the log is newer than the last successful workplan write. */
export function isRedoPending(log: readonly LogEntry[]): boolean {
  let lastRedo = -1;
  let lastWrite = -1;
  log.forEach((r, i) => {
    if (r.action === REDO_ACTION) lastRedo = i;
    else if (isWorkplanWrite(r)) lastWrite = i;
  });
  return lastRedo !== -1 && lastRedo > lastWrite;
}

export interface RequestRedoInput {
  vault: Vault;
  actor: Role;
  workspacePath: string;
  now?: () => Date;
}

/** Record the Junior's redo request and return the version the next write must go to. */
export async function requestRedo(opts: RequestRedoInput): Promise<{ nextVersion: number }> {
  const { vault, actor, workspacePath } = opts;
  const now = (opts.now ?? (() => new Date()))();
  const ws = await vault.readTyped(`${workspacePath}/workspace.md`, 'workspace');
  if (actor.name !== ws.note.owner) {
    throw new ReviewFlowError(`只有 Workspace 的负责人（${ws.note.owner}）可以重新做 workplan`);
  }
  if (ws.note.stage !== '拆题中') {
    throw new ReviewFlowError(`现在是「${ws.note.stage}」，只有「拆题中」可以重新做 workplan`);
  }
  const workplans = await listWorkplans(vault, workspacePath);
  const latest = workplans[workplans.length - 1];
  if (!latest) throw new ReviewFlowError('还没有 workplan，先和 AI 一起共创第一版');

  const nextVersion = latest.version + 1;
  const logPath = `${workspacePath}/日志.md`;
  // Already asked and not written yet: the same request, not a second one.
  if (isRedoPending(await vault.readLog(logPath))) return { nextVersion };

  await vault.appendLog(logPath, {
    time: now.toISOString(),
    actor: actor.name,
    action: REDO_ACTION,
    change: `重新做一版：保留 workplan v${latest.version}，下一版写 v${nextVersion}`,
    reason: 'Junior 要求重新做',
  });
  // the frame is asked again for the new version (the pipeline's state, lib/workplan/compose)
  await updateState(vault, workspacePath, resetForRedo, now);
  return { nextVersion };
}
