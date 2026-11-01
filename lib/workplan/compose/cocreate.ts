/**
 * Is this the co-creation of a new workplan version, the one the compose pipeline drafts (D-56 ③ v2)?
 * stage 拆题中, not a rework, and no workplan yet (or a redo is pending). Pure: the callers read the vault.
 * Used by the tool gate (gate.ts) and by the prompt context (lib/workplan/context.ts), so both agree.
 */
export function isFirstCocreate(workspace: { stage: string; flags: readonly string[] }, workplanCount: number, redoPending: boolean): boolean {
  if (workspace.stage !== '拆题中' || workspace.flags.includes('返工中')) return false;
  return workplanCount === 0 || redoPending;
}
