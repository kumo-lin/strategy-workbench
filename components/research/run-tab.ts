/**
 * The messages of the latest run on this page: from its "开始执行" / "追加调查" message on. An earlier run's steps and
 * result stay in the chat's history, but must not stand in for this run's progress (a full run started after a small
 * one showed the small run's "报告已交付" until its own result came). A continuation answer belongs to the same run.
 * A run re-attached after a reload has no message of the user's: all of it is the run.
 */
export function latestRun<M extends { role: string; metadata?: unknown }>(messages: M[]): M[] {
  const at = messages.findLastIndex(
    (m) => m.role === 'user' && !(typeof m.metadata === 'object' && m.metadata !== null && (m.metadata as { continuation?: unknown }).continuation === true),
  );
  return at >= 0 ? messages.slice(at) : messages;
}

/** The latest stage's result: a continued run has both the vault and delivery results in its messages. */
export function lastResultOf(parts: { type: string; data?: unknown }[]): Record<string, unknown> | null {
  const result = parts.findLast((p) => p.type === 'data-result');
  return (result?.data as Record<string, unknown> | undefined) ?? null;
}
