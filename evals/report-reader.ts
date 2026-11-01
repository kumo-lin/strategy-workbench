/**
 * How the evals read a team report's text (the rule judges): its hypothesis sections and the facts the judges count.
 * Moved from the comparison code when that was removed (D-64 T31); only the evals use it.
 */

const plain = (s: string) => s.replace(/\*\*/g, '').replace(/　/g, ' ');
const hasCitation = (s: string) => /\[\[[^\]]+#\^[^\]]+\]\]/.test(s);

/**
 * D-20 reports cite through footnotes: `论断[^3]` in the body, `[^3]: “原文”（…）[[资料#^c1]]` at the end.
 * A line counts as cited when it carries a block link, or a marker whose footnote does.
 */
function footnoteCiting(body: string): Set<number> {
  const out = new Set<number>();
  for (const line of body.split('\n')) {
    const m = /^\[\^(\d+)\]:\s*(.*)$/.exec(line);
    if (m && hasCitation(m[2])) out.add(Number(m[1]));
  }
  return out;
}
const citedVia = (citing: Set<number>) => (s: string) => hasCitation(s) || [...s.matchAll(/\[\^(\d+)\](?!:)/g)].some((m) => citing.has(Number(m[1])));

/** Rows of the table right under a top-level bullet `- <label>…` (header and rule rows left out). */
function tableUnder(section: ClaimSection, label: RegExp): string[] {
  const lines = section.lines;
  const at = lines.findIndex((l) => {
    const m = /^[-*]\s+(.*)$/.exec(plain(l));
    return Boolean(m && label.test(m[1]));
  });
  if (at < 0) return [];
  const rows: string[] = [];
  for (let j = at + 1; j < lines.length; j++) {
    const l = lines[j].trim();
    if (!l) {
      if (rows.length) break;
      continue;
    }
    if (!l.startsWith('|')) break;
    rows.push(l);
  }
  return rows.slice(2); // header + rule
}


interface ClaimSection {
  title: string;
  lines: string[];
}

/** A hypothesis heading of a question-tree report (D-39): "### 假设 H1：…" under "## Q1 …", "#### 假设 H2-1：…" under "### Q2-1 …". */
const TREE_HYPOTHESIS = /^#{3,4} 假设 (H\d+(?:-\d+)?)[：:]/;
/** A top-level sub-question of a question-tree report: "## Q2 …" (not "## Q2-1"). */
const TREE_ROOT = /^## (Q\d+) /;

export const isTreeReport = (body: string): boolean => body.split('\n').some((l) => TREE_HYPOTHESIS.test(l)) && /^## Q\d+ /m.test(body);

/**
 * The hypothesis sections of a team report: the `### ` sections under `## 逐个假设` (the older format), or in a
 * question-tree report each "### / #### 假设 Hn：" section, at whatever depth, up to the next heading.
 */
export function claimSections(body: string): ClaimSection[] {
  if (isTreeReport(body)) {
    const out: ClaimSection[] = [];
    let cur: ClaimSection | null = null;
    for (const raw of body.split('\n')) {
      if (/^#{1,6}\s/.test(raw)) {
        cur = TREE_HYPOTHESIS.test(raw) ? { title: raw.replace(/^#{3,4}\s+/, '').trim(), lines: [] } : null;
        if (cur) out.push(cur);
      } else if (cur) cur.lines.push(raw);
    }
    return out;
  }
  const lines = body.split('\n');
  const out: ClaimSection[] = [];
  let inClaims = false;
  let cur: ClaimSection | null = null;
  for (const raw of lines) {
    if (/^##\s/.test(raw)) {
      inClaims = /逐个假设/.test(raw);
      cur = null;
      continue;
    }
    if (!inClaims) continue;
    if (/^###\s/.test(raw)) {
      cur = { title: raw.replace(/^###\s+/, '').trim(), lines: [] };
      out.push(cur);
    } else if (cur) cur.lines.push(raw);
  }
  return out;
}

/** Top-level bullet `- <label>…` of a claim section → its inline text and its indented child bullets. */
function bulletGroup(section: ClaimSection, label: RegExp): { inline: string; children: string[] } | null {
  const lines = section.lines;
  for (let i = 0; i < lines.length; i++) {
    const t = plain(lines[i]);
    const m = /^[-*]\s+(.*)$/.exec(t);
    if (!m || !label.test(m[1])) continue;
    const inline = m[1].replace(/^[^：:]*[：:]/, '').trim();
    const children: string[] = [];
    for (let j = i + 1; j < lines.length && /^\s+[-*]\s/.test(lines[j]); j++) children.push(plain(lines[j]).replace(/^\s*[-*]\s+/, '').trim());
    return { inline, children };
  }
  return null;
}

const NONE = /^[（(]?\s*无\s*[）)]?$/;

/** The top-level sub-questions of a question-tree report and their answers ("### Q2 的回答"; a small run's 本次没有查 counts as one). */
export function subQuestionAnswers(body: string): { qid: string; answer: string }[] {
  const lines = body.split('\n');
  const out: { qid: string; answer: string }[] = [];
  for (let i = 0; i < lines.length; i++) {
    const root = TREE_ROOT.exec(lines[i]);
    if (!root) continue;
    let answer = '';
    for (let j = i + 1; j < lines.length && !/^## /.test(lines[j]); j++) {
      if (lines[j].trim() !== `### ${root[1]} 的回答`) continue;
      const text: string[] = [];
      for (let k = j + 1; k < lines.length && !/^#{1,6}\s/.test(lines[k]); k++) text.push(lines[k]);
      answer = text.join(' ').trim();
      break;
    }
    out.push({ qid: root[1], answer });
  }
  return out;
}

const NOT_RUN = /本次没有查/;

export interface TeamReportFacts {
  /** 'question_tree' (D-39: ## Qx → 假设 Hn) or the older 逐个假设 skeleton. */
  format: 'question_tree' | 'legacy';
  /** Question tree: the top-level sub-questions, how many have an answer, and how many of those say 本次没有查 (small run). */
  subQuestions: number;
  subQuestionsAnswered: number;
  subQuestionsNotRun: number;
  claims: number;
  /** Counter-evidence bullets, and how many of them carry a vault citation. */
  counterBullets: number;
  counterCited: number;
  /** Claim sections that have a 反证 part at all. */
  claimsWithCounter: number;
  inferenceLines: number;
  claimsWithGaps: number;
  expertQuestions: number;
  modelKnowledgeLines: number;
  /** Refuting evidence added by 追加调查 blocks (`- 追加调查（vN）` → `反驳 · …`); already included in counterBullets / counterCited. */
  followUpRefutes: number;
  followUpRefutesCited: number;
  searches: number | null;
  fetches: number | null;
}

export function readTeamReport(body: string): TeamReportFacts {
  const sections = claimSections(body);
  const tree = isTreeReport(body);
  const answers = tree ? subQuestionAnswers(body) : [];
  const f: TeamReportFacts = {
    format: tree ? 'question_tree' : 'legacy',
    subQuestions: answers.length,
    subQuestionsAnswered: answers.filter((a) => a.answer).length,
    subQuestionsNotRun: answers.filter((a) => NOT_RUN.test(a.answer)).length,
    claims: sections.length, counterBullets: 0, counterCited: 0, claimsWithCounter: 0, inferenceLines: 0, claimsWithGaps: 0, expertQuestions: 0, modelKnowledgeLines: 0, followUpRefutes: 0, followUpRefutesCited: 0, searches: null, fetches: null };
  const cited = citedVia(footnoteCiting(body));
  for (const s of sections) {
    const counter = bulletGroup(s, /^反证/);
    // D-20: "反证和挑战（逐条回应）" is a table, one row per refute
    const rows = tableUnder(s, /^反证/);
    const items = rows.length ? rows : counter ? [counter.inline, ...counter.children].filter((x) => x && !NONE.test(x)) : [];
    // 追加调查 (D-18) blocks list their new evidence as nested `反驳 · “…”[[…]]` / `支持 · …` lines
    const added = s.lines.map(plain).filter((l) => /^\s+[-*]\s+反驳\s*·/.test(l));
    if (items.length || added.length) f.claimsWithCounter += 1;
    f.counterBullets += items.length + added.length;
    f.counterCited += items.filter(cited).length + added.filter(cited).length;
    f.followUpRefutes += added.length;
    f.followUpRefutesCited += added.filter(cited).length;
    for (const l of s.lines.map(plain)) {
      const q = /^\s+[-*]\s+仍要问专家：(.*)$/.exec(l);
      if (q) f.expertQuestions += q[1].split(/[；;]/).filter((x) => x.trim()).length;
    }
    // the question tree writes the inference as "理由" (D-39 用词对照表: 推导（推断） → 理由)
    if (bulletGroup(s, tree ? /^理由/ : /^推导/)) f.inferenceLines += 1;
    const gap = bulletGroup(s, /^缺口/);
    if (gap) {
      const items = [gap.inline, ...gap.children].filter((x) => x && !NONE.test(x));
      if (items.length) f.claimsWithGaps += 1;
      f.expertQuestions += items.filter((x) => /要问专家|[？?]/.test(x)).length;
    }
    const mk = bulletGroup(s, /^模型知识/);
    if (mk && mk.inline && !NONE.test(mk.inline)) f.modelKnowledgeLines += 1;
  }
  const how = /联网搜索\s*(\d+)\s*次[、，,]\s*抓取\s*(\d+)\s*次/.exec(plain(body));
  if (how) {
    f.searches = Number(how[1]);
    f.fetches = Number(how[2]);
  }
  return f;
}

