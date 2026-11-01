/**
 * 网页入库：把 Deep Research 抓到的页面写成 `10_资料库/` 下的 source 笔记
 * （PRD §7 规则 5、§9.4）。只通过传入的 `Vault` 读写，不打印任何东西。
 *
 * 笔记结构：
 *   # 标题
 *   > 来源：URL（抓取日期；等级：理由）
 *   ## 论断            ← 先留空，之后由 appendClaims（lib/research/claims.ts）写入
 *   ## 抓取原文        ← 抓到的正文，防止网页文本伪造块标记
 */
import { sourceSchema } from '@/lib/notes/schema';
import type { Vault } from '@/lib/vault';
import { MAX_INGEST_CHARS } from './constants';
import { gradeSource, type SourceGrade } from './grading';
import { localDate } from '@/lib/local-date';

const LIBRARY_DIR = '10_资料库';
const LINK_CHECK_TIMEOUT_MS = 5_000;
const PAGE_TOO_LONG_NOTICE = '（以下略，原文过长）';

export interface IngestInput {
  vault: Vault;
  url: string;
  title: string;
  /** Full fetched page text. */
  content: string;
  siteName?: string | null;
  /** ISO date/datetime of the page, if the search result had one. */
  date?: string | null;
  /** DeepSeek Search `authority`. */
  authority?: number | null;
  /** Preferred note name (no .md); default: derived from title. */
  name?: string;
  /** Wikilink strings written to the note's derived_from / relates_to (both required by the vault). */
  derivedFrom: string;
  relatesTo: string;
  /** D63: the investigation folder whose web search fetched it (shown as "M1 调查时获取"). */
  fetchedIn?: string;
  now?: Date;
  /** Default: defaultCheckLink. Injected in tests. Errors are caught → link_checked=false. */
  checkLink?: (url: string) => Promise<boolean>;
}

export interface IngestResult {
  path: string;
  name: string;
  deduped: boolean;
  grade: SourceGrade;
  link_checked: boolean;
}

// ── URL 校验 / 归一化 ────────────────────────────────────────────────────────

function parseIPv4(host: string): number[] | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return null;
  const parts = m.slice(1).map((p) => Number(p));
  return parts.every((p) => p >= 0 && p <= 255) ? parts : null;
}

/** 内网 / 本机地址（不接受抓取）。 */
function isPrivateHost(rawHost: string): boolean {
  const host = rawHost.toLowerCase().replace(/^\[|\]$/g, '');
  if (!host) return true;
  if (host === '::1' || host === '0:0:0:0:0:0:0:1') return true;
  if (host === 'localhost' || host.endsWith('.localhost')) return true;
  if (host.endsWith('.local')) return true;

  const ip = parseIPv4(host);
  if (!ip) return false;
  const [a, b] = ip;
  if (a === 0) return true; // 0.0.0.0/8
  if (a === 127) return true; // 127.0.0.0/8
  if (a === 10) return true; // 10.0.0.0/8
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 168) return true; // 192.168.0.0/16
  if (a === 169 && b === 254) return true; // 169.254.0.0/16
  return false;
}

/** 只接受 http(s) 且不是内网地址；否则抛 Error。 */
function parseHttpUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`无法解析 URL：${raw}`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`只接受 http/https URL：${raw}`);
  }
  if (isPrivateHost(url.hostname)) {
    throw new Error(`拒绝内网地址：${raw}`);
  }
  return url;
}

/**
 * 去重用的归一化形式：
 * 主机名小写、去掉 `#hash`、去掉 `utm_*` / `fbclid` / `gclid`、其余参数按字母序、
 * 去掉路径末尾多余的 `/`（根路径除外）。
 */
/**
 * The URL as it should be stored and fetched: no `#anchor` (DeepSeek Search appends `#1`, `#1#1`, … to
 * results, and some pages 404 with them) and no tracking parameters. Unlike `normalizeUrl` (the
 * comparison key) it keeps host case, path and the remaining query exactly as the site wrote them.
 */
export function cleanUrl(raw: string): string {
  try {
    const url = new URL((raw ?? '').trim());
    url.hash = '';
    for (const key of [...url.searchParams.keys()]) {
      const k = key.toLowerCase();
      if (k.startsWith('utm_') || ['fbclid', 'gclid', 'mc_cid', 'mc_eid', 'hss_channel', 'spm'].includes(k)) url.searchParams.delete(key);
    }
    return url.toString();
  } catch {
    return (raw ?? '').trim();
  }
}

export function normalizeUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL((raw ?? '').trim());
  } catch {
    return (raw ?? '').trim();
  }

  const host = url.hostname.toLowerCase();
  const path = url.pathname.replace(/\/+$/, '') || '/';

  const kept = [...url.searchParams.entries()].filter(([key]) => {
    const k = key.toLowerCase();
    return !k.startsWith('utm_') && k !== 'fbclid' && k !== 'gclid';
  });
  kept.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  const query = new URLSearchParams(kept).toString();

  return `${url.protocol.toLowerCase()}//${host}${path}${query ? `?${query}` : ''}`;
}

// ── 笔记名 / id ──────────────────────────────────────────────────────────────

/**
 * 不能进笔记名的字符：文件系统非法字符（`\ / : * ? " < > |`）之外，
 * 还有 wikilink 里带保留含义的 `[ ] # ^ |` —— 它们会让 `[[资料名#^c1]]` 解析失败
 * （网页标题里很常见，如 `AI PC [2026] #1 | IDC`）。
 */
const ILLEGAL_NAME_CHARS = /[\\/:*?"<>|[\]#^\r\n]+/g;

/** 去掉非法字符、合并空白、截到 60 个字符。 */
function sanitizeName(raw: string): string {
  const cleaned = (raw ?? '')
    .replace(ILLEGAL_NAME_CHARS, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '')
    .trim();
  return [...cleaned].slice(0, 60).join('').trim();
}

function randomBase36(length: number): string {
  let out = '';
  while (out.length < length) out += Math.floor(Math.random() * 36).toString(36);
  return out.slice(0, length);
}

/** `src-` + 名字的 ascii slug（≤24）+ `-` + 6 位随机 36 进制。 */
function makeId(name: string): string {
  const slug =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 24)
      .replace(/-+$/g, '') || 'source';
  return `src-${slug}-${randomBase36(6)}`;
}

async function uniqueName(vault: Vault, base: string): Promise<string> {
  let candidate = base;
  let index = 2;
  while (await vault.exists(`${LIBRARY_DIR}/${candidate}.md`)) {
    candidate = `${base} (${index})`;
    index += 1;
  }
  return candidate;
}

// ── 日期 ─────────────────────────────────────────────────────────────────────

function toIsoDate(date: Date): string {
  return localDate(date);
}

/** 任意 ISO 日期/时间 → `YYYY-MM-DD`；解析不了则 null。 */
function toDateOnly(value: string | null | undefined): string | null {
  const text = (value ?? '').trim();
  if (!text) return null;

  const dateOnly = /^(\d{4}-\d{2}-\d{2})(?:$|[T ])/.exec(text);
  if (dateOnly) {
    const parsed = new Date(`${dateOnly[1]}T00:00:00Z`);
    if (!Number.isNaN(parsed.getTime())) return dateOnly[1];
  }

  const parsed = new Date(text);
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
  return null;
}

// ── 链接检查 ─────────────────────────────────────────────────────────────────

/** HEAD（不行再 GET），5 秒超时，`redirect: 'follow'`；2xx/3xx 为 true。永不抛错。 */
export async function defaultCheckLink(url: string): Promise<boolean> {
  const probe = async (method: 'HEAD' | 'GET'): Promise<boolean> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), LINK_CHECK_TIMEOUT_MS);
    try {
      const res = await fetch(url, { method, redirect: 'follow', signal: controller.signal });
      return res.status >= 200 && res.status < 400;
    } finally {
      clearTimeout(timer);
    }
  };

  try {
    if (await probe('HEAD')) return true;
  } catch {
    // HEAD 被拒或网络错误 —— 下面用 GET 再试一次。
  }
  try {
    return await probe('GET');
  } catch {
    return false;
  }
}

async function safeCheckLink(
  check: (url: string) => Promise<boolean>,
  url: string,
): Promise<boolean> {
  try {
    return (await check(url)) === true;
  } catch {
    return false;
  }
}

// ── 去重 ─────────────────────────────────────────────────────────────────────

type VaultListEntry = Awaited<ReturnType<Vault['list']>>[number];

async function listLibrary(vault: Vault): Promise<VaultListEntry[]> {
  try {
    return await vault.list(LIBRARY_DIR);
  } catch {
    return [];
  }
}

function asSourceGrade(value: unknown): SourceGrade | null {
  return value === 'A' || value === 'B' || value === 'C' ? value : null;
}

async function findExistingSource(
  vault: Vault,
  entries: VaultListEntry[],
  target: string,
): Promise<IngestResult | null> {
  for (const entry of entries) {
    if (entry.kind !== 'file') continue;
    let note;
    try {
      note = await vault.read(entry.path);
    } catch {
      continue;
    }
    const storedUrl = note.data.url;
    if (typeof storedUrl !== 'string' || storedUrl.length === 0) continue;
    if (normalizeUrl(storedUrl) !== target) continue;

    return {
      path: entry.path,
      name: entry.name.replace(/\.md$/, ''),
      deduped: true,
      grade: asSourceGrade(note.data.grade) ?? gradeSource({ url: storedUrl }).grade,
      link_checked: note.data.link_checked === true,
    };
  }
  return null;
}

// ── 正文 ─────────────────────────────────────────────────────────────────────

/** 网页正文不能伪造块标记：行末的 ` ^abc` 换成全角 `＾`。 */
function neutralizeBlockMarkers(text: string): string {
  return text.replace(/(\s)\^([A-Za-z0-9-]+)\s*$/gm, '$1＾$2');
}

function prepareContent(raw: string): string {
  const neutralized = neutralizeBlockMarkers(raw ?? '');
  if (neutralized.length <= MAX_INGEST_CHARS) return neutralized;
  return `${neutralized.slice(0, MAX_INGEST_CHARS)}\n${PAGE_TOO_LONG_NOTICE}`;
}

function buildBody(opts: {
  title: string;
  url: string;
  today: string;
  grade: SourceGrade;
  reason: string;
  content: string;
}): string {
  return [
    `# ${opts.title}`,
    '',
    `> 来源：${opts.url}（${opts.today} 抓取；${opts.grade} 级：${opts.reason}）`,
    '',
    '## 论断',
    '',
    '## 抓取原文',
    '',
    prepareContent(opts.content),
    '',
  ].join('\n');
}

// ── 入库 ─────────────────────────────────────────────────────────────────────

export async function ingestSource(input: IngestInput): Promise<IngestResult> {
  const storedUrl = cleanUrl(input.url);
  const parsedUrl = parseHttpUrl(storedUrl);
  const today = toIsoDate(input.now ?? new Date());
  const target = normalizeUrl(input.url);

  // 1. 去重：URL 相同就直接返回已有笔记，不写文件。
  const library = await listLibrary(input.vault);
  const existing = await findExistingSource(input.vault, library, target);
  if (existing) return existing;

  // 2. 定级（只看域名）。
  const { grade, reason } = gradeSource({
    url: storedUrl,
    authority: input.authority,
    siteName: input.siteName,
  });

  // 3. 笔记名（冲突时加 (2)、(3)…）。
  const baseName =
    sanitizeName(input.name ?? input.title) || sanitizeName(parsedUrl.hostname) || 'source';
  const name = await uniqueName(input.vault, baseName);
  const notePath = `${LIBRARY_DIR}/${name}.md`;

  // 4. 链接检查：失败/抛错只记 link_checked=false，入库照常。
  const linkChecked = await safeCheckLink(input.checkLink ?? defaultCheckLink, storedUrl);

  // 5. frontmatter（必须通过 sourceSchema）。
  const hostname = parsedUrl.hostname.toLowerCase();
  const frontmatter = {
    id: makeId(name),
    type: 'source',
    status: '推断',
    created: today,
    updated: today,
    author: 'AI',
    derived_from: [input.derivedFrom],
    relates_to: [input.relatesTo],
    url: storedUrl,
    publisher: (input.siteName ?? '').trim() || hostname,
    published: toDateOnly(input.date),
    retrieved: today,
    origin: '网络',
    grade,
    graded_by: 'AI',
    authority: input.authority ?? null,
    link_checked: linkChecked,
    ...(input.fetchedIn ? { fetched_in: input.fetchedIn } : {}),
  };
  sourceSchema.parse(frontmatter);

  // 6. 正文。
  const body = buildBody({ title: name, url: storedUrl, today, grade, reason, content: input.content });

  await input.vault.write(notePath, { frontmatter, body });

  return { path: notePath, name, deduped: false, grade, link_checked: linkChecked };
}
