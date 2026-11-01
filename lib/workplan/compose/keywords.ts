/**
 * Search phrases for the reference library (D-56 ③ v2, round 3 of the eval): the library's outside material has
 * English titles as often as Chinese ones, and a long Chinese sentence matches the generic notes first. Once the
 * question is confirmed, one model call turns it into short Chinese and English phrases; the pack searches each on
 * its own (lib/workplan/compose/pack.ts). A failure here only costs recall, so the caller carries on without.
 */
import { z } from 'zod';
import { loadPerspectives } from '@/lib/config/perspectives';
import type { ToolContext } from '@/lib/harness/types';
import { composeJson, composeModel } from './llm';
import { SLOT_KEYS, SLOT_LABELS, type ComposeState } from './types';

/** 复核 F: the angles are the team's own perspectives (团队.md), not a fixed enterprise list (买方、我方、技术供给). */
const system = (perspectives: string[]) =>
  [
    '你在为一个研究问题找资料。资料库里有中文和英文的外部资料（新闻、调研、厂商页面、分析师报告）。',
    `给出 12 到 16 条检索短语：每条 2 到 6 个词，一半中文、一半英文。要覆盖团队的视角（${perspectives.length ? perspectives.join('、') : '用户、竞争、我方的做法、监管'}），以及问题里提到的具体事实（价格、占比、案例、产品名）。`,
    '要找支持的资料，也要找反面的资料：用户的说法里凡是没有证据的前提，各写一两条相反的说法去找（例如"用户试用后不再使用""不愿为 AI 多付钱""调查显示预算没有提高"）。不要写整句话，不要重复。',
    '只输出 JSON：{"queries":["…","…"]}',
  ].join('\n');

export async function searchPhrases(ctx: ToolContext, state: ComposeState): Promise<string[]> {
  const prompt = [state.topic ? `用户的原话：${state.topic}` : '', ...SLOT_KEYS.map((k) => `${SLOT_LABELS[k]}：${state.frame[k]}`)].filter(Boolean).join('\n');
  const out = await composeJson({
    model: await composeModel(ctx),
    task: 'workplan_keywords',
    system: system(await loadPerspectives(ctx.vault).catch(() => [])),
    prompt,
    schema: z.object({ queries: z.array(z.string()).default([]) }),
    signal: ctx.abortSignal,
    timeoutMs: 90_000,
  });
  return out.queries.map((q) => q.trim()).filter(Boolean).slice(0, 16);
}
