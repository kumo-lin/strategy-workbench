/**
 * The budget of one compose run (D-61): tokens and wall-clock time are counted by code, from the usage the provider
 * reports, and enforced before every model call. The optional steps (the evaluation, the revision) check `canSpend`
 * first and are skipped when the run is already past the soft limit; the compile step always has the hard limit.
 * Retries are bounded where the calls are made (judgment.ts, tree.ts), not here.
 */
import { wrapLanguageModel, type LanguageModel } from 'ai';

export const BUDGET = {
  /** Hard limits: a model call that would start past them throws BudgetError. */
  hardTokens: 300_000,
  hardMs: 10 * 60_000,
  /** Soft limits: the optional steps are skipped past them, so the compile step still fits. */
  softTokens: 150_000,
  softMs: 5 * 60_000,
};

export class BudgetError extends Error {
  name = 'BudgetError';
}

export class Meter {
  tokens = 0;
  readonly startedAt: number;
  constructor(private readonly limits = BUDGET, private readonly clock: () => number = Date.now) {
    this.startedAt = clock();
  }
  get elapsedMs(): number {
    return this.clock() - this.startedAt;
  }
  /** Throws when a new call would start past a hard limit. */
  check(): void {
    if (this.tokens >= this.limits.hardTokens) throw new BudgetError(`token budget used up (${this.tokens})`);
    if (this.elapsedMs >= this.limits.hardMs) throw new BudgetError(`time budget used up (${Math.round(this.elapsedMs / 1000)} s)`);
  }
  /** Is there still room for an optional step? */
  canSpend(): boolean {
    return this.tokens < this.limits.softTokens && this.elapsedMs < this.limits.softMs;
  }
}

/** `model` with every call counted against `meter` (and refused once a hard limit is reached). */
export function metered(model: LanguageModel, meter: Meter): LanguageModel {
  if (typeof model === 'string' || model.specificationVersion !== 'v3') return model;
  return wrapLanguageModel({
    model,
    middleware: {
      specificationVersion: 'v3',
      wrapGenerate: async ({ doGenerate }) => {
        meter.check();
        const r = await doGenerate();
        meter.tokens += (r.usage.inputTokens.total ?? 0) + (r.usage.outputTokens.total ?? 0);
        return r;
      },
    },
  });
}
