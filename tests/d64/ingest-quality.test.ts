/**
 * 入库前的质量过滤（用户 2026-10-30 决定，真实模型走查发现）：联网补查曾把 “Privacy Policy”、一条 X 帖子这类页面
 * 存进资料库。资料库只收能给问题提供原文证据的资料：明显不是内容的页面不抓；抓来的页面先提取、逐字核对，
 * 至少留下一条原文才入库。
 */
import { describe, expect, it } from 'vitest';
import { nonContentReason } from '@/lib/research/page-screen';

describe('入库前过滤：明显不是内容的页面不抓', () => {
  it.each([
    ['https://example.com/privacy-policy', 'Privacy Policy'],
    ['https://example.com/legal/terms-of-service', 'Terms of Service'],
    ['https://example.com/login?next=/a', 'Sign in'],
    ['https://x.com/deedydas/status/1', 'Deedy (@deedydas) on X'],
    ['https://twitter.com/a/status/2', 'post'],
    ['https://www.example.cn/about/yinsi', '隐私政策'],
    ['https://example.com/cookie-settings', 'Cookie settings'],
    ['https://example.com/account/login', 'Welcome back'],
    ['https://example.cn/passport', '登录'],
    ['https://example.cn/agreement', '用户协议 - 某站'],
  ])('%s', (url, title) => {
    expect(nonContentReason({ url, title })).toBeTruthy();
  });
  it.each([
    ['https://www.pewresearch.org/internet/2026/06/americans-and-ai/', 'Americans and AI 2026'],
    ['https://news.lenovo.com/pressroom/press-releases/qira/', 'Lenovo Qira launch'],
    ['https://www.example.com/blog/privacy-and-ai-adoption-survey', 'Survey: privacy concerns slow AI adoption'],
    // pre-merge review: a section named like a legal page is not one
    ['https://www.reuters.com/legal/litigation/microsoft-ai-pc-case-2026-05-01/', 'Microsoft faces AI PC case'],
    ['https://www.investopedia.com/terms/a/artificial-intelligence-ai.asp', 'Artificial Intelligence (AI): What It Is'],
    ['https://example.com/news/2026/privacy-policy-changes', 'Privacy policy changes at Meta spark backlash'],
  ])('keeps a content page: %s', (url, title) => {
    expect(nonContentReason({ url, title })).toBeNull();
  });
});

describe('入库前过滤：一次真实的调查执行', () => {
  it('junk results are never fetched; a page with nothing checkable is fetched but not stored; a real page is stored', async () => {
    const { executeResearch } = await import('@/lib/research/execute');
    const { scriptedModel, setup } = await import('../m2/research-fixture');
    const fx = await setup();
    try {
      const fetched: string[] = [];
      let n = 0;
      const web = {
        searches: [] as string[],
        fetches: fetched,
        async search({ query }: { query: string }) {
          web.searches.push(query);
          const k = ++n;
          const r = (url: string, title: string, score: number) => ({ url, title, site_name: 'site', date: '2026-09-01T00:00:00Z', summary: title, rerank_score: score, authority: 3 });
          return { results: [r(`https://example.com/privacy-policy?${k}`, 'Privacy Policy', 0.99), r(`https://x.com/someone/status/${k}`, 'someone on X', 0.98), r(`https://empty${k}.com/report/${k}`, `空页 ${k}`, 0.97), r(`https://site${k}-research.com/report/${k}`, `报告 ${k}`, 0.9)] };
        },
        async fetch({ url }: { url: string }) {
          fetched.push(url);
          if (url.includes('empty')) return { title: '空页', content: '   ' };
          return { title: '报告', content: `调研显示，企业里 IT 部门主导了 AI PC 的采购决策（${url}）。` };
        },
      };
      await executeResearch({ ctx: fx.ctx, mode: 'full', model: scriptedModel().model, webClient: web as never });
      expect(fetched.some((u) => /privacy-policy|x\.com/.test(u))).toBe(false);
      expect(fetched.some((u) => u.includes('empty'))).toBe(true);
      const stored = await Promise.all((await fx.vault.list('10_资料库')).filter((e) => e.kind === 'file').map((e) => fx.vault.read(e.path)));
      const urls = stored.map((s) => String(s.data.url ?? ''));
      expect(urls.some((u) => /privacy-policy|x\.com|empty/.test(u))).toBe(false);
      expect(urls.some((u) => u.includes('-research.com'))).toBe(true);
      expect((await fx.vault.readLog(fx.ctx.logPath)).some((l) => l.action === 'research:not-ingested')).toBe(true);
    } finally {
      await fx.cleanup();
    }
  });
});
