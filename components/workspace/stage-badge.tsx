import type { JSX } from 'react';
import { Badge } from '@/components/ui/badge';

export function StageBadge({ stage, flags }: { stage: string; flags: string[] }): JSX.Element {
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <Badge variant="secondary">{stage}</Badge>
      {flags.map((f) => (
        <Badge key={f} variant="destructive">
          {f}
        </Badge>
      ))}
    </span>
  );
}
