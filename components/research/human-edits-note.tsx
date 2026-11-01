/** D-24: "人工修正 N 处错别字，内容未改" beside a report's name; hover or open it for the text before and after. */
import type { JSX } from 'react';
import { humanEditsLine, type HumanEdit } from '@/lib/report/human-edits';

export function HumanEditsNote({ edits }: { edits: HumanEdit[] | undefined }): JSX.Element | null {
  const line = humanEditsLine(edits ?? []);
  if (!line || !edits) return null;
  const pairs = edits.map((e) => `${e.where ? `${e.where}：` : ''}“${e.before}” → “${e.after}”`);
  return (
    <details className="relative text-xs" data-testid="human-edits">
      <summary title={pairs.join('\n')} className="cursor-pointer rounded-md border border-dashed px-1.5 py-0.5">
        {line}
      </summary>
      <ul className="bg-background absolute z-20 mt-1 w-max max-w-96 space-y-1 rounded-md border p-2 shadow-sm">
        {edits.map((e, i) => (
          <li key={i}>
            {e.where ? <span className="text-muted-foreground">{e.where}：</span> : null}
            改前 <span className="font-mono">“{e.before}”</span> → 改后 <span className="font-mono">“{e.after}”</span>
          </li>
        ))}
      </ul>
    </details>
  );
}
