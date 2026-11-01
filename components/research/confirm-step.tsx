/**
 * D-64 T41 (ui-4e): step 6, 提交确认 — the report's summary on the left, the decision (三个字段) on the right.
 */
import type { JSX, ReactNode } from 'react';
import { confirmSummaryOf } from '@/lib/research/confirm-summary';

export function ConfirmStep({ markdown, reportName, children }: { markdown: string; reportName: string; children?: ReactNode }): JSX.Element {
  const { soWhat, reasons } = confirmSummaryOf(markdown);
  return (
    // left and right when there is room (the chat takes half the window); above the decision otherwise, so two drafts still sit side by side
    <div className="@container p-3">
      <div className="grid items-start gap-3 @4xl:grid-cols-[16rem_minmax(0,1fr)]">
        <section className="space-y-2 rounded-lg border p-3" data-testid="confirm-summary" aria-label="报告摘要">
          <h2 className="text-sm font-semibold">报告摘要 · {reportName}</h2>
          <p className="text-sm leading-6">{soWhat}</p>
          {reasons.length ? (
            <ol className="list-decimal space-y-1 pl-5 text-sm">
              {reasons.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ol>
          ) : null}
        </section>
        <div className="min-w-0">{children}</div>
      </div>
    </div>
  );
}
