/**
 * D-48 第 5 轮（B 加强版）: the one-line answer (summary.so_what) and the recommendation's 对决策的回答 are written from
 * the sub-questions' answers as the report has them, never from the evidence again (WS-A v8: the one-line answer said
 * "付钱多半落在软件席位", Q3-1 said "科目上多半没向软件与服务倾斜": the conclusion re-derived from the evidence, and
 * the two guesses went opposite ways). Each clause names the answers it comes from, [Q3-1]; code checks each clause
 * against them, tone and direction, and only flags (summary_flags), never changes the words.
 */
import { LlmJsonError } from './llm';
import type { ResearchRun } from './run';
import { conclusionPrompt } from '@/lib/harness/prompts/research-execute';
import { z } from 'zod';

/** One answer the Summary shows: "Q1", or a part of one ("Q2-1"), its words without footnotes. */
export interface SubAnswer {
  q: string;
  text: string;
}

export interface SummaryFlag {
  sentence: string;
  q: string;
  kind: 'tone' | 'direction' | 'untagged';
}

const FOOTNOTE = /\s*\[\^\d+\]/g;

/**
 * The sub-questions' answers as the rendered Summary has them ("- 各子问题的回答：" then "  - Q2 → Q2-1：…；Q2-2：…"):
 * each top-level one, and each part of a split one.
 */
export function subAnswersOf(body: string): SubAnswer[] {
  const lines = body.split('\n');
  const start = lines.findIndex((l) => l.startsWith('- 各子问题的回答：'));
  if (start < 0) return [];
  const out: SubAnswer[] = [];
  for (const l of lines.slice(start + 1)) {
    const m = /^ {2}- (Q\d+) → (.*)$/.exec(l);
    if (!m) break;
    const text = m[2].replace(FOOTNOTE, '').trim();
    out.push({ q: m[1], text });
    const parts = text.split(/(?=Q\d+-\d+：)/).filter((p) => /^Q\d+-\d+：/.test(p));
    for (const p of parts) out.push({ q: p.slice(0, p.indexOf('：')), text: p.slice(p.indexOf('：') + 1).replace(/[；。]\s*$/, '').trim() });
  }
  return out;
}

const TAG = /\[(Q\d+(?:-\d+)?)\]/g;
export const tagsOf = (clause: string) => [...new Set([...clause.matchAll(TAG)].map((m) => m[1]))];

/** The clauses of a sentence, cut at "；" and "。" (the 依据 of a recommendation cell left out). */
export function clausesOf(text: string): string[] {
  return text
    .split(/依据[:：]/)[0]
    .split(/[；。]/)
    .map((c) => c.trim())
    .filter((c) => c.replace(TAG, '').replace(/[\s\p{P}]/gu, '').length > 0);
}

const HEDGED_ANSWER = /多半|还缺/;
/**
 * Words that say a thing is not known yet (M1 验收 4, run 2: "来源还判断不了", "缺……的证据" were flagged): they soften a
 * clause, and they are not a "no" (the 不 of 判断不了, the 没 of 没查).
 */
const UNSURE = /多半|还缺|缺少?|是否|是不是|能否|可否|尚未|还没有?|没有?查|判断不了|说不准|待验证|不确定|未证实|没证实|可能|或许|也许/g;
const hedged = (t: string) => new RegExp(UNSURE.source).test(t);
/** A "no" (没、不、未、无、非), once the words of not knowing are taken out. */
const negated = (t: string) => /[没不未无非]/.test(t.replace(UNSURE, ''));

/** Words in nearly every part of these reports: they do not make two parts about the same thing (M1 run 1: 员工). */
const EVERYWHERE = new Set(['员工', '企业', '公司', '工具', '用户', '客户', '产品', '联想', '买方', '这类', '这些', '已经', '可以', '需要', '主要', '以上', '以下', '比例', '调研', '证据', '来源']);

/** What a clause is about: its two-character Chinese words, the hedges and the noes taken out (they are what is checked). */
function topic(t: string): Set<string> {
  const han = t.replace(UNSURE, '|').replace(/[没不未无非]/g, '|').replace(/[^\p{Script=Han}|]/gu, '|');
  const out = new Set<string>();
  for (const run of han.split('|')) for (let i = 0; i + 1 < run.length; i++) if (!EVERYWHERE.has(run.slice(i, i + 2))) out.add(run.slice(i, i + 2));
  return out;
}

/** The parts of a clause or an answer, cut at "，" too: one part, one claim. */
const partsOf = (t: string) => t.split(/[；。，,]/).map((x) => x.trim()).filter(Boolean);

/**
 * The two checks, by code, part by part (cut at "；", "。" and "，"), each part of a clause against the parts of the
 * answers it names that are about the same thing (a shared two-character word, hedges and noes taken out): one that
 * says "多半" / "还缺" is said softly too (tone); one with a no (没、不、未、无、非, the words of not knowing aside) has
 * one too, and one without has none (direction). A clause naming no answer is "untagged".
 * (Against the whole answer, v8's right "准入归 IT[Q1]" was flagged for Q1's "不只在 IT 一侧"; clause by clause, M1's run
 * 1 "49%员工未经批准使用AI工具，用过的人里近九成先在个人生活接触" was, its 未 met the other half. Part by part, v8's
 * "付钱多半落在软件席位" still meets Q3-1's "科目上多半没向软件与服务倾斜" on 软件.)
 */
export function conclusionFlags(text: string, answers: SubAnswer[]): SummaryFlag[] {
  const out: SummaryFlag[] = [];
  for (const clause of clausesOf(text)) {
    const qs = tagsOf(clause);
    const words = clause.replace(TAG, '').replace(/[[【]\s*E\d+[^\]】\n]*[\]】]|\[\^\d+\]/g, '').trim();
    if (!qs.length) {
      out.push({ sentence: clause, q: '', kind: 'untagged' });
      continue;
    }
    for (const q of qs) {
      const a = answers.find((x) => x.q === q);
      const theirs = partsOf(a?.text ?? '');
      let tone = false;
      let direction = false;
      for (const mine of partsOf(words)) {
        const t = topic(mine);
        const same = theirs.filter((c) => [...topic(c)].some((w) => t.has(w)));
        if (same.some((c) => HEDGED_ANSWER.test(c)) && !hedged(mine)) tone = true;
        if (same.some((c) => negated(c) !== negated(mine))) direction = true;
      }
      if (tone) out.push({ sentence: clause, q, kind: 'tone' });
      if (direction) out.push({ sentence: clause, q, kind: 'direction' });
    }
  }
  return out;
}

const conclusionSchema = z.object({ so_what: z.string().catch(''), decision_answer: z.string().catch('') });

/** Marks the model must not write here: evidence keys and footnotes (it is given neither). */
const MARKS = /\s*(?:[[【]\s*E\d+[^\]】\n]*[\]】]|\[\^\d+\])/g;
const marked = (x: { so_what: string; decision_answer: string }) => new RegExp(MARKS.source).test(`${x.so_what}\n${x.decision_answer}`);

/**
 * The call: the core question, the decision, and the answers as written; no evidence. A clause without its [Qx], or
 * an [E#] / [^n] in it (M1 验收 4: "49%[^1]"), is asked once more; marks still there are taken out
 * (research:model-footnote-dropped), what is still untagged is flagged with the rest. Null: the call failed (the
 * Summary keeps the one the Summary call wrote).
 */
export async function writeConclusion(
  run: Pick<ResearchRun, 'llm' | 'log' | 'signal'>,
  input: { question: string; decision: string | null; answers: SubAnswer[]; withDecision: boolean },
): Promise<{ so_what: string; decision_answer: string } | null> {
  const untagged = (x: { so_what: string; decision_answer: string }) => [...clausesOf(x.so_what.replace(MARKS, '')), ...(input.withDecision ? clausesOf(x.decision_answer.replace(MARKS, '')) : [])].filter((c) => !tagsOf(c).length);
  try {
    const first = await run.llm('summary:conclusion', conclusionPrompt({ ...input }), conclusionSchema);
    let best = first;
    if (untagged(first).length || marked(first)) {
      const again = await run.llm('summary:conclusion', conclusionPrompt({ ...input, untagged: untagged(first), marked: marked(first) }), conclusionSchema);
      const worse = (x: typeof first) => untagged(x).length + (marked(x) ? 1 : 0);
      best = worse(again) <= worse(first) ? again : first;
    }
    if (!marked(best)) return best;
    const marks = [...new Set(`${best.so_what}\n${best.decision_answer}`.match(MARKS)?.map((m) => m.trim()) ?? [])];
    await run.log('research:model-footnote-dropped', `summary:conclusion 重试以后仍写了 ${marks.slice(0, 5).join('')}：去掉`, '一句话回答只能标子问题 [Qx]，不写证据编号和脚注');
    return { so_what: best.so_what.replace(MARKS, ''), decision_answer: best.decision_answer.replace(MARKS, '') };
  } catch (e) {
    if (run.signal?.aborted || !(e instanceof LlmJsonError)) throw e;
    await run.log('research:conclusion-failed', `一句话回答的模型输出不是合格的 JSON：${e.message.slice(0, 120)}`, '保留 Summary 那一次写的一句话回答');
    return null;
  }
}

/**
 * Whether a one-line answer or 对决策的回答 is checked when it was not written in this run (kept by --only, rendered
 * again by --rerender, a recheck): it names answers ([Qx]), or the version it comes from was flagged already (WS-A v10:
 * v9's summary_flags were lost in the rerender).
 */
export const checkedConclusion = (text: string, flaggedBefore: boolean) => !!text.trim() && (/\[Q\d+(?:-\d+)?\]/.test(text) || flaggedBefore);

/** The flags of a Summary as a report has it: its one-line answer and 对决策的回答 against its sub-questions' answers. */
export function summaryFlagsOf(body: string, soWhat: string, decision: string, flaggedBefore: boolean): SummaryFlag[] {
  const answers = subAnswersOf(body);
  if (!answers.length) return [];
  return [...(checkedConclusion(soWhat, flaggedBefore) ? conclusionFlags(soWhat, answers) : []), ...(checkedConclusion(decision, flaggedBefore) ? conclusionFlags(decision, answers) : [])];
}
