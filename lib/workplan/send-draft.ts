/**
 * The prefilled summary and focus of the "发给 Senior 征求意见" dialog (spec 5a-T7), read from a workplan body so the
 * owner does not have to type what to look at. Pure — safe to import from client components.
 */
import { sectionBody } from './workplan-tree';

export interface SendDraft {
  summary: string;
  focus: string[];
}

const QUESTION_SECTION = '要回答的问题与要支撑的决策';
const RISK_SECTION = '风险和待确认';
const DEFAULT_SUMMARY = '请看这份 workplan。';
const DEFAULT_FOCUS = ['假设能不能被证伪', '要回答的问题有没有说清'];
const MAX_SUMMARY = 600;
const MAX_FOCUS = 120;
/** A sentence end is only preferred when it falls this close to the limit; earlier ones would lose too much. */
const CUT_WINDOW = 120;

/** Remove the markdown the reviewer does not need: wiki links become their display text, `**` and backticks go. */
function cleanLine(line: string): string {
  return line
    .replace(/\[\[([^\[\]|]+)(?:\|([^\[\]]+))?\]\]/g, (_m: string, target: string, alias?: string) => (alias || target).trim())
    .replace(/\*\*/g, '')
    .replace(/`/g, '')
    .trim();
}

/** Clean every line, collapse runs of blank lines into one, and drop blank lines at both ends. */
function cleanLines(raw: string): string {
  const out: string[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const text = cleanLine(line);
    if (text) out.push(text);
    else if (out.length > 0 && out[out.length - 1] !== '') out.push('');
  }
  while (out.length > 0 && out[out.length - 1] === '') out.pop();
  return out.join('\n');
}

/** At most 600 characters: cut at the last 。 or newline within the last 120 when there is one, else hard cut. */
function cutSummary(text: string): string {
  if (text.length <= MAX_SUMMARY) return text;
  const head = text.slice(0, MAX_SUMMARY);
  for (let i = head.length - 1; i >= MAX_SUMMARY - CUT_WINDOW; i--) {
    if (head[i] === '。') return head.slice(0, i + 1);
    if (head[i] === '\n') return head.slice(0, i).trimEnd();
  }
  return head.trimEnd();
}

/** The first block of non-blank, non-heading lines. */
function firstParagraph(body: string): string {
  const lines: string[] = [];
  for (const line of body.split(/\r?\n/)) {
    if (!line.trim() || /^\s*#{1,6}\s/.test(line)) {
      if (lines.length > 0) break;
      continue;
    }
    lines.push(line);
  }
  return cleanLines(lines.join('\n'));
}

const BULLET = /^\s*(?:[-*]|\d+\.)\s+(.*)$/;

/** The first four bullet lines of a section, cleaned and cut to 120 characters. */
function focusItems(section: string): string[] {
  const out: string[] = [];
  for (const line of section.split(/\r?\n/)) {
    const m = BULLET.exec(line);
    if (!m) continue;
    const text = cleanLine(m[1]);
    if (text) out.push(text.slice(0, MAX_FOCUS));
    if (out.length === 4) break;
  }
  return out;
}

export function suggestSend(body: string): SendDraft {
  const question = sectionBody(body, QUESTION_SECTION);
  const risk = sectionBody(body, RISK_SECTION);
  const focus = risk === null ? [] : focusItems(risk);
  return {
    summary: cutSummary(cleanLines(question ?? firstParagraph(body))) || DEFAULT_SUMMARY,
    focus: focus.length > 0 ? focus : DEFAULT_FOCUS,
  };
}
