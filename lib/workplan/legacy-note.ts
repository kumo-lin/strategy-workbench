/**
 * "这是改成问题树之前的版本" (D-39): a workplan written before the question-tree format stays as it was; the page says so
 * when the project has moved on, so a reader who sees the new structure elsewhere is not left guessing. Display only: nothing
 * here writes a file.
 */
import path from 'node:path';
import { isTreePlan } from '@/lib/research/question-tree';
import type { Vault } from '@/lib/vault';
import { hasQuestionTree } from './workplan-tree';

async function names(vault: Vault, dir: string): Promise<{ name: string; path: string; kind: string }[]> {
  try {
    return await vault.list(dir);
  } catch {
    return [];
  }
}

/** True when some Workspace of the project has a question-tree workplan, or a research plan whose claims carry a `question`. */
export async function projectHasQuestionTree(vault: Vault, workspacePath: string): Promise<boolean> {
  const projectPath = path.posix.dirname(workspacePath);
  for (const ws of await names(vault, projectPath)) {
    if (ws.kind !== 'dir') continue;
    for (const f of await names(vault, ws.path)) {
      if (f.kind === 'file' && /^workplan v\d+\.md$/.test(f.name)) {
        const n = await vault.read(f.path);
        if (n.note?.type === 'workplan' && hasQuestionTree(n.body)) return true;
      }
    }
    for (const topic of await names(vault, `${ws.path}/调查`)) {
      if (topic.kind !== 'dir') continue;
      for (const f of await names(vault, topic.path)) {
        if (f.kind !== 'file' || !/^计划 v\d+\.md$/.test(f.name)) continue;
        const n = await vault.read(f.path);
        if (n.note?.type === 'research_plan' && isTreePlan(n.note)) return true;
      }
    }
  }
  return false;
}
