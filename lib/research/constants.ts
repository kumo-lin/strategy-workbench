/**
 * Deep Research limits (PRD v0.4 §9.6, D-9). Written as constants, enforced in
 * code (the web client refuses past the budget; the orchestrator stops).
 */
export type ResearchMode = 'small' | 'full';

export interface ResearchLimits {
  /** Claims (论点) executed. */
  maxClaims: number;
  /** Sub-questions executed per claim. */
  maxSubQuestions: number;
  /** DeepSeek Search calls in the whole run. */
  maxSearches: number;
  /** DeepSeek Fetch calls in the whole run. */
  maxFetches: number;
  /** Web rounds per sub-question after the vault lookup (§9.6: "再联网搜最多 2 轮"). */
  webRoundsPerSubQuestion: number;
  /**
   * Claim blocks the model judges in one evaluation call (best-ranked first). The evaluation calls are
   * most of a run's time once the library is large (measured 10/24: 97 s of 190 s with the full C library).
   */
  maxCandidatesPerEval: number;
}

export const RESEARCH_LIMITS: Record<ResearchMode, ResearchLimits> = {
  /** 现场演示用的试水调查：1 个论点、最多 2 个子问题，搜 3 次、抓 3 次。 */
  small: { maxClaims: 1, maxSubQuestions: 2, maxSearches: 3, maxFetches: 3, webRoundsPerSubQuestion: 2, maxCandidatesPerEval: 12 },
  /**
   * 完整调查：每个子问题最多联网 2 轮，整次最多搜 30 次。
   * PRD 没有给抓取上限；取 45（每次搜索平均抓 1.5 页），属于实现细节。
   */
  full: { maxClaims: Infinity, maxSubQuestions: Infinity, maxSearches: 30, maxFetches: 45, webRoundsPerSubQuestion: 2, maxCandidatesPerEval: 30 },
};

/**
 * One evaluation call (step 5) may take at most this long, then it is retried once; a second failure records the
 * batch as 未评估 and the run continues. Normal calls take 10–30 s (measured 10/24, 12–30 candidates).
 */
export const EVAL_CALL_TIMEOUT_MS = 60_000;

/** Report self-check: how many times the AI may repair a failing report (PRD §6.3.1 step 9). */
export const MAX_REPORT_REPAIR_ROUNDS = 2;

/** Pages kept for the model / ingested into 10_资料库, in characters. */
export const MAX_FETCH_CHARS_FOR_MODEL = 12_000;
export const MAX_INGEST_CHARS = 30_000;
