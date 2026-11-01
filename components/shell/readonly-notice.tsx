import { Lock } from 'lucide-react';
import type { JSX, ReactNode } from 'react';
import { cn } from '@/lib/utils';

export interface ReadOnlyNoticeProps {
  /** 1. 你不能做什么，例如"只读：这份调查计划你不能修改，也不能批准。" */
  cannot: ReactNode;
  /** 2. 谁能做，写出负责人的名字和角色。 */
  who: ReactNode;
  /** 3. 为什么；默认是"权限由系统控制"。 */
  why?: ReactNode;
  /** 4. 你在这里能做什么。 */
  can: ReactNode;
  /** 5. 去哪做。 */
  where: ReactNode;
  className?: string;
}

/** Every read-only place says the same five things in the same order (UI/UX 方案 #3, §5). */
export function ReadOnlyNotice({ cannot, who, why = '这是权限规则，由系统控制，不是提示词，AI 也改不了。', can, where, className }: ReadOnlyNoticeProps): JSX.Element {
  return (
    <div role="note" data-testid="readonly-notice" className={cn('rounded-lg border border-amber-500/40 bg-amber-50 p-3 text-sm dark:bg-amber-500/10', className)}>
      <p className="flex items-start gap-1.5 font-medium">
        <Lock className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        <span>{cannot}</span>
      </p>
      <ul className="text-muted-foreground mt-1.5 list-none space-y-0.5 pl-5.5 text-xs">
        <li>
          <span className="text-foreground font-medium">谁能做：</span>
          {who}
        </li>
        <li>
          <span className="text-foreground font-medium">为什么：</span>
          {why}
        </li>
        <li>
          <span className="text-foreground font-medium">你能做什么：</span>
          {can}
        </li>
        <li>
          <span className="text-foreground font-medium">去哪做：</span>
          {where}
        </li>
      </ul>
    </div>
  );
}
