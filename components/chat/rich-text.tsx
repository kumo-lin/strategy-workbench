'use client';

/**
 * Chat text = markdown (streamdown) + two vault conventions the model writes:
 *   ==x==                  → <mark>x</mark>
 *   [[路径|显示名]] [[路径]] [[路径#^m1]]  → a chip with the display name (or the file name)
 * Both are rewritten to markdown links with a private `#…` href before streamdown sees the
 * text, then drawn by the `a` override. Code spans and fences are left alone.
 */
import { FileText } from 'lucide-react';
import type { ComponentProps, JSX } from 'react';
import { MessageResponse } from '@/components/ai-elements/message';
import { cn } from '@/lib/utils';

const MARK_HREF = '#sw-mark';
const WIKI_HREF = '#sw-wiki:';

/** Label shown for a wikilink: alias, else the last path segment, plus the block id (`m1`) for block refs. */
export function wikiLabel(inner: string): { target: string; label: string } {
  const pipe = inner.indexOf('|');
  const ref = (pipe >= 0 ? inner.slice(0, pipe) : inner).trim();
  const alias = pipe >= 0 ? inner.slice(pipe + 1).trim() : '';
  const [pathPart, frag = ''] = ref.split('#');
  const name = pathPart.split('/').pop()!.replace(/\.md$/, '');
  const block = frag.startsWith('^') ? frag.slice(1) : '';
  const base = alias || name || ref;
  return { target: ref, label: block && !alias ? `${base} · ${block}` : base };
}

const esc = (s: string) => s.replace(/[[\]()\\]/g, '\\$&');

/** Rewrite ==x== and [[x]] outside code into markdown links. Pure. */
export function preprocessChatText(text: string): string {
  return text
    .split(/(```[\s\S]*?(?:```|$)|`[^`\n]*`)/g)
    .map((seg, i) => {
      if (i % 2 === 1) return seg; // code
      return seg
        .replace(/\[\[([^[\]\n]+?)\]\]/g, (_m, inner: string) => {
          const { target, label } = wikiLabel(inner);
          return `[${esc(label)}](${WIKI_HREF}${encodeURIComponent(target).replace(/[()]/g, (c) => `%${c.charCodeAt(0).toString(16)}`)})`;
        })
        .replace(/==(?=\S)([^=\n]+?)(?<=\S)==/g, (_m, inner: string) => `[${inner}](${MARK_HREF})`);
    })
    .join('');
}

/** A person's own message as their bubble shows it: a vault link reads as its name (the model still gets the link). */
export function plainChatText(text: string): string {
  return text.replace(/\[\[([^[\]\n]+?)\]\]/g, (_m, inner: string) => wikiLabel(inner).label);
}

export const richComponents = {
  a: ({ href, children, ...rest }: ComponentProps<'a'>): JSX.Element => {
    if (href === MARK_HREF) {
      return <mark className="rounded bg-amber-200/70 px-0.5 text-inherit dark:bg-amber-400/30">{children}</mark>;
    }
    if (href?.startsWith(WIKI_HREF)) {
      return (
        <span
          data-wikilink={decodeURIComponent(href.slice(WIKI_HREF.length))}
          title={decodeURIComponent(href.slice(WIKI_HREF.length))}
          className="bg-muted text-foreground mx-0.5 inline-flex items-center gap-1 rounded-md border px-1.5 py-px align-baseline text-[0.9em]"
        >
          <FileText className="size-3 shrink-0 opacity-60" aria-hidden="true" />
          {children}
        </span>
      );
    }
    return (
      <a href={href} {...rest}>
        {children}
      </a>
    );
  },
};

export function RichResponse({ children, className }: { children: string; className?: string }): JSX.Element {
  return (
    <MessageResponse className={cn(className)} components={richComponents}>
      {preprocessChatText(children)}
    </MessageResponse>
  );
}
