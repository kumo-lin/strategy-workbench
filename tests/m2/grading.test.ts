/** 2.5 — source grading rules (PRD §9.4): A 一手资料, B 研究机构/主流财经媒体, C 其他; `authority` is a reference only. */
import { describe, expect, it } from 'vitest';
import { gradeSource } from '@/lib/research/grading';

const grade = (url: string, authority?: number | null) => gradeSource({ url, authority }).grade;

describe('gradeSource', () => {
  it.each([
    ['https://www.stats.gov.cn/sj/zxfb/202509/t1.html', 'A'], // 官方统计
    ['https://www.sec.gov/Archives/edgar/data/1/x.htm', 'A'], // 监管文件
    ['https://www.miit.gov.cn/jgsj/x.html', 'A'],
    ['https://www.hkexnews.hk/listedco/x.pdf', 'A'], // 披露易
    ['https://www.cninfo.com.cn/new/x', 'A'],
    ['https://investor.lenovo.com/en/x.pdf', 'A'], // 厂商 IR / 财报
    ['https://news.microsoft.com/x', 'A'], // 厂商官方发布
    ['https://www.intel.com/content/www/us/en/newsroom/x.html', 'A'],
    ['https://www.idc.com/getdoc.jsp?containerId=x', 'B'], // 研究机构
    ['https://www.gartner.com/en/newsroom/x', 'B'],
    ['https://canalys.com/newsroom/x', 'B'],
    ['https://www.counterpointresearch.com/insights/x', 'B'],
    ['https://www.mckinsey.com/capabilities/x', 'B'],
    ['https://www.reuters.com/technology/x', 'B'], // 主流财经媒体
    ['https://www.bloomberg.com/news/x', 'B'],
    ['https://www.ft.com/content/x', 'B'],
    ['https://www.yicai.com/news/x.html', 'B'],
    ['https://www.caixin.com/2026-01-01/x.html', 'B'],
    ['https://zhuanlan.zhihu.com/p/1', 'C'], // 其他
    ['https://medium.com/@x/y', 'C'],
    ['https://some-random-blog.example.org/post', 'C'],
    ['https://mp.weixin.qq.com/s/x', 'C'],
  ])('%s → %s', (url, expected) => {
    expect(grade(url)).toBe(expected);
  });

  it('subdomains inherit the registrable domain; look-alike domains do not', () => {
    expect(grade('https://news.cn.reuters.com/x')).toBe('B');
    expect(grade('https://notreuters.com/x')).toBe('C');
    expect(grade('https://reuters.com.evil.example/x')).toBe('C');
    expect(grade('https://gov.cn.fake.example/x')).toBe('C');
  });

  it('authority is a reference only: it never changes the grade', () => {
    expect(grade('https://some-random-blog.example.org/post', 5)).toBe('C');
    expect(grade('https://www.reuters.com/x', 1)).toBe('B');
  });

  it.each([
    ['https://podcasts.apple.com/us/podcast/x/id1', 'C'], // 播客不是厂商官方
    ['https://music.apple.com/x', 'C'],
    ['https://discussions.apple.com/thread/1', 'C'],
    ['https://community.intel.com/t5/x', 'C'],
    ['https://answers.microsoft.com/x', 'C'],
    ['https://news.google.com/articles/x', 'C'],
    ['https://podcasts.google.com/feed/x', 'C'],
    ['https://www.youtube.com/watch?v=1', 'C'],
    ['https://open.spotify.com/episode/x', 'C'],
    ['https://www.msn.com/en-us/news/x', 'C'],
    ['https://www.apple.com/newsroom/2026/x', 'A'], // 官方发布仍然是 A
    ['https://news.microsoft.com/x', 'A'], // 注意：这个 news. 是微软新闻室，不在排除标签里被误伤
    ['https://www.theregister.com/2024/11/x', 'B'], // 主流科技媒体 B
    ['https://www.theverge.com/x', 'B'],
    ['https://venturebeat.com/ai/x', 'B'],
    ['https://www.36kr.com/p/1', 'B'],
  ])('refined lists: %s → %s', (url, expected) => {
    expect(grade(url)).toBe(expected);
  });

  it('returns a human-readable reason and never throws on a bad URL', () => {
    expect(gradeSource({ url: 'https://www.sec.gov/x' }).reason.length).toBeGreaterThan(0);
    expect(gradeSource({ url: 'not a url' })).toMatchObject({ grade: 'C' });
  });
});
