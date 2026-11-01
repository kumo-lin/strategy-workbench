'use client';

/**
 * 和 AI 讨论 on the 追加分析 step (ui-4d, 复核 P3): the analyst asks about the selected report in a conversation; each
 * answer is a deterministic projection of the saved records and the rule agreed before the interviews (no model,
 * no writes). The conversation lives on this page only and starts again when the judgment or the version changes.
 */
import { useEffect, useRef, useState, type JSX, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { answerExplanation, classifyExplanationQuestion, EXPLANATION_QUESTION_LIMIT, EXPLANATION_QUESTIONS, explanationText } from '@/lib/research/explanation-answer';
import { INTERVIEW_RULE } from '@/lib/research/interview-advice';
import type { ExplanationContext } from '@/lib/research/explanation-types';

const PROVENANCE = {
  reported_simulated: '原报告记录：本版追加访谈均标记为模拟；不据此推断每个判断的支持来源。',
  reported_real: '原报告记录：本版追加访谈均标记为真实；本入口未重新核验。',
  reported_mixed: '原报告记录：本版追加访谈含真实和模拟记录；本入口未重新核验。',
  unknown: '访谈是否模拟：该版本未记录完整标记；不推断为真实。',
};

/** One bubble: the analyst's on the right, the AI's on the left (the same look as the other chats). */
export function Bubble({ who, children, testId }: { who: 'user' | 'ai'; children: ReactNode; testId?: string }): JSX.Element {
  return who === 'user' ? (
    <div className="flex justify-end">
      <p className="bg-primary text-primary-foreground max-w-[85%] rounded-lg px-3 py-2 text-sm break-words whitespace-pre-wrap">{children}</p>
    </div>
  ) : (
    <div className="flex items-start gap-2">
      <span className="bg-muted text-muted-foreground mt-0.5 shrink-0 rounded-full px-1.5 py-0.5 text-[11px] font-medium">AI</span>
      <div data-testid={testId} className="bg-card max-w-[90%] rounded-lg border px-3 py-2 text-sm leading-6 break-words whitespace-pre-wrap">
        {children}
      </div>
    </div>
  );
}

/**
 * `before`: what the page said earlier in the conversation (the interviews put in); `controls`: the upload row, kept
 * next to the question box so the whole conversation reads top to bottom.
 */
export function RuleExplanation({ context, before, controls }: { context: ExplanationContext | null; before?: ReactNode; controls?: ReactNode }): JSX.Element {
  const [targetId, setTargetId] = useState(context?.targets.length === 1 ? context.targets[0].id : '');
  const [question, setQuestion] = useState('');
  const [turns, setTurns] = useState<{ question: string; answer: string }[]>([]);
  const ready = context?.state === 'ready' && context.targets.length > 0;
  // the newest question comes into view with the start of its answer (the conclusion comes first)
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const last = list.current?.querySelector<HTMLElement>('[data-turn]:last-of-type');
    if (list.current && last) list.current.scrollTop = last.offsetTop - 8;
  }, [turns.length]);
  const ask = () => {
    if (!context || !ready) return;
    const submitted = explanationText(question);
    // a question that names one judgment (「K3 能改成成立吗」) picks it, as a person would expect in a conversation
    const named = [...new Set([...submitted.normalize('NFKC').matchAll(/(?<![A-Za-z\d])[KH]\d+(?:-\d+)?(?![\dA-Za-z-])/gi)].map((m) => m[0].toUpperCase()))];
    const byName = named.length === 1 ? context.targets.find((t) => t.token === named[0]) : undefined;
    const target = byName ?? context.targets.find((t) => t.id === targetId);
    if (byName && byName.id !== targetId) setTargetId(byName.id);
    const q = classifyExplanationQuestion(submitted, target, context);
    const answer = q.kind === 'clarify' ? q.message : q.intent === 'what_changed' ? answerExplanation(context, '', q.intent) : target ? answerExplanation(context, target.id, q.intent) : '请先选择判断。';
    setTurns((ts) => [...ts, { question: submitted, answer }]);
    setQuestion('');
  };
  return (
    <div data-testid="rule-explanation" className="flex min-h-0 flex-1 flex-col gap-2">
      <div ref={list} className="relative min-h-0 flex-1 space-y-2 overflow-y-auto pr-1" aria-live="polite">
        <div className="text-muted-foreground space-y-0.5 text-xs">
          <p>
            <span className="text-foreground font-medium">按已保存的记录解释 · 只读</span>
            {context ? <span data-testid="explanation-version"> · 解释对象：{explanationText(context.reportName)} · 当前页面快照，不是实时重新核验</span> : null}
          </p>
          {ready ? <p>{PROVENANCE[context.interviewProvenance]}</p> : null}
          {ready && context.notice ? <p>{explanationText(context.notice)}</p> : null}
          <p>事先约定：{INTERVIEW_RULE}</p>
          <p>解释不修改报告或判断，刷新后不保留；只支持下面几种问法。</p>
        </div>
        {before}
        {turns.map((t, i) => (
          <div key={i} data-turn className="space-y-2">
            <Bubble who="user">{t.question}</Bubble>
            <Bubble who="ai" testId={i === turns.length - 1 ? 'explanation-answer' : undefined}>
              {t.answer}
            </Bubble>
          </div>
        ))}
      </div>
      <div className="space-y-2 border-t pt-2">
        {controls}
        {ready ? (
          <>
            <form
              className="space-y-2"
              onSubmit={(e) => {
                e.preventDefault();
                ask();
              }}
            >
              <label className="flex items-center gap-2 text-xs">
                <span className="text-muted-foreground shrink-0">要解释的判断</span>
                <select
                  data-testid="explanation-target"
                  className="bg-background min-w-0 flex-1 rounded-md border px-2 py-1"
                  value={targetId}
                  onChange={(e) => {
                    setTargetId(e.target.value);
                    setQuestion('');
                    setTurns([]);
                  }}
                >
                  <option value="">请选择一个判断（问题里写了 K3 这样的编号也可以）</option>
                  {context.targets.map((t) => (
                    <option key={t.id} value={t.id}>
                      {explanationText(t.label)} · {t.verdictLabel}
                    </option>
                  ))}
                </select>
              </label>
              <div className="flex flex-wrap gap-1">
                {EXPLANATION_QUESTIONS.map((q) => (
                  <Button key={q} type="button" size="sm" variant="outline" className="h-6 px-2 text-xs" onClick={() => setQuestion(q)}>
                    {q}
                  </Button>
                ))}
              </div>
              <div className="flex items-end gap-2">
                <Textarea
                  data-testid="explanation-question"
                  aria-label="你的问题"
                  value={question}
                  maxLength={EXPLANATION_QUESTION_LIMIT}
                  rows={2}
                  placeholder="你的问题：比如“K3 能直接改成成立吗？”"
                  className="min-h-0 resize-none"
                  onChange={(e) => setQuestion(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                      e.preventDefault();
                      ask();
                    }
                  }}
                />
                <Button type="submit" size="sm" data-testid="explanation-send" disabled={!question.trim()}>
                  发送问题
                </Button>
              </div>
            </form>
          </>
        ) : (
          <p role="status" className="text-muted-foreground text-xs">
            {context?.unavailableReason === 'updating' ? '报告更新中，请刷新后再问。' : '该版本的解释数据不可用，请回报告核对；不会猜测具体判断或补写记录。'}
          </p>
        )}
      </div>
    </div>
  );
}
