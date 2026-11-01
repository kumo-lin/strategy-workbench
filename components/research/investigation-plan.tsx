/**
 * D-64 T36 (ui-2c): the investigation plan read by key question — under each K, its competing hypotheses side by
 * side, each with what must hold, what evidence, where to look and what would show it wrong (the counter-search).
 * A plan without key questions renders nothing (the editor below shows it as before).
 */
import type { JSX } from 'react';
import { conditionText, hypothesisLabel } from '@/lib/research/question-tree';
import type { EditablePlan } from '@/lib/research/plan-types';

const field = (c: EditablePlan['claims'][number]['conditions'][number], k: 'evidence_needed' | 'where') => (typeof c === 'string' ? '' : (c[k] ?? ''));
const lines = (xs: string[]) => (xs.filter(Boolean).length ? xs.filter(Boolean).map((x, i) => <p key={i}>{x}</p>) : '—');

export function InvestigationPlanView({ plan }: { plan: EditablePlan }): JSX.Element | null {
  const keys = [...new Set(plan.claims.flatMap((c) => (c.key ? [c.key] : [])))].sort();
  if (!keys.length) return null;
  return (
    <section data-testid="investigation-plan" className="space-y-3 rounded-lg border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded border px-1.5 text-xs">假设驱动</span>
        <p className="text-sm">
          <span className="text-muted-foreground">为什么查：</span>
          {plan.purpose}
        </p>
      </div>
      <h3 className="text-sm font-medium">问题树</h3>
      <p className="text-sm">{plan.question}</p>
      {keys.map((k) => {
        const claims = plan.claims.filter((c) => c.key === k);
        const ifBad = claims.find((c) => c.if_bad)?.if_bad;
        return (
          <div key={k} className="space-y-2" data-key={k}>
            <p className="text-sm font-medium">
              {k}
              {ifBad ? <span className="text-muted-foreground font-normal">（结果不理想：{ifBad}）</span> : null}
            </p>
            <p className="text-muted-foreground text-xs">竞争假设，和每个假设要什么证据</p>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[44rem] border-collapse text-sm">
                <thead>
                  <tr className="text-muted-foreground text-left text-xs">
                    {['假设', '必须成立的条件', '要什么证据', '去哪里查', '证伪标准'].map((h) => (
                      <th key={h} className="border-b px-2 py-1 font-normal">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {claims.map((c) => {
                    const label = hypothesisLabel(plan, c.id);
                    return (
                      <tr key={c.id} data-testid="hypothesis-row" data-h={label} className="align-top">
                        <td className="border-b px-2 py-1.5">
                          <span className="text-muted-foreground text-xs">{label} </span>
                          {c.statement}
                        </td>
                        <td className="border-b px-2 py-1.5">{lines(c.conditions.map(conditionText))}</td>
                        <td className="border-b px-2 py-1.5">{lines(c.conditions.map((x) => field(x, 'evidence_needed')))}</td>
                        <td className="border-b px-2 py-1.5">{lines(c.conditions.map((x) => field(x, 'where')))}</td>
                        <td className="border-b px-2 py-1.5">{c.counter_search}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}
    </section>
  );
}
