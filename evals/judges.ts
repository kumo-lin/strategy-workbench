/**
 * Rule judges for the evals (D-15). Pure functions over text — no model, no IO — so they are unit-tested
 * (tests/evals/judges.test.ts) and give the same verdict every time. The one place a model judges is
 * `NOW_WHAT_LLM_CRITERION` (case ①, only when the rule did not already pass); it is marked as such
 * everywhere it shows up.
 */
import { claimSections, readTeamReport } from './report-reader';
import type { CitationDetail } from '@/lib/research/citation-types';

export interface Check {
  name: string;
  /** `rule` = decided by code; `llm` = decided by a model against a written criterion. */
  kind: 'rule' | 'llm';
  pass: boolean;
  detail: string;
}

// ── ① comment → intent options must include "the missing part is the now what" ─────────────────

export const NOW_WHAT_RULE = /now\s*-?\s*what/i;

export function nowWhatRule(options: { id: string; label: string }[]): Check {
  const hit = options.find((o) => NOW_WHAT_RULE.test(o.label));
  return {
    name: '有一条理解字面写了 now what',
    kind: 'rule',
    pass: Boolean(hit),
    detail: hit ? `${hit.id}：${hit.label}` : `${options.length} 个选项里都没有 “now what” 字样`,
  };
}

/** Shown to the LLM judge verbatim, and printed in the results so a reader can check the call. */
export const NOW_WHAT_LLM_CRITERION = [
  '判定标准：下面是 AI 针对 Senior 的一条 comment（"我没看懂，所以这个调查结果的SoWhat是什么"）给出的几种意图理解。',
  '只要其中至少有一条的意思是：Senior 看不懂，是因为结论停在事实或 so what，没有落到"这对我们公司（联想）的战略部署 / 决策 / 下一步行动意味着什么"——也就是缺的是 now what（行动层面的含义）——就判 pass。',
  '以下都不算：只说表达不清、要更简洁、要换结构或排版、要补数据或证据、要把 so what 写得更明确但没有提到对公司决策或行动的含义。',
  '只看选项本身的意思，不看措辞是不是英文。',
].join('\n');

// ── ② the small run shows counter-evidence, or says the evidence is not enough ──────────────────

export function counterOrInsufficient(body: string): Check {
  const f = readTeamReport(body);
  const sections = claimSections(body);
  const insufficient = sections.some((s) => s.lines.some((l) => /证据不足/.test(l)));
  const verdictInsufficient = sections.some((s) => s.lines.some((l) => /提议的判断[^\n]*证据不足/.test(l)));
  const pass = f.counterCited > 0 || insufficient;
  return {
    name: '有带出处的反证，或者写了“证据不足”',
    kind: 'rule',
    pass,
    detail: `反证 ${f.counterBullets} 条（带资料引用 ${f.counterCited} 条）；${verdictInsufficient ? '提议的判断是“证据不足”' : insufficient ? '正文写了“证据不足”' : '没有写“证据不足”'}`,
  };
}

// ── ③ every citation matches its source; no number without a source ────────────────────────────

export function citationsAllOk(citations: CitationDetail[]): Check {
  const bad = citations.filter((c) => !c.ok);
  return {
    name: '每条引用都能在资料里找到那一句原文',
    kind: 'rule',
    pass: citations.length > 0 && bad.length === 0,
    detail: citations.length === 0 ? '报告里没有任何块引用' : bad.length ? `${bad.length}/${citations.length} 处没通过：${bad.slice(0, 3).map((c) => `${c.link}（${c.error}）`).join('；')}` : `${citations.length} 处全部通过`,
  };
}

/**
 * A "number" is a statistic a reader would take as a fact: a percentage, a decimal, or a number with a unit
 * of money / count / scale. Years ("2026 年"), ids (H2, C1-Q2, v3) and small counts of the report's own
 * structure ("3 层", "2 个子问题") are not statistics and are ignored.
 */
const STAT = /(\d+(?:[.,]\d+)*)\s*(%|％|个百分点|亿|万|千|百万|美元|美金|元|倍|台|家|人|名|位|TOPS|billion|million|percent)|(\d+\.\d+)/gi;

export interface NumberHit {
  token: string;
  core: string;
  sentence: string;
}

const norm = (s: string) => s.normalize('NFKC').replace(/,/g, '');

/** Statistics in the report's reasoning text: everything except the "怎么查的" record, headings, and lines marked as model knowledge. */
export function statisticsIn(body: string): NumberHit[] {
  const out: NumberHit[] = [];
  let skip = false;
  for (const raw of body.split('\n')) {
    if (/^##\s/.test(raw)) {
      skip = /怎么查的/.test(raw);
      continue;
    }
    if (skip || /^#/.test(raw) || /模型知识/.test(raw) || /^>/.test(raw)) continue;
    // Quotes inside “…”[[…#^c]] are copies of the cited block: their numbers are checked with the citation itself.
    const line = norm(raw.replace(/“[^”]*”(?:（[^）]*）)?\s*\[\[[^\]]+\]\]/g, ' '));
    for (const sentence of line.split(/(?<=[。；;！？!?])/)) {
      for (const m of sentence.matchAll(STAT)) {
        const core = m[1] ?? m[3];
        if (!core || /^(19|20)\d\d$/.test(core)) continue;
        // "2 家发布方", "3 位专家": counts of the report's own evidence, not statistics.
        if (m[2] && /^(家|人|名|位|台)$/.test(m[2]) && Number(core) < 10) continue;
        out.push({ token: m[0].trim(), core, sentence: sentence.trim().slice(0, 160) });
      }
    }
  }
  return out;
}

/** Every statistic must appear (as a number) in at least one block the report cites. */
export function noUnsourcedNumbers(body: string, citedBlockTexts: string[]): Check & { unsourced: NumberHit[] } {
  const hay = citedBlockTexts.map(norm);
  const has = (core: string) => {
    const re = new RegExp(`(^|[^\\d.])${core.replace('.', '\\.')}(?![\\d])`);
    return hay.some((t) => re.test(t));
  };
  const stats = statisticsIn(body);
  const unsourced = stats.filter((s) => !has(s.core));
  return {
    name: '正文里的数字都能在引用的资料里找到',
    kind: 'rule',
    pass: unsourced.length === 0,
    detail: stats.length === 0 ? '正文里没有统计数字（引文里的数字随引用一起核对）' : unsourced.length ? `${unsourced.length}/${stats.length} 个数字在引用的资料里找不到：${unsourced.slice(0, 4).map((u) => `「${u.token}」`).join('、')}` : `${stats.length} 个数字都能在引用的资料里找到`,
    unsourced,
  };
}

// ── ④′ (D-17): the report's own "这次调查的出发点" quotes the directive, and the quote checks out ─────

/** The directive as said in the meeting (^m1). */
export const DIRECTIVE_QUOTE = '重点看 IT 能不能管';
export const DIRECTIVE_BLOCK = /\[\[[^\]]*高层周会[^\]]*#\^m1\]\]/;

/** The bullet `- 这次调查的出发点…：` that lib/research/origin.ts writes, with its indented children. */
export function originSection(body: string): { present: boolean; lines: string[] } {
  const lines = body.split('\n');
  const i = lines.findIndex((l) => /^[-*]\s+\**这次调查的出发点/.test(l));
  if (i < 0) return { present: false, lines: [] };
  const out = [lines[i]];
  for (let j = i + 1; j < lines.length && /^\s+[-*]\s/.test(lines[j]); j++) out.push(lines[j]);
  return { present: !/计划没有关联到/.test(lines[i]), lines: out };
}

const squash = (s: string) => s.normalize('NFKC').replace(/\s+/g, '');

/**
 * Three checks, all rule-based (D-17, PRD v0.7 §11.1):
 *   (a) the report has the system-written "这次调查的出发点" part;
 *   (b) it quotes the meeting's ^m1 block, and the quote contains 「重点看 IT 能不能管」;
 *   (c) that citation passes check_citations: the block exists and the quote matches it word for word.
 */
export function directiveOrigin(body: string, citations: Record<string, CitationDetail>): Check[] {
  const sec = originSection(body);
  const line = sec.lines.find((l) => DIRECTIVE_BLOCK.test(l));
  const link = line ? DIRECTIVE_BLOCK.exec(line)![0] : null;
  const quote = line ? /“([^”]+)”/.exec(line)?.[1] ?? null : null;
  const quoted = Boolean(quote && squash(quote).includes(squash(DIRECTIVE_QUOTE)));
  const cite = link ? citations[link] : undefined;
  const verified = Boolean(cite?.ok && cite.quote);
  return [
    { name: '(a) 报告里有系统写的“这次调查的出发点”', kind: 'rule', pass: sec.present, detail: sec.present ? `有，${sec.lines.length - 1} 条` : sec.lines.length ? '有这一行，但写的是“计划没有关联到会议、决定或项目笔记”' : '没有这一节' },
    { name: '(b) 出发点引用了高层周会 ^m1 的原文「重点看 IT 能不能管」', kind: 'rule', pass: Boolean(link) && quoted, detail: !link ? '出发点里没有指向周会 ^m1 的引用' : quoted ? `引文：“${quote}”` : `指向了 ^m1，但引文里没有「${DIRECTIVE_QUOTE}」：“${quote ?? '（没有引文）'}”` },
    { name: '(c) 这段引用过 check_citations（块存在，引文逐字对上）', kind: 'rule', pass: verified, detail: !link ? '没有可核对的引用' : !cite ? '系统没有解析到这条引用' : cite.ok ? (cite.quote ? '通过' : '块存在，但引文没有被核对（引号和链接没连上）') : `没通过：${cite.error}` },
  ];
}

// ── ④ (D-17): record only — which knowledge-base notes the report's reasoning draws on ────────────

export type KbKind = '会议' | '决定' | '专家输入' | '方法库' | '高层逻辑' | '预置资料';

export interface KbUse {
  kind: KbKind;
  name: string;
  /** Where in the report: the code-written starting point, or the reasoning (everything else). */
  where: '出发点' | '正文';
}

/** Classify a resolved note for ④'s record. `origin` is the source note's `origin` (预置 / 网络). */
export function kbKindOf(path: string, type: string | undefined, origin?: unknown): KbKind | null {
  if (type === 'meeting') return '会议';
  if (type === 'decision') return '决定';
  if (path.startsWith('00_团队知识/专家输入/')) return '专家输入';
  if (path.startsWith('00_团队知识/方法库/')) return '方法库';
  if (path.startsWith('00_团队知识/高层逻辑/')) return '高层逻辑';
  if (type === 'source' && origin === '预置') return '预置资料';
  return null;
}

export function renderKbUses(uses: KbUse[]): string {
  if (!uses.length) return '报告里没有用到会议、决定、专家输入、方法库或预置资料';
  const order: KbKind[] = ['会议', '决定', '专家输入', '高层逻辑', '方法库', '预置资料'];
  return order
    .map((k) => {
      const xs = uses.filter((u) => u.kind === k);
      return xs.length ? `${k} ${xs.length} 条：${xs.map((u) => `${u.name}${u.where === '出发点' ? '（出发点）' : ''}`).join('、')}` : '';
    })
    .filter(Boolean)
    .join('；');
}
