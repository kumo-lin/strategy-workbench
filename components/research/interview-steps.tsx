'use client';

/**
 * D-64 T40: step 4 (访谈建议, ui-4c) and step 5 (追加分析, ui-4d) of the research page. The advice is read from the
 * report; the follow-up takes interview notes put in here (T25: only the judgments they touch are judged again) and
 * shows the new version's change table, with the submit to the Senior under it.
 */
import { useRouter } from 'next/navigation';
import { useRef, useState, type JSX, type ReactNode } from 'react';
import { Bubble, RuleExplanation } from './rule-explanation';
import { confirmSummaryOf, reasonDetailsOf } from '@/lib/research/confirm-summary';
import type { ExplanationContext } from '@/lib/research/explanation-types';
import { Button } from '@/components/ui/button';
import { interviewOutline, type InterviewAdvice } from '@/lib/research/interview-advice';

export function InterviewAdvicePanel({ advice, title, onNext }: { advice: InterviewAdvice; title: string; onNext: () => void }): JSX.Element {
  const download = () => {
    const url = URL.createObjectURL(new Blob([interviewOutline(advice, title)], { type: 'text/markdown;charset=utf-8' }));
    const a = Object.assign(document.createElement('a'), { href: url, download: `${title} 访谈提纲.md` });
    a.click();
    URL.revokeObjectURL(url);
  };
  return (
    <div id="interview-advice" className="space-y-3 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-semibold">访谈建议 · 公开资料证明不了的地方</h2>
        <Button type="button" size="sm" variant="outline" className="ml-auto" data-testid="export-outline" onClick={download}>
          导出访谈提纲
        </Button>
      </div>
      {advice.gaps.length ? (
        <ul className="list-disc space-y-0.5 pl-5 text-sm">
          {advice.gaps.map((g) => (
            <li key={g.question}>
              {g.question}：{g.missing}
            </li>
          ))}
        </ul>
      ) : null}
      <table data-testid="interview-table" className="w-full border-collapse text-sm">
        <thead>
          <tr className="text-muted-foreground text-left text-xs">
            {['找谁', '问什么', '为了验证什么'].map((h) => (
              <th key={h} className="border-b px-2 py-1 font-normal">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {advice.groups.map((g) =>
            g.rows.map((r, i) => (
              <tr key={`${g.who}/${i}`} data-testid="interview-row" className="align-top">
                {i === 0 ? (
                  <td rowSpan={g.rows.length} className="border-b px-2 py-1.5">
                    {g.who}
                  </td>
                ) : null}
                <td className="border-b px-2 py-1.5">{r.question}</td>
                <td className="border-b px-2 py-1.5">{r.verify}</td>
              </tr>
            )),
          )}
        </tbody>
      </table>
      <div data-testid="interview-rule" className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
        <p className="font-medium">验证规则（执行前约定）</p>
        <p>{advice.rule}</p>
      </div>
      <Button type="button" size="sm" onClick={onNext}>
        访谈做完了，去追加分析 →
      </Button>
    </div>
  );
}

export function ReanalysisPanel({
  workspacePath,
  researchDir,
  canUpload,
  reportName,
  changes,
  submitSlot,
  explanationContext,
  reportMarkdown,
  changeHeads,
}: {
  workspacePath: string;
  researchDir: string;
  canUpload: boolean;
  reportName: string | null;
  changes: string[][] | null;
  submitSlot?: ReactNode;
  explanationContext?: ExplanationContext | null;
  /** The version shown: its So what and reasons stand above the change table (ui-4d). */
  reportMarkdown?: string;
  /** The two versions the change table compares (v1 and v2, or v2 and v3 after a second round). */
  changeHeads?: [string, string];
}): JSX.Element {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [simulated, setSimulated] = useState(false);
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<string[]>([]);
  const onFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy(true);
    const names = [...files].map((f) => f.name);
    setSaid((s) => [...s, `放入访谈：${names.join('、')}`]);
    try {
      const body = { workspacePath, researchDir, simulated, files: await Promise.all([...files].map(async (f) => ({ filename: f.name, content: await f.text() }))) };
      const res = await fetch('/api/research/interviews', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const json = (await res.json().catch(() => ({}))) as { message?: string; hits?: { interview: string; claims: string[]; reason: string }[]; rejudged?: string[] };
      if (!res.ok) setSaid((s) => [...s, res.status === 415 ? '只能放 .md 或 .txt 的访谈记录' : (json.message ?? '没有分析成功，请重试')]);
      else {
        setSaid((s) => [...s, ...(json.hits ?? []).map((h) => `${h.interview}：涉及 ${h.claims.join('、')}。${h.reason}`), `只重判了 ${json.rejudged?.join('、') || '0 个判断'}；访谈最多提到“访谈支持”，不会提到“成立”。`]);
        router.refresh();
      }
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  };
  const summary = reportMarkdown ? confirmSummaryOf(reportMarkdown) : null;
  const reasons = reportMarkdown ? reasonDetailsOf(reportMarkdown) : [];
  // 复核 P3 (ui-4d): the conversation on the left, the new version on the right, each scrolling on its own when there is
  // room (the page used to scroll as one, and the report left the view as soon as the analyst asked a question)
  return (
    <div className="grid gap-3 p-3 @min-[48rem]:h-full @min-[48rem]:min-h-0 @min-[48rem]:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
      <section className="flex min-w-0 flex-col gap-2 rounded-lg border p-3 @min-[48rem]:min-h-0" aria-label="和 AI 讨论 · 追加分析">
        <h2 className="text-sm font-semibold">和 AI 讨论 · 追加分析</h2>
        <RuleExplanation
          key={explanationContext?.identity ?? 'unavailable'}
          context={explanationContext ?? null}
          before={
            <>
              <Bubble who="ai">把访谈记录放进来，AI 找出它涉及的判断，只改这些；访谈最多把判断提到“访谈支持”。</Bubble>
              {said.map((l, i) => (
                <Bubble key={i} who={l.startsWith('放入访谈：') ? 'user' : 'ai'}>
                  {l}
                </Bubble>
              ))}
            </>
          }
          controls={
            canUpload ? (
              <div className="flex flex-wrap items-center gap-2">
                <input ref={input} type="file" accept=".md,.txt" multiple hidden onChange={(e) => void onFiles(e.target.files)} />
                <Button type="button" size="sm" variant="outline" data-testid="upload-interview" disabled={busy} onClick={() => input.current?.click()}>
                  {busy ? '分析中…' : '放入访谈记录'}
                </Button>
                <label className="text-muted-foreground inline-flex items-center gap-1 text-xs">
                  <input type="checkbox" checked={simulated} onChange={(e) => setSimulated(e.target.checked)} /> 模拟访谈
                </label>
              </div>
            ) : null
          }
        />
      </section>
      <section className="min-w-0 space-y-3 rounded-lg border p-3 @min-[48rem]:min-h-0 @min-[48rem]:overflow-y-auto" aria-label="报告新版本">
        {reportName ? <h3 className="text-sm font-semibold">{reportName}</h3> : null}
        {changes && summary?.soWhat ? (
          <div className="bg-muted/50 rounded-md border-l-4 border-l-primary p-3" data-testid="reanalysis-sowhat">
            <p className="text-muted-foreground text-xs">So what</p>
            <p className="text-sm font-semibold leading-6">{summary.soWhat}</p>
          </div>
        ) : null}
        {changes && reasons.length ? (
          <div className="space-y-1">
            <p className="text-muted-foreground text-xs">为什么（三条支撑）</p>
            <ol className="divide-y text-sm">
              {reasons.map((r, i) => (
                <li key={i} className="py-1.5">
                  <p className="font-medium">
                    {'①②③'[i]} {r.title}
                  </p>
                  {r.basis.map((b, j) => (
                    <p key={j} className="text-muted-foreground text-xs leading-5">
                      <span className={b.kind === '访谈支持' ? 'text-amber-700 dark:text-amber-400' : ''}>{b.kind === '访谈支持' ? '推断（访谈支持）' : b.kind}</span>：{b.text}
                    </p>
                  ))}
                </li>
              ))}
            </ol>
          </div>
        ) : null}
        {changes ? (
          <>
            <p className="text-sm font-medium">因为追加了访谈，结论变了什么</p>
            <table data-testid="change-table" className="w-full border-collapse text-sm">
              <thead>
                <tr className="text-muted-foreground text-left text-xs">
                  <th className="border-b px-2 py-1 font-normal" />
                  <th className="border-b px-2 py-1 font-normal">{changeHeads?.[0] ?? 'v1'}</th>
                  <th className="border-b px-2 py-1 font-normal">{changeHeads?.[1] ?? 'v2'}</th>
                </tr>
              </thead>
              <tbody>
                {changes.map((r) => (
                  <tr key={r[0]} className="align-top">
                    {r.map((c, i) => (
                      <td key={i} className="border-b px-2 py-1.5">
                        {c}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            {submitSlot}
          </>
        ) : (
          <p className="text-muted-foreground text-sm">追加分析之后，这里显示新版本和它的变化。</p>
        )}
      </section>
    </div>
  );
}
