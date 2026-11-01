'use client';

import { useState, type JSX } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

export interface FollowUpClaim {
  /** `C1` */
  id: string;
  /** `H1`: the label the report uses. */
  label: string;
  statement: string;
}

export interface FollowUpDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  claims: FollowUpClaim[];
  /** Name of the report the new version is built on, e.g. "报告 v2". */
  baseReport: string;
  onSubmit: (claimId: string, question: string, budget: FollowUpBudget) => void;
}

/** 'small' (default, what the live demo runs) or 'full' (the full investigation's search / fetch budget). */
export type FollowUpBudget = 'small' | 'full';

/** The form inside the dialog (the dialog's portal is not server-rendered, so this is what the render tests read). */
export function FollowUpForm({ claims, baseReport, onCancel, onSubmit }: { claims: FollowUpClaim[]; baseReport: string; onCancel: () => void; onSubmit: (claimId: string, question: string, budget: FollowUpBudget) => void }): JSX.Element {
  const [claimId, setClaimId] = useState(claims[0]?.id ?? '');
  const [question, setQuestion] = useState('');
  const [budget, setBudget] = useState<FollowUpBudget>('small');
  const chosen = claims.find((c) => c.id === claimId);
  return (
    <>
      <DialogHeader>
        <DialogTitle>追加调查</DialogTitle>
        <DialogDescription>
          在一个已有的论点下面加一个新的子问题，在 {baseReport} 的基础上从“先查知识库”（包括专家访谈）开始重跑一遍（预算在下面选），需要时再联网，按判断标准重新判断。新子问题会进调查计划（新版本，由你这次提交一并批准）；{baseReport} 的内容全部保留，生成下一个版本。
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-3 text-sm">
        <fieldset className="space-y-1.5">
          <legend className="text-muted-foreground mb-1 text-xs">挂在哪个论点（假设）下面</legend>
          {claims.map((c) => (
            <button
              key={c.id}
              type="button"
              aria-pressed={claimId === c.id}
              onClick={() => setClaimId(c.id)}
              className={cn('hover:bg-accent/50 w-full rounded-md border px-2.5 py-1.5 text-left text-xs', claimId === c.id && 'border-primary bg-accent')}
            >
              <span className="text-muted-foreground mr-1.5 font-mono">{c.label}</span>
              {c.statement}
            </button>
          ))}
        </fieldset>
        <label className="block space-y-1">
          <span className="text-muted-foreground text-xs">新的子问题（至少写几个字）</span>
          <Textarea value={question} onChange={(e) => setQuestion(e.target.value)} rows={2} maxLength={200} placeholder="例如：专家的反面意见：管得太死会不会让员工绕开 IT" aria-label="新的子问题" />
        </label>
        <fieldset className="flex flex-wrap items-center gap-1.5" data-testid="follow-up-budget">
          <legend className="text-muted-foreground mb-1 w-full text-xs">预算</legend>
          {(
            [
              ['small', '试水调查（搜 3 次、抓 3 次，约 3 分钟）'],
              ['full', '完整调查（搜约 30 次、抓约 45 次，约 20 分钟）'],
            ] as const
          ).map(([b, text]) => (
            <button
              key={b}
              type="button"
              aria-pressed={budget === b}
              onClick={() => setBudget(b)}
              className={cn('hover:bg-accent/50 rounded-md border px-2.5 py-1 text-xs', budget === b && 'border-primary bg-accent')}
            >
              {text}
            </button>
          ))}
        </fieldset>
      </div>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel}>
          取消
        </Button>
        <Button type="button" disabled={!chosen || question.trim().length < 6} data-testid="follow-up-submit" onClick={() => chosen && onSubmit(chosen.id, question.trim(), budget)}>
          开始追加调查
        </Button>
      </DialogFooter>
    </>
  );
}

/** 追加调查: which claim, the new sub-question, and the budget (small by default); the result is the next report version. */
export function FollowUpDialog({ open, onOpenChange, claims, baseReport, onSubmit }: FollowUpDialogProps): JSX.Element {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="follow-up-dialog">
        <FollowUpForm
          claims={claims}
          baseReport={baseReport}
          onCancel={() => onOpenChange(false)}
          onSubmit={(claimId, focus, budget) => {
            onOpenChange(false);
            onSubmit(claimId, focus, budget);
          }}
        />
      </DialogContent>
    </Dialog>
  );
}
