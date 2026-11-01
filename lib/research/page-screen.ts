/**
 * 入库前的第一道过滤（用户 2026-10-30 决定）：搜索结果里明显不是内容的页面——隐私政策、服务条款、登录页、Cookie 设置、
 * 社交平台上的单条帖子——不抓、不入库。真实模型走查时这类页面进了资料库（“Privacy Policy”、一条 X 帖子）。
 * 只看网址和标题，不调用模型；拿不准的放行，交给第二道（抓来以后至少要有一条逐字核对过的原文才入库）。
 */

/** The page's own (last) path segment, whole: not a word inside an article slug like privacy-and-ai-adoption, nor a
 *  section the article sits in (reuters.com/legal/…, investopedia.com/terms/…). */
const SEGMENTS = new Set(['privacy', 'privacy-policy', 'privacypolicy', 'terms', 'terms-of-service', 'terms-of-use', 'tos', 'legal', 'cookie', 'cookies', 'cookie-settings', 'cookie-policy', 'login', 'log-in', 'signin', 'sign-in', 'signup', 'sign-up', 'register', 'account', 'yinsi', 'tiaokuan']);
/** The whole title, or the title up to a site-name separator ("登录 - 某站"); a headline that starts with the words is content. */
const TITLE = /^(privacy policy|terms of (service|use)|cookie (settings|policy)|sign in|log in|login|隐私政策|隐私条款|服务条款|用户协议|登录|注册)(?=$|\s*[-–—|:：·_])/i;
/** Single posts on social platforms: one person's line, not a source a judgment can rest on. */
const SOCIAL = /^(?:www\.)?(?:x\.com|twitter\.com|facebook\.com|instagram\.com|tiktok\.com|threads\.net|weibo\.com)$/i;

/** Why this search result is not worth fetching, or null when it may be content. */
export function nonContentReason(r: { url: string; title: string }): string | null {
  let url: URL;
  try {
    url = new URL(r.url);
  } catch {
    return '网址读不出来';
  }
  if (SOCIAL.test(url.hostname)) return '社交平台上的单条帖子';
  const last = url.pathname.toLowerCase().split('/').filter(Boolean).at(-1) ?? '';
  if (SEGMENTS.has(last.replace(/\.(html?|php|aspx?)$/, ''))) return '隐私、条款或登录这类页面';
  if (TITLE.test(r.title.trim())) return '隐私、条款或登录这类页面';
  return null;
}
