'use client';

import {
  AlertTriangle,
  BookIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  ExternalLink,
  FileText,
  Quote,
} from 'lucide-react';
import {
  Fragment,
  useCallback,
  useMemo,
  useState,
  type ComponentType,
  type JSX,
  type ReactNode,
} from 'react';

import {
  InlineCitationCard,
  InlineCitationCardBody,
} from '@/components/ai-elements/inline-citation';
import {
  Source,
  Sources,
  SourcesContent,
  SourcesTrigger,
  type SourcesProps,
} from '@/components/ai-elements/sources';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { HoverCardTrigger } from '@/components/ui/hover-card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { describeSource, type CitationDetail } from '@/lib/research/citation-types';
import { MODE_NAME } from '@/lib/research/mode-copy';
import { cn } from '@/lib/utils';

import { simulatedFootnotes, uniqueCitedSources } from './citation-utils';
import { parseMarkdown, type Block, type Inline, type ListItem } from './markdown-lite';
import { conditionLine, duplicateAnswerBlocks, findFolds, foldTitle, inlineText, isQuestionTree, isSourceQuote, splitBasisOf, questionAnchor, questionIdOf, questionTree, type ConditionLine, type ConditionStatus, type Fold, type TreeNode } from './report-structure';
import { HumanEditsNote } from './human-edits-note';
import { InferenceWarningTag, LengthWarningTag, NumberWarnings, NumberWarningTag, ReviewNotes, ReviewNoteTag, SourceWarnings, SourceWarningTag } from './source-warnings';
import { blockQuote, markInferenceFlags, markNumberFlags, numberMismatches, numbersNeedingEvidence, responseProblems } from '@/lib/research/number-check';
import { checkReportText } from '@/lib/research/selfcheck';
import { warnedFootnotes, type SourceWarning } from '@/lib/report/source-warnings';
import { notedFootnotes, placeReviewNotes, type ReportReviewNote } from '@/lib/report/review-notes';
import type { HumanEdit } from '@/lib/report/human-edits';
import { lengthFlagIn, lengthKey, type LengthFlag } from '@/lib/report/length-flags';
import { footnoteMarks, summaryFlagTitle, type CitationFlag, type EntityFlagShown, type FootnoteMark, type SummaryFlag } from '@/lib/report/citation-flags';
import { verifyMarks, type VerifyItem } from '@/lib/report/citation-verify';
import { emptyClauseFootnotes } from '@/lib/report/empty-clause';
import { CONDITION_LINK, conditionAnchor } from '@/lib/report/condition-link';
import { footnoteFlags, sentenceEnds, type Part } from '@/lib/report/sentence-place';

export interface ReportVersion {
  name: string;
  path: string;
  label?: string;
}

export interface ReportViewerProps {
  /** 报告全文（可以带 frontmatter，查看器会去掉）。 */
  markdown: string;
  /** 报告里所有块引用的详情，key 是 CitationDetail.link（完整的 `[[…]]` 原文）。 */
  citations: Record<string, CitationDetail>;
  versions?: ReportVersion[];
  currentVersion?: string;
  onSelectVersion?: (path: string) => void;
  /** 状态标签。 */
  exploratory?: boolean;
  delivery?: '已交付' | '草稿';
  failedChecks?: string[];
  /** D-24: 人工修正记录（frontmatter 的 human_edits）；有才显示一句。 */
  humanEdits?: HumanEdit[];
  /** 报告的 source_warnings：Summary 上方的"来源警告"框，对应脚注旁标"⚠ 来源有问题"。 */
  sourceWarnings?: SourceWarning[];
  /** 报告的 review_notes：标题"人工核对注"；有脚注的在脚注旁标"⚠ 见核对注"，没有脚注的放在 where 指向的小节顶部。 */
  reviewNotes?: ReportReviewNote[];
  /** 报告的 length_flags（D-48）：改写以后还超长的句子，句子旁标"⚠ 超过 N 字"。 */
  lengthFlags?: LengthFlag[];
  /** 报告的 citation_flags（D-48 第 3 轮）：复核后还像挂错的脚注，脚注旁标"⚠ 引文可能对不上"，悬停看理由和原文。 */
  citationFlags?: CitationFlag[];
  /** 报告的 entity_flags（D-48 第 4 轮）：原文里一个都没有出现句子里的名字和数字，同样标"⚠ 引文可能对不上"，悬停看缺了什么。 */
  entityFlags?: EntityFlagShown[];
  /** 报告的 citation_verify（D-56 ⑦）：三关核对的结果，脚注旁标绿色 ✓ 依据或灰色 相关资料。 */
  citationVerify?: VerifyItem[];
  /** 报告的 summary_flags（D-48 第 5 轮 B）：一句话回答和对决策的回答里，语气或方向和子问题的回答对不上的分句，旁边标 ⚠。 */
  summaryFlags?: SummaryFlag[];
  /** 报告下面的一块额外内容（M3：Senior 的"起草决定"）。 */
  footer?: ReactNode;
  /** What this version is, when it must not read as a confirmed latest conclusion (lib/research/version-status.ts). */
  statusNote?: string;
  /** How far the first run went: a 试水调查 answered only some hypotheses, and the report says so at the top. */
  scope?: { mode: 'small' | 'full'; hypotheses: string[] };
  /** Above the report: Senior's "起草决定 + 理由" shortcut, or the note that the decision is Senior's to confirm. */
  decisionTop?: ReactNode;
  /** Set → the 追加调查 button is live (the owner, on a delivered report). The other next actions stay as visible entries. */
  onFollowUp?: () => void;
  /** D-64 T40: 下一步：看访谈建议 → opens step 4. */
  onNextStep?: () => void;
}

const NEXT_ACTIONS = ['追加调查', '调整方向', '重新调查', '新建调查', '直接 fix 当前版本'];

const ERROR_TEXT: Record<NonNullable<CitationDetail['error']>, string> = {
  block_not_found: '资料里没有这一块',
  quote_mismatch: '报告里的引文和资料原文对不上',
  note_not_found: '找不到这份资料',
  ambiguous: '资料名有歧义',
};

const GRADE_VARIANT: Record<'A' | 'B' | 'C', 'default' | 'secondary' | 'outline'> = {
  A: 'default',
  B: 'secondary',
  C: 'outline',
};

const HEADING_CLASS: Record<1 | 2 | 3 | 4, string> = {
  1: 'mt-1 text-2xl font-semibold tracking-tight',
  2: 'mt-4 text-lg font-semibold',
  3: 'mt-3 text-base font-semibold',
  4: 'mt-3 text-sm font-semibold',
};

/**
 * AI Elements 的 `Sources` 内部就是 shadcn 的 `Collapsible`（默认展开靠 `defaultOpen`），
 * 但它的公开 props 类型只声明了 `div` 的属性，所以这里把 `defaultOpen` 补上。
 */
type SourcesPanelProps = SourcesProps & { defaultOpen?: boolean };

const SourcesPanel = Sources as ComponentType<SourcesPanelProps>;

interface RenderContext {
  citations: Record<string, CitationDetail>;
  selectedLink: string | null;
  onSelect: (link: string) => void;
  /** Footnote id → its definition (D-20 reports: the quote, grade and source live there). */
  footnotes: Map<string, Inline[]>;
  /** Footnotes that cite a simulated interview: their marker gets "（模拟）". */
  simulated: Set<string>;
  /** Footnotes whose source has a source_warnings entry: their marker gets "⚠ 来源有问题". */
  warned: Set<string>;
  /** Footnote id → the review notes naming it: the marker gets "⚠ 见核对注" (the notes as its title). */
  noted: Map<string, string>;
  /** The question tree of a question-tree report: drawn under the Summary's `问题树` line, and its headings get anchors. */
  tree?: TreeNode[];
  /** length_flags with their sentences keyed for matching (lengthKey). */
  lengths?: { key: string; flag: LengthFlag }[];
  /** citation_flags and entity_flags: marked beside their footnote in their sentence only, by its block link (footnoteFlags). */
  marks?: FootnoteMark[];
  /** With citation_verify on the report: a footnote whose clause is empty is not drawn. */
  hideEmptyClauses: boolean;
  /** Marks that go right after a sentence (length_flags, summary_flags, a number with no evidence footnote): sentence-place. */
  endMarks?: { sentence: string; render: (key: string) => ReactNode }[];
  /** The card a list is in ("H2-1"): its ①②③ lines get the anchor "（见 Q2-1 ②）" links to. */
  hypothesis?: string;
  /** Block index → the card ("假设 H2-1") it is under. */
  hypothesisAt?: Map<number, string>;
  /** Footnote id → its block link, as this version numbers them. */
  refOf?: (id: string) => string;
}

type CitationInline = Extract<Inline, { kind: 'citation' }>;

/** 忽略空白与标点地定位 quote 在原文中的位置。 */
const IGNORED_CHAR = /[\s\p{P}\p{S}]/u;

function normalizeWithMap(text: string): { normalized: string; map: number[] } {
  const chars: string[] = [];
  const map: number[] = [];
  for (let i = 0; i < text.length; i += 1) {
    const ch = text.charAt(i);
    if (IGNORED_CHAR.test(ch)) continue;
    chars.push(ch);
    map.push(i);
  }
  return { normalized: chars.join(''), map };
}

function findQuoteRange(text: string, quote: string): [number, number] | null {
  if (text.length === 0 || quote.length === 0) return null;
  const { normalized: haystack, map } = normalizeWithMap(text);
  const needle = normalizeWithMap(quote).normalized;
  if (needle.length === 0) return null;

  const index = haystack.indexOf(needle);
  if (index === -1) return null;

  const start = map[index];
  const end = map[index + needle.length - 1];
  if (start === undefined || end === undefined) return null;
  return [start, end + 1];
}

function renderHighlighted(text: string, range: [number, number] | null): ReactNode {
  if (range === null) return text;
  const [start, end] = range;
  if (start <= 0 && end >= text.length) {
    return (
      <mark className="rounded-sm bg-primary/15 px-0.5 text-foreground">
        {text.slice(start, end)}
      </mark>
    );
  }
  return (
    <>
      {start > 0 ? text.slice(0, start) : null}
      <mark className="rounded-sm bg-primary/15 px-0.5 text-foreground">
        {text.slice(start, end)}
      </mark>
      {text.slice(end)}
    </>
  );
}

function plainText(inline: Inline[]): string {
  let out = '';
  for (const node of inline) {
    switch (node.kind) {
      case 'text':
      case 'bold':
      case 'code':
      case 'quote':
        out += node.text;
        break;
      case 'link':
        out += node.label;
        break;
      case 'citation':
        out += node.link;
        break;
      case 'footnote':
        out += `[${node.id}]`;
        break;
    }
  }
  return out;
}

/** A footnote marker: hover shows the quote and source, a click opens the citation panel on its first citation. */
function FootnoteRef({ id, ctx, numberFlag, inferenceFlag, marks }: { id: string; ctx: RenderContext; numberFlag?: boolean; inferenceFlag?: boolean; marks?: FootnoteMark[] }): JSX.Element {
  const def = ctx.footnotes.get(id);
  const first = def?.find((n): n is CitationInline => n.kind === 'citation');
  const label = def ? def.map((n) => (n.kind === 'quote' ? `“${n.text}”` : n.kind === 'citation' ? '' : plainText([n]))).join('').trim() : '';
  const source = first ? ctx.citations[first.link] : undefined;
  return (
    <sup>
      <button
        type="button"
        data-testid="footnote-ref"
        // leading-normal: the base styles give <sup> line-height 0, which left the button a 0-px-high click target
        className={cn('text-primary hover:bg-primary/10 rounded px-0.5 text-[0.7em] leading-normal font-medium', first && ctx.selectedLink === first.link && 'bg-primary/15')}
        title={def ? `${label}${source ? ` — ${source.sourceName}` : ''}` : '没有找到这条脚注'}
        onClick={() => {
          if (first) ctx.onSelect(first.link);
        }}
      >
        [{id}]
      </button>
      {ctx.simulated.has(id) ? (
        <span data-testid="simulated-tag" className="text-amber-700 dark:text-amber-400 ml-0.5 text-[0.7em] font-normal">
          （模拟）
        </span>
      ) : null}
      {ctx.warned.has(id) ? <SourceWarningTag /> : null}
      {ctx.noted.has(id) ? <ReviewNoteTag title={ctx.noted.get(id)} /> : null}
      {numberFlag ? <NumberWarningTag /> : null}
      {inferenceFlag ? <InferenceWarningTag /> : null}
      {marks?.length ? <CitationWarningTag marks={marks} /> : null}
    </sup>
  );
}

/** D-48 round 3: a footnote the check still judged as hung on the wrong sentence (citation_flags); delivered anyway.
 *  D-56 ⑦: otherwise, the three-check result — ✓ 依据 when all three passed, 相关资料 when they did not. */
function CitationWarningTag({ marks }: { marks: FootnoteMark[] }): JSX.Element {
  const title = (ms: FootnoteMark[]) => [...new Set(ms.map((m) => m.title))].join('\n\n');
  const warn = marks.filter((m) => m.kind === undefined || m.kind === 'warn');
  if (!warn.length) {
    if (marks.some((m) => m.kind === 'ok')) {
      return (
        <span data-testid="verify-ok-tag" title={title(marks)} className="ml-0.5 text-[0.7em] font-normal whitespace-nowrap text-emerald-700 dark:text-emerald-400">
          ✓ 依据
        </span>
      );
    }
    return (
      <span data-testid="verify-unverified-tag" title={title(marks)} className="ml-0.5 text-[0.7em] font-normal text-muted-foreground">
        相关资料（没核实能不能撑住这句话）
      </span>
    );
  }
  return (
    <span data-testid="citation-warning-tag" title={title(warn)} className="ml-0.5 text-[0.7em] font-normal whitespace-nowrap text-amber-700 dark:text-amber-400">
      ⚠ 引文可能对不上
    </span>
  );
}

const HOVER_PREVIEW_LENGTH = 120;

function CitationChip({ node, ctx }: { node: CitationInline; ctx: RenderContext }): JSX.Element {
  const citation = ctx.citations[node.link];
  const failed = citation !== undefined && !citation.ok;
  const active = ctx.selectedLink === node.link;
  const grade = citation?.grade ?? null;

  const chip = (
    <button
      type="button"
      data-testid="citation-chip"
      data-link={node.link}
      aria-pressed={active}
      title={citation ? describeSource(citation) : '没有找到这条引用的详情'}
      onClick={() => ctx.onSelect(node.link)}
      className={cn(
        'mx-0.5 inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 align-middle text-[11px] leading-none transition-colors',
        'focus-visible:ring-ring/50 focus-visible:ring-2 focus-visible:outline-none',
        failed
          ? 'border-destructive/40 bg-destructive/10 text-destructive hover:bg-destructive/20'
          : 'border-border bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground',
        active && 'border-ring bg-accent text-accent-foreground ring-ring/60 ring-2',
      )}
    >
      {failed ? <AlertTriangle className="size-3" aria-hidden /> : null}
      <span className="font-mono">^{node.block}</span>
      {grade ? (
        <Badge
          variant={failed ? 'destructive' : GRADE_VARIANT[grade]}
          className="h-4 rounded-full px-1 text-[10px] leading-none"
        >
          {grade}
        </Badge>
      ) : null}
    </button>
  );

  // 找不到详情：不弹预览卡片，点击行为照旧（右侧栏显示「没有找到」）。
  if (citation === undefined) return chip;

  const blockText = citation.blockText;
  const preview =
    blockText === null
      ? null
      : blockText.length > HOVER_PREVIEW_LENGTH
        ? `${blockText.slice(0, HOVER_PREVIEW_LENGTH)}…`
        : blockText;

  return (
    <InlineCitationCard>
      <HoverCardTrigger asChild>{chip}</HoverCardTrigger>
      <InlineCitationCardBody>
        <div className="flex flex-col gap-2 p-3">
          <p className="text-xs leading-5 font-semibold break-words">{citation.sourceName}</p>
          <p className="text-muted-foreground text-[11px] leading-4">
            {describeSource(citation)}
          </p>
          {citation.publisher !== null ? (
            <p className="text-muted-foreground text-[11px] leading-4">
              发布方：{citation.publisher}
            </p>
          ) : null}
          {preview !== null ? (
            <blockquote className="border-primary/40 text-muted-foreground border-l-2 pl-2 text-[11px] leading-5 whitespace-pre-wrap">
              {preview}
            </blockquote>
          ) : (
            <p className="text-muted-foreground text-[11px] leading-4">资料里没有可显示的原文</p>
          )}
          <p className="text-muted-foreground text-[10px] leading-4">点击在右侧查看全文</p>
        </div>
      </InlineCitationCardBody>
    </InlineCitationCard>
  );
}

/** "⚠ 超过 N 字" after the entry whose text holds a flagged sentence (a condition line, drawn in two runs). */
function lengthTag(inline: Inline[], ctx: RenderContext): ReactNode {
  if (!ctx.lengths?.length) return null;
  const flag = lengthFlagIn(inlineText(inline), ctx.lengths);
  return flag ? <LengthWarningTag limit={flag.limit} length={flag.length} /> : null;
}

/**
 * A run of inline nodes. Marks go where their sentence is (lib/report/sentence-place.ts): "⚠ 引文可能对不上" beside a
 * footnote of citation_flags in that sentence only; with `lengths`, "⚠ 超过 N 字" right after each over-long sentence
 * (after the footnotes that follow it), so a cell of four items gets four.
 */
function renderInlineNodes(inline: Inline[], ctx: RenderContext, keyPrefix: string, o: { lengths?: boolean } = {}): ReactNode[] {
  const hidden = ctx.hideEmptyClauses ? emptyClauseFootnotes(inline) : new Set<number>();
  const ends = o.lengths ? (ctx.endMarks ?? []) : [];
  if (!ctx.marks?.length && !ends.length) return inline.map((_, index) => (hidden.has(index) ? null : renderInlineNode(inline, index, ctx, `${keyPrefix}:${index}`)));
  const parts: Part[] = inline.map((n) => (n.kind === 'footnote' ? { footnote: n.id } : { text: n.kind === 'link' ? n.label : n.kind === 'citation' ? '' : n.text }));
  const cited = footnoteFlags(parts, ctx.marks ?? [], ctx.refOf);
  type End = { offset: number; flag: (typeof ends)[number] };
  const inside = new Map<number, End[]>();
  const after = new Map<number, End['flag'][]>();
  for (const e of sentenceEnds(parts, ends.map((m) => ({ sentence: m.sentence, flag: m })))) {
    const node = inline[e.part];
    if (node?.kind === 'text' && e.offset < node.text.length) inside.set(e.part, [...(inside.get(e.part) ?? []), e]);
    else {
      let k = e.part;
      while (inline[k + 1]?.kind === 'footnote') k++;
      after.set(k, [...(after.get(k) ?? []), e.flag]);
    }
  }
  return inline.flatMap((node, index) => {
    if (hidden.has(index)) return null;
    const key = `${keyPrefix}:${index}`;
    const cuts = (inside.get(index) ?? []).sort((a, b) => a.offset - b.offset);
    const drawn =
      node.kind === 'text' && cuts.length
        ? cuts.flatMap((c, i) => [...linkedText(node.text.slice(i ? cuts[i - 1].offset : 0, c.offset), `${key}:t${i}`), c.flag.render(`${key}:l${i}`)]).concat(linkedText(node.text.slice(cuts[cuts.length - 1].offset), `${key}:t`))
        : [renderInlineNode(inline, index, ctx, key, cited.get(index))];
    return [...drawn, ...(after.get(index) ?? []).map((f, i) => f.render(`${key}:a${i}`))];
  });
}

/**
 * A text with code's marks drawn (D-48 round 5): "（见 Q2-1 ②，待验证）" links to that ①②③ line of the card; a
 * sub-question tag "[Q3-1]" (M3, which answer a Summary clause comes from) in faint small type. The file keeps both.
 */
function linkedText(text: string, key: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(new RegExp(`${CONDITION_LINK.source}|\\s*\\[(Q\\d+(?:-\\d+)*)\\]`, 'g'))) {
    const at = m.index ?? 0;
    if (at > last) out.push(<Fragment key={`${key}:${last}`}>{text.slice(last, at)}</Fragment>);
    if (m[1])
      out.push(
        <Fragment key={`${key}:${at}`}>
          （
          <a data-testid="condition-link" href={`#${conditionAnchor(m[1], m[2])}`} className="underline decoration-dotted underline-offset-2 hover:text-primary">
            见 {m[1]} {m[2]}
          </a>
          {m[3] ?? ''}）
        </Fragment>,
      );
    else
      out.push(
        <span key={`${key}:${at}`} data-testid="question-tag" className="text-muted-foreground/60 ml-0.5 text-[0.7em]">
          （{m[4]}）
        </span>,
      );
    last = at + m[0].length;
  }
  if (last < text.length) out.push(<Fragment key={`${key}:${last}`}>{text.slice(last)}</Fragment>);
  return out;
}

/** "⚠ …" right after a sentence, what it means on hover (summary_flags, a number with no evidence footnote). */
function SentenceWarningTag({ label, title, testId }: { label: string; title: string; testId: string }): JSX.Element {
  return (
    <span data-testid={testId} title={title} className="ml-1 text-[0.75em] font-normal whitespace-nowrap text-amber-700 dark:text-amber-400">
      {label}
    </span>
  );
}

function renderInlineNode(inline: Inline[], index: number, ctx: RenderContext, key: string, marks?: FootnoteMark[]): ReactNode {
  const node = inline[index];
  switch (node.kind) {
    case 'text':
      return <Fragment key={key}>{linkedText(node.text, key)}</Fragment>;
    case 'bold':
      return (
        <strong key={key} className="font-semibold text-foreground">
          {node.text}
        </strong>
      );
    case 'code':
      return (
        <code
          key={key}
          className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em] text-foreground"
        >
          {node.text}
        </code>
      );
    case 'quote':
      // only a passage from a source (a footnote or block link right after it) is set off; other quoted words are plain
      if (!isSourceQuote(inline, index)) return <Fragment key={key}>“{node.text}”</Fragment>;
      return (
        <span
          key={key}
          className="border-primary/40 text-muted-foreground border-l-2 pl-1.5 italic"
        >
          {node.text}
        </span>
      );
    case 'link':
      return (
        <span
          key={key}
          className="border-border bg-muted/50 text-muted-foreground mx-0.5 inline-flex items-center gap-1 rounded border px-1.5 align-middle text-xs"
        >
          <FileText className="size-3" aria-hidden />
          {node.label}
        </span>
      );
    case 'citation':
      return <CitationChip key={key} node={node} ctx={ctx} />;
    case 'footnote':
      return <FootnoteRef key={key} id={node.id} ctx={ctx} numberFlag={node.numberFlag} inferenceFlag={node.inferenceFlag} marks={marks} />;
  }
}

/** The question tree as a tree: the core question, `## Qx` under it, `### Qx-y` under those; each node links to its section. */
function QuestionTree({ nodes }: { nodes: TreeNode[] }): JSX.Element {
  const branch = (list: TreeNode[], depth: number): JSX.Element => (
    <ul className={cn('flex flex-col gap-1', depth > 0 ? 'border-muted-foreground/40 mt-1 ml-1.5 border-l pl-4' : 'mt-1 pl-0')}>
      {list.map((node) => (
        <li key={node.id} className={cn('relative text-sm leading-6', depth > 0 && 'before:border-muted-foreground/40 before:absolute before:top-3 before:-left-4 before:w-3 before:border-t before:content-[""]')}>
          <a href={`#${questionAnchor(node.id)}`} className="hover:underline underline-offset-2">
            <span className="text-foreground font-mono text-xs font-semibold">{node.id}</span> <span className="text-foreground/90">{node.text}</span>
          </a>
          {node.children.length ? branch(node.children, depth + 1) : null}
        </li>
      ))}
    </ul>
  );
  return (
    <div data-testid="question-tree" className="bg-background/60 border-border mt-2 rounded-md border px-3 py-2 list-none">
      <p className="text-muted-foreground text-xs font-medium">核心问题</p>
      {branch(nodes, 1)}
    </div>
  );
}

const CONDITION_CLASS: Record<ConditionStatus, string> = {
  成立: 'bg-emerald-500/15 text-emerald-800 dark:text-emerald-300',
  不成立: 'bg-red-500/15 text-red-800 dark:text-red-300',
  证据不足: 'bg-amber-500/15 text-amber-800 dark:text-amber-300',
};

/** One condition of the plan's hypothesis with what the check found: `① condition  [成立]`. */
function ConditionItem({ line, ctx, keyPrefix }: { line: ConditionLine; ctx: RenderContext; keyPrefix: string }): JSX.Element {
  return (
    <li data-testid="hypothesis-condition" data-status={line.status} id={ctx.hypothesis ? conditionAnchor(ctx.hypothesis.replace(/^H/, 'Q'), line.mark) : undefined} className="list-none -ml-4 flex scroll-mt-20 gap-1.5">
      <span className="text-muted-foreground shrink-0 font-medium">{line.mark}</span>
      <span>
        {renderInlineNodes(line.before, ctx, `${keyPrefix}:b`)}{' '}
        <span data-testid="condition-status" className={cn('mx-0.5 rounded px-1.5 py-0.5 text-xs font-semibold whitespace-nowrap', CONDITION_CLASS[line.status])}>
          {line.status}
        </span>
        {renderInlineNodes(line.after, ctx, `${keyPrefix}:a`)}
        {lengthTag([...line.before, ...line.after], ctx)}
      </span>
    </li>
  );
}

/** The third layer of a hypothesis card, closed until opened: evidence, counter-evidence and challenges, gaps. */
function EvidenceFold({ fold, children }: { fold: Fold; children: ReactNode }): JSX.Element {
  return (
    <details data-testid="evidence-fold" className="border-border group rounded-md border">
      <summary className="hover:bg-muted/50 flex cursor-pointer list-none items-center gap-1.5 rounded-md px-3 py-2 text-sm font-medium [&::-webkit-details-marker]:hidden">
        <ChevronRightIcon className="text-muted-foreground size-4 shrink-0 transition-transform group-open:rotate-90" aria-hidden />
        {foldTitle(fold.counts)}
      </summary>
      <div className="border-border flex flex-col gap-3 border-t px-3 py-3">{children}</div>
    </details>
  );
}

function renderList(
  items: ListItem[],
  ctx: RenderContext,
  keyPrefix: string,
  depth: number,
): JSX.Element {
  return (
    <ul
      key={keyPrefix}
      className={cn(
        'text-foreground/90 flex list-disc flex-col gap-1 pl-5 text-sm leading-6',
        depth > 0 && 'mt-1 gap-0.5 pl-4',
      )}
    >
      {items.map((item, index) => {
        const key = `${keyPrefix}:${index}`;
        const condition = depth > 0 ? conditionLine(item.inline) : null;
        // the Summary's 问题树 line: the tree is drawn under it, so only its split basis stays as text
        const drawnTree = depth === 0 && !!ctx.tree?.length && /^问题树[：:]/.test(inlineText(item.inline).trim());
        if (condition) return <ConditionItem key={key} line={condition} ctx={ctx} keyPrefix={key} />;
        return (
          <li key={key} className="marker:text-muted-foreground">
            {renderInlineNodes(drawnTree ? splitBasisOf(item.inline) : item.inline, ctx, key, { lengths: true })}
            {drawnTree && ctx.tree ? <QuestionTree nodes={ctx.tree} /> : null}
            {item.children.length > 0 ? renderList(item.children, ctx, key, depth + 1) : null}
          </li>
        );
      })}
    </ul>
  );
}

const ALIGN_CLASS = { left: 'text-left', center: 'text-center', right: 'text-right' } as const;

function renderBlock(block: Block, index: number, ctx: RenderContext): ReactNode {
  const key = `block-${index}`;
  switch (block.kind) {
    case 'heading': {
      const HeadingTag = `h${block.level}` as 'h1' | 'h2' | 'h3' | 'h4';
      const questionId = ctx.tree ? questionIdOf(block) : null;
      return (
        <HeadingTag key={key} id={questionId ? questionAnchor(questionId) : undefined} className={cn('text-foreground scroll-mt-4', HEADING_CLASS[block.level])}>
          {renderInlineNodes(block.inline, ctx, key)}
        </HeadingTag>
      );
    }
    case 'paragraph':
      return (
        <p key={key} className="text-foreground/90 text-sm leading-7">
          {renderInlineNodes(block.inline, ctx, key, { lengths: true })}
        </p>
      );
    case 'list':
      return renderList(block.items, ctx.hypothesisAt ? { ...ctx, hypothesis: ctx.hypothesisAt.get(index) } : ctx, key, 0);
    case 'footnote':
      return (
        <p key={key} id={`fn-${block.id}`} className="text-muted-foreground text-xs leading-6" data-testid="footnote-def">
          <span className="text-foreground mr-1 font-medium">[{block.id}]</span>
          {renderInlineNodes(block.inline, ctx, key)}
        </p>
      );
    case 'blockquote':
      return (
        <blockquote key={key} className="border-border text-muted-foreground border-l-2 pl-3 text-sm leading-7">
          {renderInlineNodes(block.inline, ctx, key)}
        </blockquote>
      );
    case 'table':
      return (
        <div key={key} className="border-border overflow-x-auto rounded-md border" data-testid="report-table">
          <table className="w-full border-collapse text-left text-xs leading-5">
            <thead className="bg-muted/60">
              <tr>
                {block.header.map((cell, c) => (
                  <th key={`${key}:h${c}`} scope="col" className={cn('border-border border-b whitespace-pre-line px-2.5 py-1.5 align-bottom font-medium', ALIGN_CLASS[block.align[c] ?? 'left'])}>
                    {renderInlineNodes(cell, ctx, `${key}:h${c}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, r) => (
                <tr key={`${key}:r${r}`} className="border-border border-b last:border-b-0">
                  {row.map((cell, c) => (
                    <td key={`${key}:r${r}c${c}`} className={cn('whitespace-pre-line px-2.5 py-1.5 align-top', ALIGN_CLASS[block.align[c] ?? 'left'])}>
                      {renderInlineNodes(cell, ctx, `${key}:r${r}c${c}`, { lengths: true })}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
  }
}

function findSummaryRange(blocks: Block[]): { start: number; end: number } | null {
  let start = -1;
  let startLevel = 2;

  for (let i = 0; i < blocks.length; i += 1) {
    const block = blocks[i];
    if (block === undefined || block.kind !== 'heading') continue;
    if (block.level > 2) continue;
    if (plainText(block.inline).trim().toLowerCase() === 'summary') {
      start = i;
      startLevel = block.level;
      break;
    }
  }

  if (start === -1) return null;

  let end = blocks.length;
  for (let i = start + 1; i < blocks.length; i += 1) {
    const block = blocks[i];
    if (block !== undefined && block.kind === 'heading' && block.level <= startLevel) {
      end = i;
      break;
    }
  }

  return { start, end };
}

/** D-64 T39 (ui-4a): 为什么（三条支撑）— at most three reasons, each basis with its kind (事实 / 推断 / 访谈支持). */
const BASIS = /^\s*(事实|推断|访谈支持)[：:]\s*/;
function ReasonList({ items, ctx, keyPrefix }: { items: ListItem[]; ctx: RenderContext; keyPrefix: string }): JSX.Element {
  return (
    <ol className="flex flex-col gap-2">
      {items.slice(0, 3).map((item, i) => (
        <li key={`${keyPrefix}:${i}`} data-testid="report-reason" className="flex flex-col gap-1 rounded-md border px-3 py-2">
          <p className="text-sm font-medium">
            {i + 1}. {renderInlineNodes(item.inline, ctx, `${keyPrefix}:${i}:t`)}
          </p>
          {item.children.map((c, j) => {
            const first = c.inline[0];
            const kind = first?.kind === 'text' ? BASIS.exec(first.text)?.[1] : undefined;
            const inline = kind && first?.kind === 'text' ? [{ ...first, text: first.text.replace(BASIS, '') }, ...c.inline.slice(1)] : c.inline;
            return (
              <p key={j} className="text-foreground/90 text-sm leading-6">
                {kind ? (
                  <span data-testid="basis-tag" data-kind={kind} className={cn('mr-1.5 rounded px-1.5 py-0.5 text-xs', kind === '事实' ? 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300' : kind === '访谈支持' ? 'bg-amber-50 text-amber-800 dark:bg-amber-950 dark:text-amber-300' : 'bg-muted text-muted-foreground')}>
                    {kind}
                  </span>
                ) : null}
                {renderInlineNodes(inline, ctx, `${keyPrefix}:${i}:${j}`)}
              </p>
            );
          })}
        </li>
      ))}
    </ol>
  );
}

interface CitationSidebarProps {
  selectedLink: string | null;
  citations: Record<string, CitationDetail>;
  /** D-64 T39: the three checks of the footnotes, by block link. */
  verifyByRef?: Map<string, VerifyItem>;
  onClose: () => void;
}

function CitationSidebar({ selectedLink, citations, verifyByRef, onClose }: CitationSidebarProps): JSX.Element {
  if (selectedLink === null) {
    return (
      <div className="border-border flex min-h-40 flex-col items-center justify-center gap-2 rounded-md border border-dashed px-4 py-8 text-center">
        <Quote className="text-muted-foreground size-5" aria-hidden />
        <p className="text-muted-foreground text-sm">点击报告里的引用，在这里查看资料原文</p>
      </div>
    );
  }

  const citation = citations[selectedLink];
  const verify = verifyByRef?.get(selectedLink);

  if (citation === undefined) {
    return (
      <div className="border-border rounded-md border border-dashed px-3 py-4">
        <p className="text-muted-foreground text-sm">没有找到这条引用的详情</p>
        <p className="text-muted-foreground mt-1 font-mono text-xs break-all">{selectedLink}</p>
      </div>
    );
  }

  return <CitationPopover citation={citation} verify={verify} onClose={onClose} />;
}

/** "「…」— 位置：The key takeaways 第 1 条" → "The key takeaways 第 1 条". */
const locationOf = (blockText: string | null) => /—\s*位置[：:]\s*(.+)$/m.exec(blockText ?? '')?.[1]?.trim() ?? null;

/**
 * D-64 T39 (ui-4b): one citation opened — the sentence of the report it holds, the original in its context, the three
 * checks (names and numbers, the first model, the independent second model), what it can and cannot support.
 */
export function CitationPopover({ citation, verify, onClose }: { citation: CitationDetail; verify?: VerifyItem; onClose: () => void }): JSX.Element {
  const quoteRange = citation.quote !== null && citation.blockText !== null ? findQuoteRange(citation.blockText, citation.quote) : null;
  const location = locationOf(citation.blockText);
  return (
    <div data-testid="cite-popover" className="flex flex-col gap-3">
      <div className="flex items-start gap-2">
        <div className="flex min-w-0 flex-col gap-1">
          <h3 className="text-sm leading-5 font-semibold break-words">{citation.sourceName}</h3>
          <p className="text-muted-foreground text-xs">
            {describeSource(citation)}
            {citation.published ? ` · ${citation.published}` : ''}
            {location ? ` · ${location}` : ''}
          </p>
        </div>
        <Button type="button" variant="ghost" size="sm" className="ml-auto" onClick={onClose}>
          关闭
        </Button>
      </div>
      <div className="flex flex-col gap-1">
        <p className="text-muted-foreground text-xs font-medium">报告引用的这一句</p>
        <p className="text-sm">{verify?.sentence || '—'}</p>
      </div>
      <Separator />
      <div className="flex flex-col gap-1.5">
        <p className="text-muted-foreground text-xs font-medium">原文上下文</p>
        {citation.blockText !== null ? (
          <blockquote className="border-l-primary/40 bg-muted/50 text-foreground rounded-md border-l-2 px-3 py-2 text-sm leading-6 whitespace-pre-wrap">
            {renderHighlighted(citation.blockText, quoteRange)}
          </blockquote>
        ) : (
          <p className="border-border text-muted-foreground rounded-md border border-dashed px-3 py-2 text-sm">资料里没有可显示的原文</p>
        )}
      </div>
      <div className="flex flex-col gap-1" data-testid="cite-checks">
        <p className="text-muted-foreground text-xs font-medium">三道核验</p>
        {verify ? (
          <ul className="space-y-0.5 text-xs">
            <li>① 名称和数字：{verify.entityMissing.length ? `原文里没有 ${verify.entityMissing.join('、')}` : '对得上'}</li>
            <li>② 第一个模型：{verify.deepseek}</li>
            <li>③ 独立复核：{verify.kimi}</li>
          </ul>
        ) : (
          <p className="text-muted-foreground text-xs">这条引用没有核验记录</p>
        )}
      </div>
      <dl className="grid grid-cols-[4.5rem_1fr] gap-x-2 gap-y-1 text-xs">
        <dt className="text-muted-foreground">能支持</dt>
        <dd data-testid="cite-can">{verify?.can || '—'}</dd>
        <dt className="text-muted-foreground">不能支持</dt>
        <dd data-testid="cite-cannot">{verify?.cannot || '—'}</dd>
      </dl>
      {citation.url !== null ? (
        <a href={citation.url} target="_blank" rel="noreferrer" className="text-primary inline-flex items-center gap-1 text-sm underline-offset-4 hover:underline">
          打开原网页
          <ExternalLink className="size-3 shrink-0" aria-hidden />
        </a>
      ) : null}
      {!citation.ok ? (
        <div className="border-destructive/40 bg-destructive/5 text-destructive flex items-start gap-1.5 rounded-md border px-3 py-2 text-xs">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          <span>{citation.error ? ERROR_TEXT[citation.error] : '引用未通过校验'}</span>
        </div>
      ) : null}
    </div>
  );
}

/** D-64 T39: the next step after the report (step 4 of the flow): the interview advice (T40 makes it its own step). */
function NextInterviewStep({ onClick }: { onClick?: () => void }): JSX.Element {
  return (
    <button type="button" data-testid="next-interview" disabled={!onClick} onClick={onClick} className="text-primary self-start text-sm font-medium underline-offset-4 hover:underline disabled:text-muted-foreground disabled:no-underline">
      下一步：看访谈建议 →
    </button>
  );
}

function CitedSourcesList({
  sources,
}: {
  sources: ReturnType<typeof uniqueCitedSources>;
}): JSX.Element {
  return (
    <div data-testid="report-sources" className="mt-6">
      <SourcesPanel defaultOpen className="text-foreground mb-0 text-xs">
        <SourcesTrigger
          count={sources.length}
          className="text-muted-foreground hover:text-foreground text-sm font-medium transition-colors"
        >
          <BookIcon className="size-4" aria-hidden />
          <span>引用的资料</span>
          <Badge variant="secondary" className="h-4 rounded-full px-1.5 text-[10px] leading-none">
            {sources.length}
          </Badge>
          <ChevronDownIcon className="size-4" aria-hidden />
        </SourcesTrigger>
        <SourcesContent className="w-full">
          <ul className="flex w-full flex-col gap-1.5">
            {sources.map((source) => {
              const label = (
                <>
                  <FileText className="text-muted-foreground mt-0.5 size-3.5 shrink-0" aria-hidden />
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span className="flex flex-wrap items-center gap-1.5">
                      <span className="text-foreground text-xs font-medium break-words">
                        {source.sourceName}
                      </span>
                      {source.grade !== null ? (
                        <Badge
                          variant={GRADE_VARIANT[source.grade]}
                          className="h-4 rounded-full px-1 text-[10px] leading-none"
                        >
                          {source.grade}
                        </Badge>
                      ) : null}
                    </span>
                    <span className="text-muted-foreground text-[11px] leading-4">
                      {describeSource(source)}
                    </span>
                    {source.publisher !== null ? (
                      <span className="text-muted-foreground text-[11px] leading-4">
                        发布方：{source.publisher}
                      </span>
                    ) : null}
                  </span>
                </>
              );

              return (
                <li key={source.sourceName} className="text-foreground/90">
                  {source.url !== null ? (
                    <Source
                      href={source.url}
                      className="hover:bg-muted/60 flex items-start gap-2 rounded-md px-1.5 py-1 transition-colors"
                    >
                      {label}
                    </Source>
                  ) : (
                    <span className="flex items-start gap-2 px-1.5 py-1">{label}</span>
                  )}
                </li>
              );
            })}
          </ul>
        </SourcesContent>
      </SourcesPanel>
    </div>
  );
}

export function ReportViewer({
  markdown,
  citations,
  versions,
  currentVersion,
  onSelectVersion,
  exploratory,
  delivery,
  failedChecks,
  humanEdits,
  sourceWarnings,
  reviewNotes,
  lengthFlags,
  citationFlags,
  entityFlags,
  citationVerify,
  summaryFlags,
  footer,
  onFollowUp,
  statusNote,
  scope,
  decisionTop,
  onNextStep,
}: ReportViewerProps): JSX.Element {
  const rawBlocks = useMemo(() => parseMarkdown(markdown), [markdown]);
  // Q-F: numbers not in the original their clause cites, against the stored blocks (display only: the file is unchanged)
  const quotes = useMemo(() => {
    const quotes = new Map<string, string>();
    for (const b of rawBlocks) {
      if (b.kind !== 'footnote') continue;
      const first = b.inline.find((n): n is CitationInline => n.kind === 'citation');
      const stored = first ? citations[first.link]?.blockText : null;
      const shown = b.inline.find((n) => n.kind === 'quote');
      quotes.set(b.id, stored ? blockQuote(stored) : shown && shown.kind === 'quote' ? shown.text : '');
    }
    return quotes;
  }, [rawBlocks, citations]);
  const numberFlags = useMemo(() => numberMismatches(markdown, quotes), [markdown, quotes]);
  // a 回应 whose footnote hangs after the author's inference (a heuristic: flagged, not blocking), found the same way
  const inferenceFlags = useMemo(() => responseProblems(markdown, quotes).filter((p) => p.kind === 'inference_cited'), [markdown, quotes]);
  // D-21-4 (f): the recommendation's numbers with no source, by the self-check's rule (flagged, not blocking)
  const uncitedNumbers = useMemo(() => checkReportText(markdown, []).filter((f) => f.code === 'uncited_number').map((f) => ({ text: f.clause ?? f.excerpt ?? '', numbers: f.numbers ?? [], inRecommendation: /^推荐判断里/.test(f.message) })), [markdown]);
  const blocks = useMemo(() => (numberFlags.length || inferenceFlags.length ? parseMarkdown(markInferenceFlags(markNumberFlags(markdown, numberFlags), inferenceFlags)) : rawBlocks), [numberFlags, inferenceFlags, markdown, rawBlocks]);
  const summaryRange = useMemo(() => findSummaryRange(blocks), [blocks]);
  // question-tree reports only (older and flat ones show as they are): the tree and the folded third layer of each card
  const tree = useMemo(() => (isQuestionTree(blocks) ? questionTree(blocks) : null), [blocks]);
  const duplicateAnswers = useMemo(() => (tree ? duplicateAnswerBlocks(blocks) : new Set<number>()), [tree, blocks]);
  const folds = useMemo(() => new Map((tree ? findFolds(blocks) : []).map((f) => [f.start, f])), [tree, blocks]);
  const citedSources = useMemo(() => uniqueCitedSources(markdown, citations), [markdown, citations]);
  const [selectedLink, setSelectedLink] = useState<string | null>(null);
  const verifyByRef = useMemo(() => new Map((citationVerify ?? []).filter((v) => v.sentence.trim()).map((v) => [v.ref, v] as const)), [citationVerify]);

  const footnotes = useMemo(() => new Map(blocks.flatMap((b) => (b.kind === 'footnote' ? [[b.id, b.inline] as const] : []))), [blocks]);
  const simulated = useMemo(() => simulatedFootnotes(blocks, citations), [blocks, citations]);
  const ctx: RenderContext = {
    citations,
    selectedLink,
    onSelect: setSelectedLink,
    footnotes,
    simulated,
    warned: useMemo(() => warnedFootnotes(sourceWarnings), [sourceWarnings]),
    noted: useMemo(() => notedFootnotes(reviewNotes), [reviewNotes]),
    tree: tree ?? undefined,
    lengths: useMemo(() => (lengthFlags ?? []).map((flag) => ({ key: lengthKey(flag.text), flag })), [lengthFlags]),
    endMarks: useMemo(
      () => [
        ...(lengthFlags ?? []).map((f) => ({ sentence: f.text, render: (key: string) => <LengthWarningTag key={key} limit={f.limit} length={f.length} /> })),
        ...(summaryFlags ?? []).map((f) => ({ sentence: f.sentence, render: (key: string) => <SentenceWarningTag key={key} testId="summary-warning-tag" label={f.kind === 'untagged' ? '⚠ 没标出处' : '⚠ 和子问题的回答对不上'} title={summaryFlagTitle(f)} /> })),
        // D-48 round 5 A: a number in the recommendation no evidence footnote covers (recomputed on every display)
        ...numbersNeedingEvidence(markdown).map((f) => ({ sentence: f.sentence, render: (key: string) => <SentenceWarningTag key={key} testId="number-evidence-tag" label="⚠ 数字没挂证据" title={`这一句的 ${f.numbers.join('、')} 没有挂证据脚注（“见 Qx”只指向卡片，不算出处）`} /> })),
      ],
      [lengthFlags, summaryFlags, markdown],
    ),
    hypothesisAt: useMemo(() => {
      const at = new Map<number, string>();
      let current: string | undefined;
      blocks.forEach((b, i) => {
        if (b.kind === 'heading') current = /假设 (H\d+(?:-\d+)?)/.exec(plainText(b.inline))?.[1];
        else if (current) at.set(i, current);
      });
      return at;
    }, [blocks]),
    marks: useMemo(() => footnoteMarks(citationFlags, entityFlags, verifyMarks(citationVerify ?? [])), [citationFlags, entityFlags, citationVerify]),
    hideEmptyClauses: (citationVerify?.length ?? 0) > 0,
    refOf: useCallback((id: string) => footnotes.get(id)?.find((n): n is CitationInline => n.kind === 'citation')?.link ?? '', [footnotes]),
  };
  // review notes without footnotes go under the heading their `where` names (block index → notes)
  const notes = useMemo(() => {
    const headingAt = blocks.flatMap((b, i) => (b.kind === 'heading' ? [i] : []));
    const placed = placeReviewNotes(reviewNotes, headingAt.map((i) => plainText((blocks[i] as Extract<Block, { kind: 'heading' }>).inline)));
    return { top: placed.top, at: new Map([...placed.at].map(([h, ns]) => [headingAt[h], ns])) };
  }, [blocks, reviewNotes]);
  const elsewhere = [...notes.at.values()].flat().map((n) => n.where ?? '');
  const withNotes = (index: number, node: ReactNode): ReactNode[] => {
    const here = notes.at.get(index);
    return here ? [node, <ReviewNotes key={`review-notes-${index}`} notes={here} inSection />] : [node];
  };

  const hasVersions = versions !== undefined && versions.length > 0;
  const versionValue =
    currentVersion ?? (hasVersions ? versions[0]?.path : undefined);

  const renderBody = (): ReactNode[] => {
    const nodes: ReactNode[] = [];
    if (summaryRange === null) nodes.push(<SourceWarnings key="source-warnings" warnings={sourceWarnings} />, <ReviewNotes key="review-notes" notes={notes.top} elsewhere={elsewhere} />, <NumberWarnings key="number-warnings" mismatches={numberFlags} uncited={uncitedNumbers} />);
    let section = '';
    for (let index = 0; index < blocks.length; index += 1) {
      const block = blocks[index];
      if (block === undefined) continue;
      // D-64 T39 (ui-4a): the fixed structure's sections get their own look
      if (block.kind === 'heading' && block.level === 2) {
        const title = plainText(block.inline).trim();
        if (title === '附录：过程和证据' && section) nodes.push(<NextInterviewStep key="next-interview" onClick={onNextStep} />);
        section = title;
      } else if (section === 'So what') {
        nodes.push(<div key={`sowhat-${index}`} data-testid="report-sowhat" className="rounded-lg bg-muted/40 px-4 py-3">{renderBlock(block, index, ctx)}</div>);
        continue;
      } else if (section === '为什么（三条支撑）' && block.kind === 'list') {
        nodes.push(<ReasonList key={`reasons-${index}`} items={block.items} ctx={ctx} keyPrefix={`r${index}`} />);
        continue;
      } else if (section === '缺乏信息、需要另外验证的问题' && block.kind === 'table') {
        nodes.push(<div key={`gaps-${index}`} data-testid="gap-table">{renderBlock(block, index, ctx)}</div>);
        continue;
      }

      if (summaryRange !== null && index === summaryRange.start) {
        nodes.push(<SourceWarnings key="source-warnings" warnings={sourceWarnings} />);
        nodes.push(<ReviewNotes key="review-notes" notes={notes.top} elsewhere={elsewhere} />);
        nodes.push(<NumberWarnings key="number-warnings" mismatches={numberFlags} uncited={uncitedNumbers} />);
        nodes.push(
          <section
            key={`summary-${index}`}
            className="bg-muted/40 flex flex-col gap-3 rounded-lg px-4 py-3"
          >
            {blocks
              .slice(summaryRange.start, summaryRange.end)
              .flatMap((inner, offset) => withNotes(summaryRange.start + offset, renderBlock(inner, summaryRange.start + offset, ctx)))}
          </section>,
        );
        continue;
      }

      if (
        summaryRange !== null &&
        index > summaryRange.start &&
        index < summaryRange.end
      ) {
        continue;
      }

      if (duplicateAnswers.has(index)) continue;
      const fold = folds.get(index);
      if (fold && block.kind === 'list') {
        const head = block.items.slice(0, fold.fromItem);
        if (head.length) nodes.push(renderBlock({ kind: 'list', items: head }, index, ctx));
        nodes.push(
          <EvidenceFold key={`fold-${index}`} fold={fold}>
            {[renderBlock({ kind: 'list', items: block.items.slice(fold.fromItem) }, index, ctx), ...blocks.slice(index + 1, fold.end).map((inner, offset) => renderBlock(inner, index + 1 + offset, ctx))]}
          </EvidenceFold>,
        );
        index = fold.end - 1;
        continue;
      }

      nodes.push(...withNotes(index, renderBlock(block, index, ctx)));
    }
    return nodes;
  };

  return (
    <div className="flex w-full flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        {hasVersions ? (
          <Select
            value={versionValue}
            onValueChange={(value) => onSelectVersion?.(value)}
          >
            <SelectTrigger size="sm" aria-label="选择报告版本" className="min-w-40">
              <SelectValue placeholder="选择版本" />
            </SelectTrigger>
            <SelectContent>
              {versions.map((version) => (
                <SelectItem key={version.path} value={version.path}>
                  {version.label ? `${version.name} · ${version.label}` : version.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}

        {exploratory ? <Badge variant="secondary">探索性</Badge> : null}
        {delivery === '草稿' ? <Badge variant="destructive">草稿 · 自检未通过</Badge> : null}
        {delivery === '已交付' ? <Badge variant="outline">已交付 · 引用已自检</Badge> : null}
        {scope ? (
          <Badge variant="outline" data-testid="report-scope" className="h-auto whitespace-normal py-0.5">
            {MODE_NAME[scope.mode]}
            {scope.mode === 'small' ? ` · 只回答了 ${scope.hypotheses.length ? scope.hypotheses.join('、') : '第一个假设'}，其余本次没有查` : ' · 回答了全部假设'}
          </Badge>
        ) : null}
        <HumanEditsNote edits={humanEdits} />
        {decisionTop ? <span className="ml-auto">{decisionTop}</span> : null}
      </div>

      {statusNote ? (
        <div role="note" data-testid="version-status-note" className="rounded-lg border border-amber-500/50 bg-amber-500/10 px-4 py-3 text-sm font-medium text-amber-800 dark:text-amber-300">
          <AlertTriangle className="mr-1.5 inline size-4 align-[-3px]" aria-hidden />
          这一版是{statusNote}：不要把它当成确认过的最新结论。
        </div>
      ) : null}

      {delivery === '草稿' ? (
        <div
          role="alert"
          className="border-destructive/40 bg-destructive/5 rounded-lg border px-4 py-3"
        >
          <div className="text-destructive flex items-center gap-2 text-sm font-medium">
            <AlertTriangle className="size-4" aria-hidden />
            自检没有通过，报告不交
          </div>
          {failedChecks !== undefined && failedChecks.length > 0 ? (
            <ul className="text-destructive/90 mt-2 flex list-disc flex-col gap-1 pl-5 text-sm">
              {failedChecks.map((check, index) => (
                <li key={`${index}-${check}`}>{check}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      <div className="@container"><div className="flex flex-col gap-6 @3xl:flex-row @3xl:items-start">
        <div className="min-w-0 flex-1">
          <div className="flex flex-col gap-3">{renderBody()}</div>

          {citedSources.length > 0 ? <CitedSourcesList sources={citedSources} /> : null}

          <Separator className="my-6" />

          <div className="flex flex-wrap items-center gap-2">
            {NEXT_ACTIONS.map((action) => {
              const live = action === '追加调查' && onFollowUp !== undefined;
              return (
                <Button key={action} type="button" variant="outline" size="sm" disabled={!live} onClick={live ? onFollowUp : undefined} data-testid={live ? 'follow-up-open' : undefined}>
                  {action}
                </Button>
              );
            })}
            <span className="text-muted-foreground text-xs">{onFollowUp ? '追加调查可用；其余只展示入口' : '演示版本只展示入口'}</span>
          </div>

          {footer ? (
            // `footer` is an element made on the server (M3's decision panel). Placed as one of two siblings in a
            // fragment, React dev warns about a missing key for it; as the only child of its own wrapper it does not.
            <div className="border-border mt-6 border-t pt-6" data-testid="report-footer">
              {footer}
            </div>
          ) : null}
        </div>

        <aside className={cn('bg-background sticky bottom-0 z-10 order-last w-full @3xl:top-4 @3xl:bottom-auto @3xl:order-none @3xl:w-[360px] @3xl:shrink-0', !selectedLink && 'hidden @3xl:block')}>
          <div className="border-border bg-card rounded-lg border">
            <div className="border-border flex items-center gap-2 border-b px-3 py-2">
              <Quote className="text-muted-foreground size-4" aria-hidden />
              <span className="text-sm font-medium">引用详情</span>
            </div>
            {/* a plain scroller: ScrollArea's max height capped its root, not its viewport, so the details spilled over the report */}
            <div data-testid="cite-scroll" className="max-h-[min(40vh,18rem)] overflow-y-auto @3xl:max-h-[min(70vh,32rem)]">
              <div className="px-3 py-3">
                <CitationSidebar selectedLink={selectedLink} citations={citations} verifyByRef={verifyByRef} onClose={() => setSelectedLink(null)} />
              </div>
            </div>
          </div>
        </aside>
      </div>
      </div>
    </div>
  );
}
