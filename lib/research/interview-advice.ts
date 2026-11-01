/**
 * D-64 T40 (ui-4c): the interview advice as its own step — what public material cannot show (the report's gap table),
 * whom to ask, what, and to verify what (the report's 访谈建议 table, each ask tied to its hypothesis), and the rule
 * agreed before the interviews (D63 §3.3). Read from the report as written; no model call. Pure.
 */
export interface InterviewAdviceRow {
  who: string;
  question: string;
  /** "H1 跨设备连续体验有持续增量" */
  verify: string;
}

export interface InterviewAdvice {
  gaps: { question: string; missing: string; how: string }[];
  rows: InterviewAdviceRow[];
  /** The same rows, one group per person, in the order the people first appear (ui-4c shows one 找谁 cell per group). */
  groups: InterviewAdviceGroup[];
  rule: string;
}

export interface InterviewAdviceGroup {
  who: string;
  rows: InterviewAdviceRow[];
}

/** One group per person, first-appearance order; a person's asks stay in their original order even when not adjacent. */
export function groupByWho(rows: InterviewAdviceRow[]): InterviewAdviceGroup[] {
  const groups: InterviewAdviceGroup[] = [];
  const at = new Map<string, InterviewAdviceGroup>();
  for (const row of rows) {
    const seen = at.get(row.who);
    if (seen) seen.rows.push(row);
    else {
      const group = { who: row.who, rows: [row] };
      at.set(row.who, group);
      groups.push(group);
    }
  }
  return groups;
}

/** Agreed before the interviews: what they can and cannot do to a judgment (code applies it, T25). */
export const INTERVIEW_RULE = '访谈最多把判断提到“访谈支持”，不能提到“成立”；模拟访谈照实标出；访谈只改它涉及的判断，没涉及的沿用原来的版本。';

const cells = (line: string) => line.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());

/** The rows of the first table under `## <heading>` (header and rule left out); `last`: under the last such heading. */
function tableUnder(body: string, heading: string, last = false): string[][] {
  const lines = body.split('\n');
  const at = last ? lines.findLastIndex((l) => l.trim() === `## ${heading}`) : lines.findIndex((l) => l.trim() === `## ${heading}`);
  if (at < 0) return [];
  const rows: string[] = [];
  for (let i = at + 1; i < lines.length && !/^## /.test(lines[i]); i++) if (/^\|/.test(lines[i].trim())) rows.push(lines[i]);
  return rows.slice(2).map(cells);
}

/** 「H1 跨设备有增量」: the label once, even when the statement already starts with it (复核 P8: 「H1 H1 …」). */
const verifyText = (label: string, statement: string | undefined) => (!statement ? label : statement.startsWith(label) ? statement : `${label} ${statement}`);

const clean = (s: string) => s.replace(/\[\^\d+[!~]*\]/g, '').replace(/（按视角推荐）$/, '').trim();

export function interviewAdviceOf(body: string, hypotheses: Record<string, string> = {}): InterviewAdvice {
  const rows = tableUnder(body, '访谈建议').map(([who = '', question = '', label = '']) => ({ who: clean(who), question: clean(question), verify: verifyText(label.trim(), hypotheses[label.trim()]) }));
  return {
    gaps: tableUnder(body, '缺乏信息、需要另外验证的问题').map(([question = '', missing = '', how = '']) => ({ question: clean(question), missing: clean(missing), how: clean(how) })),
    rows,
    groups: groupByWho(rows),
    rule: INTERVIEW_RULE,
  };
}

/** 导出访谈提纲: the outline as markdown, for the analyst to take to the interviews. */
export function interviewOutline(a: InterviewAdvice, title: string): string {
  return [
    `# ${title} 访谈提纲`,
    '',
    '## 公开资料证明不了的地方',
    ...(a.gaps.length ? a.gaps.map((g) => `- ${g.question}：${g.missing}（${g.how}）`) : ['- 无']),
    '',
    '## 找谁、问什么',
    ...a.rows.map((r, i) => `${i + 1}. 找${r.who}：${r.question}（为了验证 ${r.verify}）`),
    '',
    '## 验证规则（执行前约定）',
    a.rule,
    '',
  ].join('\n');
}

/** ui-4d: the "因为追加了访谈，结论变了什么" table of a version written by the interview follow-up (T25), or null. */
export function changeTableOf(body: string): string[][] | null {
  // 复核 P10: a version after a second round carries both rounds' tables; the newest is the one about this version
  const rows = tableUnder(body, '因为追加了访谈，结论变了什么', true);
  return rows.length ? rows : null;
}

/** The saved table's own word for a judgment the interviews did not touch. */
export const UNTOUCHED_AFTER = '不变（访谈没有涉及）';

export interface ExplanationChange { label: string; before: string; after: string }

/** 复核 #1: what the saved v2 body says changed, row by row. Read, never recomputed. */
export function explanationChangesOf(body: string): ExplanationChange[] {
  return (changeTableOf(body) ?? [])
    .filter((row) => /^K\d+$/.test((row[0] ?? '').trim()))
    .map(([label, before = '', after = '']) => ({ label: label.trim(), before: clean(before), after: clean(after) }));
}
