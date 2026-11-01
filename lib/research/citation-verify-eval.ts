/**
 * D-56 ⑦: measuring the three-gate check against C's hand-checked pairs (81 footnotes across four delivered reports,
 * their verdicts 撑得住 36 / 部分 33 / 挂错 12). The acceptance:
 *   - of C's 挂错 pairs, 0 verified;
 *   - of C's 部分 pairs, verified ≤ 10%;
 *   - of C's 撑得住 pairs, verified ≥ 60%.
 * A pair is verified only when all three gates pass (entity, DeepSeek, Kimi: citation-verify.ts). These are the pure
 * helpers: the clause a footnote ends, the per-label tally, and the few lines the script prints. No model, no vault,
 * no file.
 */
import { FITS, type Fit } from './citation-fit';
import { citedClauses } from './number-check';

/** A leading label the report writes before a clause ("依据：…", "回答（一句话）：…"). */
const LABEL = /^(?:依据|回答（一句话）|回答|理由|所以联想|So What)\s*[：:]\s*/;

/** Whitespace and a comma a cited clause may start with (citedClauses keeps the text since the previous marker). */
const stripLead = (t: string): string => t.replace(/^[，,、\s]+/, '').trim();

/** The clause the footnote ends, as the models should judge it: no label, no leading punctuation, its marks gone. */
export function clauseOf(sentence: string, footnote: string): string {
  const id = /\[\^(\d+)\]/.exec(footnote)?.[1] ?? footnote;
  for (const clause of citedClauses(sentence)) {
    if (clause.footnotes.includes(id)) return stripLead(clause.text.replace(LABEL, ''));
  }
  return sentence.replace(/\[\^\d+\]/g, '').trim();
}

/** One hand-checked pair, with what the three gates said about it. */
export type EvalRow = { label: Fit; verified: boolean; entity: boolean; deepseek: Fit | null; kimi: Fit | null };

export interface LabelStats {
  n: number;
  verified: number;
  /** verified / n; 0 when n is 0. */
  rate: number;
  entity: number;
  deepseek撑得住: number;
  kimi撑得住: number;
}

export interface EvalSummary {
  byLabel: Record<Fit, LabelStats>;
  meets: { wrongNone: boolean; partialAtMost10: boolean; holdsAtLeast60: boolean; all: boolean };
}

/** The counts of each label and whether the acceptance holds. */
export function summarizeEval(rows: EvalRow[]): EvalSummary {
  const byLabel = Object.fromEntries(
    FITS.map((label) => [label, { n: 0, verified: 0, rate: 0, entity: 0, deepseek撑得住: 0, kimi撑得住: 0 }]),
  ) as Record<Fit, LabelStats>;
  for (const row of rows) {
    const s = byLabel[row.label];
    s.n += 1;
    if (row.verified) s.verified += 1;
    if (row.entity) s.entity += 1;
    if (row.deepseek === '撑得住') s.deepseek撑得住 += 1;
    if (row.kimi === '撑得住') s.kimi撑得住 += 1;
  }
  for (const label of FITS) byLabel[label].rate = byLabel[label].n ? byLabel[label].verified / byLabel[label].n : 0;
  const wrongNone = byLabel['挂错'].verified === 0;
  const partialAtMost10 = byLabel['部分'].rate <= 0.1;
  const holdsAtLeast60 = byLabel['撑得住'].rate >= 0.6;
  return { byLabel, meets: { wrongNone, partialAtMost10, holdsAtLeast60, all: wrongNone && partialAtMost10 && holdsAtLeast60 } };
}

const percent = (rate: number): number => Math.round(rate * 100);
/** A report by its file name: the summary is for a reader, the paths are long. */
const fileName = (p: string): string => p.split('/').pop() ?? p;
const verdict = (ok: boolean): string => (ok ? '✓ 达标' : '未达标');

/** The lines the script prints: one per label, the time, then the acceptance. */
export function formatSummary(s: EvalSummary, seconds: { total: number; byReport: [string, number][] }): string {
  const lines = FITS.map((label) => {
    const x = s.byLabel[label];
    return `${label} ${x.n} 对：✓ ${x.verified}（${percent(x.rate)}%）· 实体过 ${x.entity} · DeepSeek 撑得住 ${x.deepseek撑得住} · Kimi 撑得住 ${x.kimi撑得住}`;
  });
  lines.push(`用时：共 ${seconds.total} 秒；按报告：${seconds.byReport.map(([p, sec]) => `${fileName(p)} ${sec} 秒`).join('、')}`);
  lines.push(`验收：挂错 ${s.byLabel['挂错'].verified} ${verdict(s.meets.wrongNone)} / 部分 ≤10% ${verdict(s.meets.partialAtMost10)} / 撑得住 ≥60% ${verdict(s.meets.holdsAtLeast60)}`);
  return lines.join('\n');
}
