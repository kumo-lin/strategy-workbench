/**
 * 信源定级（PRD §7 规则 5、§9.4）。
 *
 * 只看域名：A = 一手资料（官方统计/监管/交易所/厂商官方/IR 页），
 * B = 可信第三方（研究机构、主流财经媒体），C = 其他一切。
 *
 * 主机名比较规则：等于名单里的域名，或以 `.域名` 结尾
 * （`news.cn.reuters.com` → `reuters.com`；`notreuters.com`、`reuters.com.evil.example` 不算）。
 *
 * `authority`（DeepSeek Search）与 `siteName` 只是参考信息，写进 `reason`，
 * **绝不改变**定级。
 */

export type SourceGrade = 'A' | 'B' | 'C';

export interface GradeSourceInput {
  url: string;
  /** DeepSeek Search `authority` — reference only. */
  authority?: number | null;
  /** Publisher name from the search result — reference only. */
  siteName?: string | null;
}

export interface GradeSourceResult {
  grade: SourceGrade;
  reason: string;
}

// ── 名单 ─────────────────────────────────────────────────────────────────────

/** A：官方统计、监管文件、交易所披露。 */
const OFFICIAL_DOMAINS: readonly string[] = [
  'stats.gov.cn',
  'sec.gov',
  'hkexnews.hk',
  'sse.com.cn',
  'szse.cn',
  'cninfo.com.cn',
  'csrc.gov.cn',
  'miit.gov.cn',
  'cac.gov.cn',
  'europa.eu',
  'worldbank.org',
  'imf.org',
  'oecd.org',
  'un.org',
  'bis.org',
];

/**
 * A：官方域名后缀（主机名以这些结尾即可）。
 * 用「等于或以 .域名 结尾」实现，因此 `www.gov.cn` 去掉 www 后也命中 `gov.cn`。
 */
const OFFICIAL_SUFFIXES: readonly string[] = ['gov', 'gov.cn', 'gov.hk', 'gov.uk', 'gov.sg', 'edu.cn'];

/** A：厂商官方（官网、新闻室、投资者关系）。 */
const VENDOR_DOMAINS: readonly string[] = [
  'lenovo.com',
  'lenovo.com.cn',
  'microsoft.com',
  'intel.com',
  'amd.com',
  'qualcomm.com',
  'nvidia.com',
  'apple.com',
  'dell.com',
  'hp.com',
  'asus.com',
  'huawei.com',
  'xiaomi.com',
  'samsung.com',
  'anthropic.com',
  'openai.com',
];

/** `google.com` 只在官方站点上算 A，这些子域是文档/协作内容，不算。 */
const GOOGLE_EXCLUDED = ['docs.google.com', 'sites.google.com', 'groups.google.com'];

/**
 * 厂商域名下的"不是厂商官方发布"的子域：播客、应用商店、论坛 / 社区、新闻聚合、文档协作。
 * 这些页面由第三方或用户产生，挂在厂商域名下也不能当官方来源（例：podcasts.apple.com）。
 */
const NON_OFFICIAL_SUBDOMAINS: readonly string[] = [
  'podcasts', 'music', 'itunes', 'apps', 'play', 'books', 'tv',
  'discussions', 'community', 'communities', 'forum', 'forums', 'answers', 'social',
];

/** C：播客、视频、聚合站、自媒体平台（不论挂在哪个域名下都不是官方、也不是 B 级媒体）。 */
/**
 * Platforms where anyone uploads documents (人人文库, 道客巴巴, 豆丁, 原创力文档, 百度文库): what is there is somebody's
 * copy or retelling of a source, never the source (D-21 v3: a "金融监管总局 AI 风险管理指引" that does not exist,
 * from a .docx on renrendoc.com). Always C, labelled "用户上传文档，转述".
 */
export const USER_UPLOAD_DOMAINS: readonly string[] = ['renrendoc.com', 'doc88.com', 'docin.com', 'book118.com', 'wenku.baidu.com', 'wenku.so.com', 'wendangku.net', 'mbalib.com'];

/** The URL is on a user-upload document platform. */
export function isUserUploadPlatform(url: string | null | undefined): boolean {
  if (!url) return false;
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
    return USER_UPLOAD_DOMAINS.some((d) => host === d || host.endsWith(`.${d}`));
  } catch {
    return false;
  }
}

const AGGREGATOR_DOMAINS: readonly string[] = [
  'podcasts.apple.com', 'podcasts.google.com', 'open.spotify.com', 'spotify.com',
  'youtube.com', 'youtu.be', 'bilibili.com',
  'news.google.com', 'flipboard.com', 'msn.com', 'news.yahoo.com',
  'medium.com', 'substack.com', 'linkedin.com', 'reddit.com', 'quora.com', 'zhihu.com',
  'weixin.qq.com', 'mp.weixin.qq.com', 'toutiao.com', 'xiaohongshu.com', 'weibo.com',
];

/** B：研究 / 咨询机构。 */
const RESEARCH_DOMAINS: readonly string[] = [
  'idc.com',
  'idc.com.cn',
  'gartner.com',
  'canalys.com',
  'counterpointresearch.com',
  'forrester.com',
  'mckinsey.com',
  'bcg.com',
  'bain.com',
  'deloitte.com',
  'pwc.com',
  'kpmg.com',
  'ey.com',
  'omdia.com',
  'ccidata.com',
  'caict.ac.cn',
  'iresearch.cn',
  'statista.com',
  'reconanalytics.com',
];

/** B：主流财经 / 权威媒体。 */
const MEDIA_DOMAINS: readonly string[] = [
  'reuters.com',
  'bloomberg.com',
  'ft.com',
  'wsj.com',
  'economist.com',
  'cnbc.com',
  'nikkei.com',
  'caixin.com',
  'yicai.com',
  'cls.cn',
  'stcn.com',
  'nytimes.com',
  'xinhuanet.com',
  'people.com.cn',
  'cctv.com',
  // 主流科技 / 商业媒体
  'theregister.com',
  'theverge.com',
  'techcrunch.com',
  'arstechnica.com',
  'wired.com',
  'zdnet.com',
  'cnet.com',
  'engadget.com',
  'venturebeat.com',
  'techradar.com',
  'tomshardware.com',
  'infoworld.com',
  'computerworld.com',
  'networkworld.com',
  'theinformation.com',
  'businessinsider.com',
  'fortune.com',
  'hbr.org',
  'technologyreview.com',
  'spectrum.ieee.org',
  'nature.com',
  '36kr.com',
  'ithome.com',
  'thepaper.cn',
  'jiemian.com',
  '21jingji.com',
  'nbd.com.cn',
];

// ── 匹配工具 ─────────────────────────────────────────────────────────────────

/** 主机名等于 `domain`，或为其子域。 */
function matchesDomain(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`);
}

/** 返回命中的第一个域名（用于 reason），没有则 null。 */
function findDomain(host: string, domains: readonly string[]): string | null {
  for (const domain of domains) {
    if (matchesDomain(host, domain)) return domain;
  }
  return null;
}

/** `podcasts.apple.com` 这类：挂在厂商域名下，但第一个标签说明它是第三方 / 用户内容。 */
function isNonOfficialSubdomain(host: string, rootDomain: string): boolean {
  if (host === rootDomain) return false;
  const sub = host.slice(0, -(rootDomain.length + 1)).split('.');
  return sub.some((label) => NON_OFFICIAL_SUBDOMAINS.includes(label));
}

function isGoogleOfficial(host: string): boolean {
  if (host === 'blog.google') return true;
  if (host === 'google.com' || host.endsWith('.google.com')) {
    return !GOOGLE_EXCLUDED.some((excluded) => matchesDomain(host, excluded));
  }
  return false;
}

/** 把 authority / siteName 作为参考信息补进 reason（不改变等级）。 */
function withRef(result: GradeSourceResult, input: GradeSourceInput): GradeSourceResult {
  const refs: string[] = [];
  if (typeof input.authority === 'number' && Number.isFinite(input.authority)) {
    refs.push(`authority=${input.authority}`);
  }
  const siteName = (input.siteName ?? '').trim();
  if (siteName) refs.push(`站点「${siteName}」`);
  if (refs.length === 0) return result;
  return {
    grade: result.grade,
    reason: `${result.reason}；参考：${refs.join('、')}（仅供参考，不影响定级）`,
  };
}

// ── 定级 ─────────────────────────────────────────────────────────────────────

export function gradeSource(input: GradeSourceInput): GradeSourceResult {
  let host: string;
  try {
    host = new URL(input.url).hostname.toLowerCase().replace(/\.$/, '');
  } catch {
    return { grade: 'C', reason: '无法解析 URL' };
  }
  if (host.startsWith('www.')) host = host.slice(4);
  if (!host) return { grade: 'C', reason: '无法解析 URL' };

  // C — 用户上传文档平台：别人上传的副本或转述，先于一切规则
  if (isUserUploadPlatform(input.url)) {
    return withRef({ grade: 'C', reason: `${host} 是用户上传文档的平台，内容是转述或副本，不是原始来源（C）` }, input);
  }

  // C — 播客 / 视频 / 聚合 / 自媒体平台：先于一切 A/B 规则
  const aggregator = findDomain(host, AGGREGATOR_DOMAINS);
  if (aggregator) {
    return withRef({ grade: 'C', reason: `域名 ${aggregator} 是播客/聚合站/自媒体平台，不能当官方或权威来源（C）` }, input);
  }

  // A — 官方统计 / 监管 / 交易所
  const official = findDomain(host, OFFICIAL_DOMAINS);
  if (official) {
    return withRef({ grade: 'A', reason: `域名 ${official} 属于官方统计/监管/交易所机构（A）` }, input);
  }

  // A — 官方域名后缀
  const suffix = findDomain(host, OFFICIAL_SUFFIXES);
  if (suffix) {
    return withRef(
      { grade: 'A', reason: `域名 ${host} 以 .${suffix} 结尾，属于政府/监管/教育官方域名（A）` },
      input,
    );
  }

  // A — 公司投资者关系页
  if (host.startsWith('investor.') || host.startsWith('ir.')) {
    return withRef(
      { grade: 'A', reason: `主机名 ${host} 以 investor./ir. 开头，属于公司投资者关系页（A）` },
      input,
    );
  }

  // A — 厂商官方发布
  if (host.endsWith('google.com') && (isNonOfficialSubdomain(host, 'google.com') || host.startsWith('news.'))) {
    return withRef({ grade: 'C', reason: `${host} 属于 Google 的聚合/社区/文档类服务，不是官方发布（C）` }, input);
  }
  if (isGoogleOfficial(host)) {
    return withRef({ grade: 'A', reason: `域名 ${host} 属于厂商官方发布（Google 官方站点）（A）` }, input);
  }
  const vendor = findDomain(host, VENDOR_DOMAINS);
  if (vendor && isNonOfficialSubdomain(host, vendor)) {
    return withRef({ grade: 'C', reason: `${host} 虽在 ${vendor} 域名下，但属于播客/应用商店/社区等第三方内容，不是厂商官方发布（C）` }, input);
  }
  if (vendor) {
    return withRef(
      { grade: 'A', reason: `域名 ${vendor} 属于厂商官方发布（官网/新闻室/投资者关系）（A）` },
      input,
    );
  }

  // B — 研究 / 咨询机构
  const research = findDomain(host, RESEARCH_DOMAINS);
  if (research) {
    return withRef({ grade: 'B', reason: `域名 ${research} 属于研究/咨询机构（B）` }, input);
  }

  // B — 主流财经 / 权威媒体
  const media = findDomain(host, MEDIA_DOMAINS);
  if (media) {
    return withRef({ grade: 'B', reason: `域名 ${media} 属于主流财经/权威媒体（B）` }, input);
  }

  // C — 其他
  return withRef({ grade: 'C', reason: '不在 A/B 名单：按 C 级处理' }, input);
}

// ── 来源类型（D-21-4：追加调查"找一手来源"那几轮，什么才算找到了）─────────────
//
// 只看 URL，和定级一样是确定性规则，名单复用上面的：
//   - 监管 / 政府（regulator）：官方统计 / 监管 / 交易所域名，政府域名后缀（gov、gov.cn …）
//   - 采购 / 招标（procurement）：政府采购和招投标平台（PROCUREMENT_DOMAINS）；
//     或者在 A/B 级站点上、路径像公告页的（PROCUREMENT_PATH：zbgg、cggg、zfcg、tender、procurement …）
//   - 官方发布（official）：厂商官网（名单里的、非社区子域）、investor./ir. 投资者关系页、Google 官方站点
//   - research / media / other：分析机构、媒体、其他。它们是转述，不算一手来源
// 用户上传文档平台和聚合 / 自媒体站点一律是 other（先于一切规则，和定级一致）。

export type SourceCategory = 'regulator' | 'procurement' | 'official' | 'research' | 'media' | 'other';

/** 政府采购 / 公共资源交易 / 招投标公告平台。 */
const PROCUREMENT_DOMAINS: readonly string[] = [
  'ccgp.gov.cn', // 中国政府采购网（及各省 ccgp-*.gov.cn 走政府后缀，再由路径判定）
  'ggzy.gov.cn', // 全国公共资源交易平台
  'cebpubservice.com', // 中国招标投标公共服务平台
  'chinabidding.com.cn', // 中国国际招标网（商务部主管）
  'sam.gov',
  'ted.europa.eu',
  'find-tender.service.gov.uk',
  'contractsfinder.service.gov.uk',
  'tenders.gov.au',
];

/** 路径里的公告页标记（拼音缩写或英文）：招标 / 采购 / 中标公告。 */
const PROCUREMENT_PATH = /(?:^|[/_.-])(?:zbgg|cggg|zbgs|cjgg|zfcg|cgxx|zbxx|gkzb|tender|tenders|procurement|bidding|rfp|rfq)(?:[/_.-]|$)/i;

/** One URL's source type (deterministic, from the URL only). */
export function sourceCategory(url: string | null | undefined): SourceCategory {
  if (!url) return 'other';
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return 'other';
  }
  let host = u.hostname.toLowerCase().replace(/\.$/, '');
  if (host.startsWith('www.')) host = host.slice(4);
  if (!host || isUserUploadPlatform(url) || findDomain(host, AGGREGATOR_DOMAINS)) return 'other';
  if (findDomain(host, PROCUREMENT_DOMAINS) || /^ccgp-[a-z]+\.gov\.cn$/.test(host)) return 'procurement';
  const grade = gradeSource({ url }).grade;
  if (grade !== 'C' && PROCUREMENT_PATH.test(decodeURIComponent(u.pathname))) return 'procurement';
  if (matchesDomain(host, 'edu.cn')) return 'official'; // a university's own site: its own publications, not a regulator
  if (findDomain(host, OFFICIAL_DOMAINS) || findDomain(host, OFFICIAL_SUFFIXES)) return 'regulator';
  if (grade === 'A') return 'official'; // investor./ir., vendor sites, Google official (the remaining A rules)
  if (findDomain(host, RESEARCH_DOMAINS)) return 'research';
  if (findDomain(host, MEDIA_DOMAINS)) return 'media';
  return 'other';
}

/** The types a follow-up's first-hand passes look for (FIRST_HAND_PASSES): 监管规定、招标与采购文件、官方发布. */
export const FIRST_HAND_CATEGORIES: ReadonlySet<SourceCategory> = new Set(['regulator', 'procurement', 'official']);
