/**
 * What the two investigation modes are called and how they are explained (UI/UX 方案 §6.3, #8/#24).
 * Client-safe. The limits themselves are in constants.ts; the times are measured: 5 acceptance runs of the 试水调查
 * took 176–207 s, the full run takes 15–25 minutes. They live here, not in the model's mouth.
 */
import type { ResearchMode } from './constants';

export const MODE_NAME: Record<ResearchMode, string> = { small: '试水调查', full: '完整调查' };
export const MODE_TIME: Record<ResearchMode, string> = { small: '约 3–4 分钟', full: '约 15–25 分钟' };

/** The line under an option: what is searched, how long, when to use it. */
export function modeFacts(mode: ResearchMode, firstHypothesis: string): { scope: string; web: string; when: string } {
  return mode === 'small'
    ? {
        scope: `只查第一条假设 ${firstHypothesis} 的前 2 条要查的问题，其余写“本次没有查”`,
        web: '联网搜 3 次、抓取 3 次',
        when: '先看方向对不对，再决定要不要跑完整调查。结果存成正式的报告版本，不是草稿。',
      }
    : {
        scope: '查全部假设、全部要查的问题',
        web: '联网最多搜 30 次、抓取 45 次',
        when: '拿来做决定的报告。',
      };
}

/** The line both options share. */
export const MODE_COMMON = '两种都按同样的 9 步走：先查知识库，每个假设都专门找一轮反证，报告交付前做引用自检。区别只在查多少。';
