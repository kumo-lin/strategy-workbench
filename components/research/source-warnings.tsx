/** The "来源警告" box above a report's Summary, and the tag beside a footnote whose source is wrong; the same for "人工核对注". */
import { AlertTriangle } from 'lucide-react';
import type { JSX } from 'react';
import type { ReportReviewNote } from '@/lib/report/review-notes';
import type { SourceWarning } from '@/lib/report/source-warnings';
import { describeMismatch, type NumberMismatch } from '@/lib/research/number-check';

export function SourceWarnings({ warnings }: { warnings: SourceWarning[] | undefined }): JSX.Element | null {
  if (!warnings?.length) return null;
  return (
    <section role="alert" data-testid="source-warnings" className="rounded-lg border border-amber-500/50 bg-amber-500/10 px-4 py-3">
      <div className="flex items-center gap-2 text-sm font-medium text-amber-800 dark:text-amber-300">
        <AlertTriangle className="size-4" aria-hidden />
        来源警告：这份报告引用的来源有问题
      </div>
      <ul className="mt-2 flex flex-col gap-2 text-sm">
        {warnings.map((w, i) => (
          <li key={i} data-testid="source-warning">
            <div className="text-muted-foreground text-xs">脚注 {w.footnotes.map((f) => `[${f}]`).join(' ')} · {w.source}</div>
            <div>问题：{w.problem}</div>
            <div>处理：{w.action}</div>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * "人工核对注" (review_notes): above Summary (`notes` with footnotes, or whose `where` names no section; `elsewhere`:
 * the passages that have their own note further down), or at the top of the section a note names (`inSection`).
 */
export function ReviewNotes({ notes, elsewhere = [], inSection }: { notes: ReportReviewNote[] | undefined; elsewhere?: string[]; inSection?: boolean }): JSX.Element | null {
  if (!notes?.length && !elsewhere.length) return null;
  return (
    <section role="note" data-testid={inSection ? 'review-notes-section' : 'review-notes'} className="rounded-lg border border-amber-500/50 bg-amber-500/10 px-4 py-3">
      <div className="flex items-center gap-2 text-sm font-medium text-amber-800 dark:text-amber-300">
        <AlertTriangle className="size-4" aria-hidden />
        人工核对注{inSection ? '' : '：有人核对这份报告时发现的问题'}
      </div>
      {notes?.length ? (
        <ul className="mt-2 flex flex-col gap-2 text-sm">
          {notes.map((n, i) => (
            <li key={i} data-testid="review-note">
              {n.footnotes?.length || (n.where && !inSection) ? (
                <div className="text-muted-foreground text-xs">{[n.footnotes?.length ? `脚注 ${n.footnotes.map((f) => `[${f}]`).join(' ')}` : '', inSection ? '' : (n.where ?? '')].filter(Boolean).join(' · ')}</div>
              ) : null}
              <div>{n.note}</div>
              <div className="text-muted-foreground text-xs">{n.found_by} · {n.found_on}</div>
            </li>
          ))}
        </ul>
      ) : null}
      {elsewhere.length ? <p className="text-muted-foreground mt-2 text-xs">另有 {elsewhere.length} 条写在对应小节的顶部：{elsewhere.join('、')}。</p> : null}
      {inSection ? null : <p className="text-muted-foreground mt-1 text-xs">只是标注，报告正文没有改动。</p>}
    </section>
  );
}

export function ReviewNoteTag({ title }: { title?: string }): JSX.Element {
  return (
    <span data-testid="review-note-tag" title={title} className="ml-0.5 text-[0.7em] font-normal text-amber-700 dark:text-amber-400">
      ⚠ 见核对注
    </span>
  );
}

export function SourceWarningTag(): JSX.Element {
  return (
    <span data-testid="source-warning-tag" className="ml-0.5 text-[0.7em] font-normal text-amber-700 dark:text-amber-400">
      ⚠ 来源有问题
    </span>
  );
}

/**
 * Q-F: the numbers of the report that are not in the original their sentence cites, and (D-21-4 f) the numbers with
 * no source (in the recommendation or the text). Found on display, so a fixed rule clears them without a rerun; the file is not changed.
 */
export function NumberWarnings({ mismatches, uncited = [] }: { mismatches: NumberMismatch[] | undefined; uncited?: { text: string; numbers: string[]; inRecommendation?: boolean }[] }): JSX.Element | null {
  if (!mismatches?.length && !uncited.length) return null;
  mismatches ??= [];
  return (
    <section role="alert" data-testid="number-warnings" className="rounded-lg border border-amber-500/50 bg-amber-500/10 px-4 py-3">
      <div className="flex items-center gap-2 text-sm font-medium text-amber-800 dark:text-amber-300">
        <AlertTriangle className="size-4" aria-hidden />
        数字核对：{[mismatches.length ? `${mismatches.length} 处数字没有出现在所引的原文里` : '', uncited.length ? `${uncited.length} 处数字没有出处` : ''].filter(Boolean).join('；')}
      </div>
      <p className="text-muted-foreground mt-1 text-xs">逐个比对句子里的数字和它所引资料块的原文；报告文件没有改动，对应的脚注旁标了“⚠ 数字未在引文中出现”。</p>
      <ul className="mt-2 flex flex-col gap-1 text-sm">
        {mismatches.map((m, i) => (
          <li key={i} data-testid="number-warning">
            {describeMismatch(m)}
          </li>
        ))}
        {uncited.map((u, i) => (
          <li key={`u${i}`} data-testid="number-warning-uncited">
            {u.inRecommendation ? '推荐判断' : '正文'} · 「{u.text.length > 60 ? `${u.text.slice(0, 60)}…` : u.text}」里的 {u.numbers.join('、')} 没有出处
          </li>
        ))}
      </ul>
    </section>
  );
}

export function NumberWarningTag(): JSX.Element {
  return (
    <span data-testid="number-warning-tag" className="ml-0.5 text-[0.7em] font-normal text-amber-700 dark:text-amber-400">
      ⚠ 数字未在引文中出现
    </span>
  );
}

/** D-48: a sentence still over its length limit after the rewrite (length_flags); the report was delivered anyway. */
export function LengthWarningTag({ limit, length }: { limit: number; length: number }): JSX.Element {
  return (
    <span data-testid="length-warning-tag" title={`这一句 ${length} 字，上限 ${limit} 字；已改写过一次，还是超了`} className="ml-1 text-[0.75em] font-normal whitespace-nowrap text-amber-700 dark:text-amber-400">
      ⚠ 超过 {limit} 字
    </span>
  );
}

/** A 回应 whose footnote hangs after the author's own inference (inference_cited: a heuristic, flagged after the repair rounds). */
export function InferenceWarningTag(): JSX.Element {
  return (
    <span data-testid="inference-warning-tag" title="这句里像是作者自己的推论，脚注却挂在它后面：资料只支持前半句。按推论用语判断，可能误报" className="ml-0.5 text-[0.7em] font-normal text-amber-700 dark:text-amber-400">
      ⚠ 推论挂了脚注
    </span>
  );
}
