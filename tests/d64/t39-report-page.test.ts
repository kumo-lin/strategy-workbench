/** D-64 T39 (ui-4a, ui-4b): the report page in the fixed structure, and the citation popover (three checks, can / cannot). */
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CitationPopover, ReportViewer } from '@/components/research/report-viewer';
import { readCitationVerify } from '@/lib/report/citation-verify';
import type { CitationDetail } from '@/lib/research/citation-types';

const html = (el: Parameters<typeof renderToString>[0]) => renderToString(el).replace(/<!-- -->/g, '');
const LINK = '[[Pew 2026-06 Americans and AI 2026#^c2]]';
const md = [
  '# M1 调查报告 v1',
  '',
  '## So what',
  '',
  '用的人多，天天用的人少[^1]',
  '',
  '## 为什么（三条支撑）',
  '',
  '1. 用的人多，天天用的人少',
  '   - 事实：每天用的只有 24%[^1]（Pew 2026）',
  '2. Qira 布局到位，价值未证明',
  '   - 推断：80 多种配置只证明供给（Lenovo StoryHub）',
  '3. 用户要帮忙，不要失控',
  '   - 访谈支持：日历可以给它看（访谈-重度用户）',
  '',
  '## 缺乏信息、需要另外验证的问题',
  '',
  '| 问题 | 公开资料缺什么 | 怎么验证 |',
  '|---|---|---|',
  '| K3 跨设备是否解决重复出现的真实问题？ | 没有留存对比 | 产品数据 |',
  '',
  '## 对联想的建议',
  '',
  '1. 先找出会持续使用的任务（依据 K3）',
  '',
  '## 附录：过程和证据',
  '',
  '- 下面是这次调查的完整记录。',
  '',
  '## 引文出处',
  `[^1]: “roughly one-in-four who use these tools on daily basis”（A 级，Pew）${LINK}`,
].join('\n');
const citation: CitationDetail = {
  link: LINK,
  ok: true,
  sourceName: 'Pew 2026-06 Americans and AI 2026',
  publisher: 'Pew Research Center',
  published: '2026-06-17',
  url: 'https://www.pewresearch.org/x',
  grade: 'A',
  blockText: '「This includes roughly one-in-four who use these tools on daily basis.」— 位置：The key takeaways 第 1 条',
  quote: 'This includes roughly one-in-four who use these tools on daily basis.',
} as CitationDetail;
const verify = readCitationVerify({
  citation_verify: {
    items: [{ footnote: '[^1]', ref: LINK, sentence: '每天用的只有 24%', verified: true, can: '美国成年人每天使用的比例', cannot: '其他市场的使用率', entity: { pass: true, missing: [] }, deepseek: { fit: '撑得住', reason: '原文直接说了', can: '美国成年人每天使用的比例', cannot: '其他市场的使用率' }, kimi: { fit: '撑得住', reason: '对得上' } }],
  },
});

describe('T39 report page', () => {
  it('ui-4a: So what, at most three reasons with their kind, the gap table, the next step', () => {
    const out = html(createElement(ReportViewer, { markdown: md, citations: { [LINK]: citation }, citationVerify: verify, delivery: '已交付', versions: [{ path: 'p', name: '报告 v1' }] }));
    for (const t of ['报告 v1', 'So what', '为什么（三条支撑）', '缺乏信息、需要另外验证的问题', '问题', '公开资料缺什么', '怎么验证', '下一步：看访谈建议 →']) expect(out, t).toContain(t);
    expect(out).toContain('data-testid="report-sowhat"');
    expect(out.match(/data-testid="report-reason"/g)).toHaveLength(3);
    expect([...out.matchAll(/data-testid="basis-tag" data-kind="([^"]+)"/g)].map((m) => m[1])).toEqual(['事实', '推断', '访谈支持']);
    expect(out).toContain('data-testid="gap-table"');
  });

  it('ui-4b: the popover — the sentence, the original in context, three checks, can, cannot, the web page, close', () => {
    expect(verify[0]).toMatchObject({ can: '美国成年人每天使用的比例', cannot: '其他市场的使用率' });
    const out = html(createElement(CitationPopover, { citation, verify: verify[0], onClose: () => {} }));
    for (const t of ['报告引用的这一句', '每天用的只有 24%', '原文上下文', '三道核验', '能支持', '不能支持', '打开原网页', '关闭', 'A', '2026-06-17', 'The key takeaways 第 1 条']) expect(out, t).toContain(t);
    for (const id of ['cite-popover', 'cite-checks', 'cite-can', 'cite-cannot']) expect(out).toContain(`data-testid="${id}"`);
  });
});
