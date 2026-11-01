/** Reading sources out of the vault: metadata, claim blocks as evidence candidates, citation links. */
import type { Vault } from '@/lib/vault';
import { isUserUploadPlatform } from './grading';
import { normalizeUrl } from './ingest';
import type { Evidence, EvidenceOrigin, Grade } from './evidence';

export interface SourceInfo {
  path: string;
  /** Note name without folder / .md — what `[[…]]` uses. */
  name: string;
  /** What to write in `[[…]]` so it resolves unambiguously. */
  linkTarget: string;
  publisher: string;
  grade: Grade;
  gradedBy: 'AI' | '人';
  origin: EvidenceOrigin;
  url: string | null;
  published: string | null;
  /** 'expert' for an interview note (type knowledge, kind expert-input). */
  kind: 'source' | 'expert';
  simulated: boolean;
  /** From the note's `reliability` (absent = ok). */
  reliability: 'ok' | 'unverified' | 'disproven';
  reliabilityNote: string | null;
}

export function noteName(path: string): string {
  return path.replace(/\.md$/, '').split('/').pop() ?? path;
}

export async function loadSourceInfo(vault: Vault, path: string): Promise<SourceInfo | null> {
  const n = await vault.read(path);
  const isExpertNote = n.data.type === 'knowledge' && n.data.kind === 'expert-input';
  if (n.data.type !== 'source' && !isExpertNote) return null;
  const name = noteName(path);
  const resolved = await vault.resolveLink(`[[${name}]]`);
  const linkTarget = resolved.ok && resolved.path === path ? name : path.replace(/\.md$/, '');
  if (isExpertNote) {
    const simulated = n.data.simulated === true;
    return {
      path,
      name,
      linkTarget,
      publisher: simulated ? '专家访谈（模拟）' : '专家访谈',
      grade: 'C', // never A/B (D-18); only used for ordering
      gradedBy: 'AI',
      origin: '专家访谈',
      url: null,
      published: typeof n.data.created === 'string' ? n.data.created : null,
      kind: 'expert',
      simulated,
      reliability: 'ok',
      reliabilityNote: null,
    };
  }
  const g = n.data.grade;
  const url = typeof n.data.url === 'string' ? n.data.url : null;
  const gradedBy = n.data.graded_by === '人' ? '人' : 'AI';
  const rel = n.data.reliability;
  return {
    path,
    name,
    linkTarget,
    publisher: String(n.data.publisher ?? name),
    // a user-upload platform is C whatever an earlier AI grading said (a person's own grading stands)
    grade: isUserUploadPlatform(url) && gradedBy === 'AI' ? 'C' : g === 'A' || g === 'B' || g === 'C' ? g : 'C',
    gradedBy,
    origin: n.data.origin === '网络' ? '网络' : '知识库',
    url,
    published: typeof n.data.published === 'string' ? n.data.published : null,
    kind: 'source',
    simulated: false,
    reliability: rel === 'unverified' || rel === 'disproven' ? rel : 'ok',
    reliabilityNote: typeof n.data.reliability_note === 'string' && n.data.reliability_note.trim() ? n.data.reliability_note.trim() : null,
  };
}

/** `「原文」— 位置：p.3` → { quote, location }; a plain block is all quote. */
export function splitClaimText(text: string): { quote: string; location: string } {
  const m = /^「([\s\S]*)」\s*[—–-]+\s*位置[:：]\s*([\s\S]*)$/.exec(text.trim());
  if (m) return { quote: m[1].trim(), location: m[2].trim() };
  return { quote: text.trim(), location: '' };
}

export type EvidenceDraft = Omit<Evidence, 'claimId' | 'subQuestionId' | 'round' | 'stance' | 'reason' | 'core' | 'partial'>;

/** Every `^cN` claim block of a source, as undecided evidence. */
export async function claimBlocksOf(vault: Vault, info: SourceInfo, only?: Set<string>): Promise<EvidenceDraft[]> {
  // a source shown not to be what it claims is never a candidate again (vault lookup, a reused page, a follow-up's seed)
  if (info.reliability === 'disproven') return [];
  const blocks = await vault.getBlocks(info.path);
  const out: EvidenceDraft[] = [];
  for (const b of blocks.values()) {
    // claims of a source are ^cN; an expert interview's answers are ^eN
    if (!(info.kind === 'expert' ? /^e\d+$/ : /^c\d+$/).test(b.id)) continue;
    if (only && !only.has(b.id)) continue;
    // an expert block is a paragraph (`**受访者**：……`), not a `「原文」— 位置` line: the quote is the text without emphasis marks
    const { quote } = info.kind === 'expert' ? { quote: b.text.replace(/\*\*|__/g, '').trim() } : splitClaimText(b.text);
    out.push({
      ref: `[[${info.linkTarget}#^${b.id}]]`,
      path: info.path,
      block: b.id,
      text: b.text,
      quote,
      sourceName: info.name,
      publisher: info.publisher,
      url: info.url,
      grade: info.grade,
      origin: info.origin,
      gradedBy: info.gradedBy,
      sourceKind: info.kind,
      simulated: info.simulated,
      published: info.published,
      ...(info.reliability === 'unverified' ? { reliability: 'unverified' as const, ...(info.reliabilityNote ? { reliabilityNote: info.reliabilityNote } : {}) } : {}),
    });
  }
  return out;
}

/** normalised URL → source note path, for every note in 10_资料库 that has a URL. */
export async function buildUrlIndex(vault: Vault): Promise<Map<string, string>> {
  const idx = new Map<string, string>();
  let entries;
  try {
    entries = await vault.list('10_资料库');
  } catch {
    return idx;
  }
  for (const e of entries) {
    if (e.kind !== 'file') continue;
    try {
      const url = (await vault.read(e.path)).data.url;
      if (typeof url === 'string' && url) idx.set(normalizeUrl(url), e.path);
    } catch {
      /* skip unreadable */
    }
  }
  return idx;
}
