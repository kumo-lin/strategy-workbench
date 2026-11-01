/**
 * D-48 round 4 (C): is the sentence about what its source is about? Deterministic, no model; it marks and never
 * changes the report (frontmatter `entity_flags`, the page puts ⚠ beside that footnote in that sentence).
 *
 * Where: Summary (its lines and its tables, 所以联想 and the recommendation table with them), and a card's 回答 and
 * 理由 (with 理由's sub-items). Each clause that ends in a footnote group (citedClauses, as number-check reads it).
 * What is taken from the clause:
 *   - proper names from a strict glossary, either form (微软 / Microsoft …): a name counts when any of its forms is in
 *     the source;
 *   - Latin-letter names (Intune, TruScale, Agent 365, vPro), generic terms and lower-case words left out (AI, PC, IT,
 *     NPU, SaaS …; agent, app);
 *   - numbers and percentages, read and compared as number-check does (numbersIn / numberInQuote); a 成 in the source
 *     counts for a percentage near it (两成 for 22%).
 * Compared with what the footnote's block says, plus its source's name and publisher. A footnote whose source holds
 * none of the clause's names and numbers is a flag: `{ key: its block link, footnote, sentence, missing }`.
 * A clause with nothing to take is not checked.
 */
import { parseWikiLink } from '@/lib/vault/links';
import type { Vault } from '@/lib/vault';
import { blockQuote, citedClauses, footnoteDefs, numberInQuote, numbersIn, numbersInQuote } from './number-check';
import { loadSourceInfo } from './sources';

export interface EntityFlag {
  /** The footnote's block link ("[[资料#^c1]]"): what the flag is bound to, across versions. */
  key: string;
  /** "[^9]" as this version numbers it. */
  footnote: string;
  /** The clause the footnote ends, as the report has it (footnotes taken out). */
  sentence: string;
  /** What the clause names that the source does not have (all of it: a flag means none was found). */
  missing: string[];
}

/** What the source of a footnote says: its block's text, its name and publisher. */
export interface FootnoteSource {
  ref: string;
  text: string;
  /** The block's original only, without its name and publisher (D-56: what the two models judge the clause against). */
  quote?: string;
}

/** Proper names, each with its forms. Strict on purpose: a name here is a claim about who. */
export const ENTITY_GLOSSARY: string[][] = [
  ['微软', 'Microsoft', 'MSFT'],
  ['联想', 'Lenovo'],
  ['惠普', 'HP', 'Hewlett-Packard', 'HP Inc'],
  ['戴尔', 'Dell'],
  ['英特尔', 'Intel'],
  ['超威', 'AMD'],
  ['高通', 'Qualcomm'],
  ['苹果', 'Apple'],
  ['谷歌', 'Google'],
  ['亚马逊', 'Amazon', 'AWS'],
  ['华为', 'Huawei'],
  ['小米', 'Xiaomi'],
  ['华硕', 'ASUS'],
  ['宏碁', 'Acer'],
  ['三星', 'Samsung'],
  ['金山办公', 'WPS', 'Kingsoft'],
  ['日立', 'Hitachi'],
  ['埃森哲', 'Accenture'],
  ['德勤', 'Deloitte'],
  ['麦肯锡', 'McKinsey'],
  ['波士顿咨询', 'BCG', 'Boston Consulting'],
  ['高德纳', 'Gartner'],
  ['国际数据公司', 'IDC'],
  ['弗雷斯特', 'Forrester'],
  ['卡纳利斯', 'Canalys'],
  ['群智咨询', 'Omdia'],
  ['英伟达', 'NVIDIA'],
  ['甲骨文', 'Oracle'],
  ['思爱普', 'SAP'],
  ['赛富时', 'Salesforce'],
  ['服务现在', 'ServiceNow'],
  ['阿里', '阿里巴巴', 'Alibaba', '阿里云'],
  ['腾讯', 'Tencent'],
  ['字节跳动', 'ByteDance'],
  ['百度', 'Baidu'],
];

/** Latin-letter words that name a kind of thing, not who or which product. */
const GENERIC = new Set(
  [
    'AI', 'PC', 'PCs', 'IT', 'OS', 'CPU', 'GPU', 'NPU', 'TOPS', 'CIO', 'CTO', 'CEO', 'CFO', 'CISO', 'SaaS', 'PaaS', 'IaaS', 'DaaS', 'API', 'SKU', 'ROI',
    'TCO', 'KPI', 'B2B', 'B2C', 'ERP', 'CRM', 'App', 'Apps', 'BIOS', 'SSO', 'MDM', 'UEM', 'VPN', 'LLM', 'GenAI', 'AIPC', 'OEM', 'ODM', 'IDG', 'ISG', 'SSG',
    'PCSD', 'MBG', 'Q1', 'Q2', 'Q3', 'Q4', 'FY', 'YoY', 'vs', 'and', 'or', 'of', 'the', 'pro', 'Pro', 'PRO',
  ].map((w) => w.toLowerCase()),
);

/** A run of Latin letters (with digits, ., +, -, &) and an integer right after it: "Agent 365", "Windows 11", "vPro". */
const LATIN = /[A-Za-z][A-Za-z0-9.+&-]*(?:\s+\d+(?![\d.%]))?/g;
/** Identifiers the report writes about itself: H2-1, Q3-2, E12, v4, [^3]. */
const OWN_ID = /^(?:[HQE]\d|v\d|[A-C]$)/;

const fold = (s: string) => s.toLowerCase().replace(/[\s\-–—_·.]/g, '');

/** The names and numbers a clause makes a claim with. */
export function entitiesOf(clause: string): { names: string[][]; latin: string[]; numbers: ReturnType<typeof numbersIn> } {
  const plain = clause.replace(/\[\^\d+[!~]*\]|\[E\d+\]|\[[^\]]*\d[①-⑳]\]/g, ' ').replace(/\[\[[^\]]*\]\]/g, ' ');
  const names = ENTITY_GLOSSARY.filter((forms) => forms.some((f) => (/^[A-Za-z]/.test(f) ? new RegExp(`(?<![A-Za-z])${f.replace(/[.+]/g, '\\$&')}(?![A-Za-z])`, 'i').test(plain) : plain.includes(f))));
  const known = new Set(names.flat().map(fold));
  const latin = [...new Set([...plain.matchAll(LATIN)].map((m) => m[0].replace(/[.\-&+]+$/, '').trim()))].filter((w) => w.length >= 2 && /[A-Z]/.test(w) && !GENERIC.has(w.toLowerCase()) && !OWN_ID.test(w) && !known.has(fold(w)) && ![...known].some((k) => fold(w).startsWith(k) && fold(w).length - k.length <= 3));
  return { names, latin, numbers: numbersIn(plain) };
}

/** 两成 / 三成半 in the source: the percentage it stands for. */
const CHINESE_TENTH: Record<string, number> = { 一: 1, 两: 2, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
function tenthsIn(source: string): number[] {
  return [...source.matchAll(/([一两二三四五六七八九])成(半)?/g)].map((m) => CHINESE_TENTH[m[1]] * 10 + (m[2] ? 5 : 0)).concat(/半数|一半/.test(source) ? [50] : []);
}

/** What of the clause the source has not got (empty = something was found, or there was nothing to look for). */
export function missingFrom(clause: string, source: string): string[] {
  const { names, latin, numbers } = entitiesOf(clause);
  if (!names.length && !latin.length && !numbers.length) return [];
  const folded = fold(source);
  const quoteNums = numbersInQuote(source);
  const tenths = tenthsIn(source);
  const hasName = (forms: string[]) => forms.some((f) => (/^[A-Za-z]/.test(f) ? new RegExp(`(?<![A-Za-z])${f.replace(/[.+]/g, '\\$&')}(?![A-Za-z])`, 'i').test(source) : source.includes(f)));
  const hasNumber = (t: (typeof numbers)[number]) => numberInQuote(t, quoteNums) || (/%$/.test(t.raw) && tenths.some((p) => Math.abs(p - t.value) <= 5));
  const found = names.some(hasName) || latin.some((w) => folded.includes(fold(w))) || numbers.some(hasNumber);
  return found ? [] : [...names.map((n) => n[0]), ...latin, ...numbers.map((t) => t.raw)];
}

/** The lines checked: Summary (all of it), a card's 回答 and 理由 with its sub-items. */
function inScope(body: string): { text: string }[] {
  const out: { text: string }[] = [];
  let section = '';
  let reasons = false;
  for (const raw of body.split('\n')) {
    if (raw.startsWith('## ')) {
      section = raw.slice(3).trim();
      reasons = false;
      continue;
    }
    if (/^#/.test(raw) || /^\[\^\d+\]:/.test(raw)) continue;
    // D-64 T23 / T24: the new report's So what and 为什么 are first layer as the Summary is
    if (section === 'Summary' || section === 'So what' || section === '为什么（三条支撑）') {
      if (raw.trim()) out.push({ text: raw });
      continue;
    }
    if (/^- /.test(raw)) reasons = /^- 理由[：:]/.test(raw);
    if (/^- (?:Q\d+(?:-\d+)? 的)?回答[：:]/.test(raw) || /^- 理由[：:]/.test(raw) || (reasons && /^\s{2,}- /.test(raw))) out.push({ text: raw });
  }
  return out;
}

/** What code writes before a clause: not part of what the source must say. */
const LABEL = /^(?:依据|回答（一句话）|回答|理由|所以联想|So What|事实|推断|访谈支持|Q\d+(?:-\d+)? 的回答|Q\d+(?:-\d+)?\s*→)\s*[：:]?\s*/;

/** The clauses checked: each one as it ends, with the footnote ids it cites (the footnote numbers, not "[^9]"). */
export function firstLayerClauses(body: string): { sentence: string; footnotes: string[] }[] {
  const out: { sentence: string; footnotes: string[] }[] = [];
  for (const { text } of inScope(body)) {
    const cells = /^\s*\|/.test(text) ? text.trim().replace(/^\||\|$/g, '').split('|') : [text.replace(/^\s*-\s*/, '')];
    for (const cell of cells)
      for (const c of citedClauses(cell.replace(/<br\s*\/?>/gi, '。'))) out.push({ sentence: c.text.replace(LABEL, '').trim(), footnotes: c.footnotes });
  }
  return out;
}

/** The flags of a rendered report, given each footnote's source (footnote id → its block link and what it says). */
export function entityFlags(body: string, sources: ReadonlyMap<string, FootnoteSource>): EntityFlag[] {
  const out: EntityFlag[] = [];
  for (const { sentence, footnotes } of firstLayerClauses(body)) {
    for (const id of footnotes) {
      const src = sources.get(id);
      if (!src) continue;
      const missing = missingFrom(sentence, src.text);
      if (missing.length && !out.some((f) => f.key === src.ref && f.sentence === sentence)) out.push({ key: src.ref, footnote: `[^${id}]`, sentence, missing });
    }
  }
  return out;
}

/** Each footnote's source from the vault: its block's original, its note's name and publisher. */
export async function footnoteSources(vault: Vault, body: string, fromPath?: string): Promise<Map<string, FootnoteSource>> {
  const out = new Map<string, FootnoteSource>();
  for (const [id, def] of footnoteDefs(body)) {
    const raw = [...def.matchAll(/\[\[[^\]]+#\^[A-Za-z0-9-]+[^\]]*\]\]/g)].at(-1)?.[0];
    const link = raw ? parseWikiLink(raw) : null;
    if (!raw || !link?.block) continue;
    const res = await vault.resolveLink(link, fromPath).catch(() => null);
    if (!res?.ok) continue;
    const block = (await vault.getBlocks(res.path).catch(() => new Map())).get(link.block);
    if (!block) continue;
    const info = await loadSourceInfo(vault, res.path).catch(() => null);
    const ref = `[[${link.target}#^${link.block}]]`;
    const original = blockQuote(block.text);
    out.set(id, { ref, text: [original, info?.name ?? '', info?.publisher ?? ''].join('\n'), quote: original });
  }
  return out;
}

/** entity_flags of a report as written (execute, follow-up): only marks, never a reason to hold delivery. */
export async function entityFlagsOf(vault: Vault, body: string, fromPath?: string): Promise<EntityFlag[]> {
  return entityFlags(body, await footnoteSources(vault, body, fromPath));
}
