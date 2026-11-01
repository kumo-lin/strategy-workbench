/**
 * M2-03 — extracting claims from a fetched page and writing them into a source note
 * (PRD §6.3.1 step 4, §9.7, CONTRACTS §2.4).
 *
 * The model is asked for verbatim quotes, but it may paraphrase or invent them. So every
 * "quote" is checked against the page text we actually fetched — comparing with
 * `normalizeForQuote` from `@/lib/vault/blocks` so the check here and later `check_citations`
 * use exactly the same yardstick (whitespace/punctuation-insensitive, NFKC, lowercased).
 * Only quotes that survive are written as `- 「原文」— 位置：… ^cN` block-ref lines.
 */
import { normalizeForQuote } from '@/lib/vault/blocks';
import type { Vault } from '@/lib/vault';
import { localDate } from '@/lib/local-date';

export interface RawClaim {
  quote: string;
  location?: string;
}

export type DropReason = 'not_found' | 'too_short' | 'duplicate';

export interface VerifyResult {
  kept: RawClaim[];
  dropped: { claim: RawClaim; reason: DropReason }[];
}

/** Minimum length of a *normalised* quote — anything shorter proves nothing. */
export const MIN_QUOTE_CHARS = 8;

/** Pure. Keeps the claims whose quote really appears in `content`, in input order. */
export function verifyQuotes(content: string, claims: RawClaim[]): VerifyResult {
  const haystack = normalizeForQuote(content);
  const kept: RawClaim[] = [];
  const dropped: { claim: RawClaim; reason: DropReason }[] = [];
  const seen = new Set<string>();

  for (const claim of claims) {
    const q = normalizeForQuote(claim.quote ?? '');
    if (q.length < MIN_QUOTE_CHARS) {
      dropped.push({ claim, reason: 'too_short' });
      continue;
    }
    if (!haystack.includes(q)) {
      dropped.push({ claim, reason: 'not_found' });
      continue;
    }
    if (seen.has(q)) {
      dropped.push({ claim, reason: 'duplicate' });
      continue;
    }
    seen.add(q);
    kept.push(claim);
  }

  return { kept, dropped };
}

export interface AddedClaim {
  id: string;
  quote: string;
  location: string;
}

// ── Writing ──────────────────────────────────────────────────────────────────

const CLAIMS_HEADING = '## 论断';
const CLAIMS_HEADING_RE = /^##\s+论断$/;
const H2_RE = /^##\s/;
const NO_LOCATION = '未标注';

/** One line safety: fold whitespace, drop a trailing `^cN`-style marker, neutralise brackets. */
function cleanQuote(raw: string): string {
  const folded = (raw ?? '').replace(/\s+/g, ' ').trim();
  const unbracketed = folded.replace(/」/g, '』').replace(/「/g, '『');
  return unbracketed.replace(/\s*\^[^\s]*$/, '').trim();
}

function cleanLocation(raw: string | undefined): string {
  const loc = (raw ?? '').replace(/\s+/g, ' ').trim();
  return loc === '' ? NO_LOCATION : loc;
}

function nextBlockNumber(existing: Map<string, unknown>): number {
  let next = 1;
  for (const id of existing.keys()) {
    const m = /^c(\d+)$/.exec(id);
    if (m) next = Math.max(next, Number(m[1]) + 1);
  }
  return next;
}

/**
 * Insert the claim lines at the end of the `## 论断` section (before the next `## ` heading,
 * after the section's last non-empty line; an empty section gets one blank line under the
 * heading). Everything else in the body is left byte-for-byte alone.
 */
function insertClaimLines(body: string, claimLines: string[]): string {
  const eol = body.includes('\r\n') ? '\r\n' : '\n';
  const lines = body.split(eol);
  const headingIdx = lines.findIndex((l) => CLAIMS_HEADING_RE.test(l.trim()));

  if (headingIdx < 0) {
    const base = body.replace(/[\r\n]+$/, '');
    const section = `${CLAIMS_HEADING}${eol}${eol}${claimLines.join(eol)}`;
    return `${base === '' ? '' : `${base}${eol}${eol}`}${section}${eol}`;
  }

  let sectionEnd = lines.length;
  for (let i = headingIdx + 1; i < lines.length; i++) {
    if (H2_RE.test(lines[i].trim())) {
      sectionEnd = i;
      break;
    }
  }

  let lastContent = -1;
  for (let i = headingIdx + 1; i < sectionEnd; i++) {
    if (lines[i].trim() !== '') lastContent = i;
  }

  const at = lastContent >= 0 ? lastContent + 1 : headingIdx + 1;
  const block = lastContent >= 0 ? [...claimLines] : ['', ...claimLines];
  const following = lines[at];
  if (following !== undefined && following.trim() !== '' && /^#/.test(following.trim())) {
    block.push('');
  }
  lines.splice(at, 0, ...block);
  return lines.join(eol);
}

/**
 * Appends claim lines under `## 论断` in a source note.
 * Returns the added claims (ids in order). An empty list writes nothing.
 */
export async function appendClaims(vault: Vault, sourcePath: string, claims: RawClaim[]): Promise<AddedClaim[]> {
  if (claims.length === 0) return [];

  const note = await vault.read(sourcePath);
  if (note.data.type !== 'source') {
    throw new Error(`appendClaims: ${sourcePath} is not a source note`);
  }

  const existing = await vault.getBlocks(sourcePath);
  let next = nextBlockNumber(existing);

  const added: AddedClaim[] = [];
  const claimLines: string[] = [];
  for (const claim of claims) {
    const id = `c${next}`;
    next += 1;
    const quote = cleanQuote(claim.quote);
    const location = cleanLocation(claim.location);
    claimLines.push(`- 「${quote}」— 位置：${location} ^${id}`);
    added.push({ id, quote, location });
  }

  const body = insertClaimLines(note.body, claimLines);
  const today = localDate();

  await vault.write(
    sourcePath,
    { frontmatter: { ...note.data, updated: today }, body },
    { overwrite: true },
  );

  return added;
}
