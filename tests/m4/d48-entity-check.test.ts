/**
 * D-48 round 4 (C): entity-check — a footnote whose source has none of the names and numbers of its clause is flagged
 * (entity_flags), deterministic, nothing changed in the report.
 */
import { describe, expect, it } from 'vitest';
import { entitiesOf, entityFlags, missingFrom, type FootnoteSource } from '@/lib/research/entity-check';

const src = (ref: string, text: string): FootnoteSource => ({ ref, text });

describe('entitiesOf', () => {
  it('glossary names in either form, Latin names, numbers; generic terms, lower-case words and own ids left out', () => {
    const e = entitiesOf('微软 Intune 和 Agent 365 管 AI PC 与 IT，agent 在 H2-1 里，份额 24.2%[^5][E3]');
    expect(e.names.map((n) => n[0])).toEqual(['微软']);
    expect(e.latin).toEqual(['Intune', 'Agent 365']);
    expect(e.numbers.map((t) => t.raw)).toEqual(['24.2%']);
  });
});

describe('missingFrom: none of them in the source', () => {
  it('a name in its other form counts; case and spacing do not matter', () => {
    expect(missingFrom('微软每用户每月 30 美元', 'Microsoft 365 Copilot costs $30 per user per month')).toEqual([]);
    expect(missingFrom('戴尔有完整带外管理', 'DELL | Full (requires vPro)')).toEqual([]);
    expect(missingFrom('用 Trus cale 计费', 'TruScale 按月计费')).toEqual([]);
  });

  it('one of several found is enough; none found: all listed', () => {
    expect(missingFrom('微软 Intune 管 18% 的机队', 'Intune 部署')).toEqual([]);
    expect(missingFrom('微软每用户每月 90.45 美元起', '基于已建成的 OA 系统，对 WPS AI 智能办公平台实施部署')).toEqual(['微软', '90.45']);
  });

  it('numbers as number-check reads them: 22% against 两成, 1.2 亿 against 120 million', () => {
    expect(missingFrom('占 22%', '约两成企业')).toEqual([]);
    expect(missingFrom('收入 1.2 亿美元', 'revenue of $120 million')).toEqual([]);
    expect(missingFrom('占 40%', '约两成企业')).toEqual(['40%']);
  });

  it('a clause with no name and no number: not checked', () => {
    expect(missingFrom('服务收入占比高证据不足', '份额 24.2%')).toEqual([]);
  });
});

describe('entityFlags over a report', () => {
  const body = [
    '# R',
    '',
    '## Summary',
    '- 回答（一句话）：付钱的是微软席位[^1]，惠普也有[^2]。',
    '',
    '| | 提议 |',
    '|---|---|',
    '| 看什么指标 | 看单价<br>依据：微软[^3] 每用户每月 90.45 美元起[^1] |',
    '',
    '## Q1 谁付钱',
    '',
    '### 假设 H1：IT 付钱',
    '- 回答：IT 付钱，惠普 18%[^2]',
    '- 理由：',
    '  - 戴尔 Dell 也是[^4]',
    '- 支持的证据：',
    '  - 联想 99%[^4]',
    '',
    '## 引文出处',
    '[^1]: x',
  ].join('\n');
  const sources = new Map([
    ['1', src('[[微软定价#^c1]]', 'Microsoft 365 E5 $90.45 per user/month\n微软定价\nMicrosoft')],
    ['2', src('[[惠普年报#^c2]]', 'HP shipped 18% more\n惠普年报\nHP Inc')],
    ['3', src('[[WPS 招标#^c1]]', '对 WPS AI 智能办公平台实施部署\nWPS 招标\n云之龙')],
    ['4', src('[[IDC 报告#^c9]]', '市场份额排名\nIDC 报告\nIDC')],
  ]);

  it('the cell\'s "微软[^3]" over a WPS tender, the reason "戴尔 Dell" over an IDC ranking; bound to the block link; 支持的证据 not checked', () => {
    expect(entityFlags(body, sources)).toEqual([
      { key: '[[WPS 招标#^c1]]', footnote: '[^3]', sentence: '微软', missing: ['微软'] },
      { key: '[[IDC 报告#^c9]]', footnote: '[^4]', sentence: '戴尔 Dell 也是', missing: ['戴尔'] },
    ]);
  });
});
