'use client';

/**
 * Markdown for workplans, review notes and the like, rendered by streamdown (AI Elements).
 * The source is cut into blank-line separated chunks so a chunk that contains a changed line
 * can be highlighted; `〔m1〕` markers become a link that `renderMarker` replaces.
 */
import { useMemo, type ComponentProps, type JSX, type ReactNode } from 'react';
import { MessageResponse } from '@/components/ai-elements/message';
import { preprocessChatText, richComponents } from '@/components/chat/rich-text';
import { cn } from '@/lib/utils';

export interface MarkdownProps {
  source: string;
  /** 0-based source lines to highlight; a chunk with any of them is highlighted. */
  highlightLines?: readonly number[];
  /** Renders a 〔m1〕 marker; default is a small grey tag. */
  renderMarker?: (id: string) => ReactNode;
  className?: string;
}

const MARKER_HREF = '#marker-';

interface Chunk {
  text: string;
  start: number;
  end: number;
}

/** Split on blank lines, except inside code fences. Line numbers are 0-based, inclusive. */
export function chunkMarkdown(source: string): Chunk[] {
  const lines = source.split(/\r?\n/);
  const chunks: Chunk[] = [];
  let cur: string[] = [];
  let start = 0;
  let fence = false;
  const flush = (endLine: number) => {
    if (cur.length) chunks.push({ text: cur.join('\n'), start, end: endLine });
    cur = [];
  };
  lines.forEach((line, i) => {
    if (/^\s*(```|~~~)/.test(line)) fence = !fence;
    if (!fence && line.trim() === '') {
      flush(i - 1);
      return;
    }
    if (!cur.length) start = i;
    cur.push(line);
  });
  flush(lines.length - 1);
  return chunks;
}

const MARKER_RE = /〔(m\d+)〕/g;

export function Markdown({ source, highlightLines = [], renderMarker, className }: MarkdownProps): JSX.Element {
  const chunks = useMemo(() => chunkMarkdown(source.replace(/[ \t]+\^[A-Za-z0-9-]+[ \t]*$/gm, '')), [source]);
  const changed = new Set(highlightLines);
  const components = useMemo(
    () => ({
      a: ({ href, children, ...rest }: ComponentProps<'a'>) => {
        if (href?.startsWith(MARKER_HREF)) {
          const id = href.slice(MARKER_HREF.length);
          return <>{renderMarker ? renderMarker(id) : <span className="bg-muted text-muted-foreground rounded px-1 text-[10px]">{id}</span>}</>;
        }
        return richComponents.a({ href, children, ...rest });
      },
    }),
    [renderMarker],
  );
  return (
    <div data-testid="markdown" className={cn('space-y-3 text-sm', className)}>
      {chunks.map((c) => {
        const hit = Array.from({ length: c.end - c.start + 1 }, (_, k) => c.start + k).some((n) => changed.has(n));
        return (
          <div
            key={c.start}
            data-changed={hit ? 'true' : undefined}
            className={cn(hit && '-ml-2 rounded-r border-l-2 border-amber-400 bg-amber-50 pl-1.5 dark:bg-amber-950/30')}
          >
            <MessageResponse components={components}>{preprocessChatText(c.text.replace(MARKER_RE, `[← $1](${MARKER_HREF}$1)`))}</MessageResponse>
          </div>
        );
      })}
    </div>
  );
}
