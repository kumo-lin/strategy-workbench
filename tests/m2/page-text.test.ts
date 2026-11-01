import { expect, it } from 'vitest';
import { unescapeMarkdown } from '@/lib/research/page-text';

it('unescapes markdown escapes in fetched page text', () => {
  expect(unescapeMarkdown('『情報システム・IT部門』が32\\.1\\%、*強調*は\\*そのまま\\*')).toBe('『情報システム・IT部門』が32.1%、*強調*は*そのまま*');
});

import { isForeignScript } from '@/lib/research/run';

it('pages in kana / Hangul / Cyrillic are recognised so they can be ranked last (Search has no language parameter)', () => {
  expect(isForeignScript('官公需情報ポータルサイト 調達')).toBe(true);
  expect(isForeignScript('Закупки 2026')).toBe(true);
  expect(isForeignScript('企业 AI PC 采购 可管理性 Intel vPro')).toBe(false);
});
