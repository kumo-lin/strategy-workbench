import { describe, expect, it } from 'vitest';
import { reportSchema } from '@/lib/notes/schema';

const base = {
  id: 'report-web-r1',
  type: 'report',
  status: '推断',
  created: '2026-10-25',
  updated: '2026-10-25',
  author: 'AI',
  derived_from: ['[[项目]]'],
  relates_to: ['[[项目]]'],
  version: 1,
  research_plan: null,
  exploratory: true,
};

describe('report mode', () => {
  it('accepts the DeepSeek web-app answer as web_baseline (D-22)', () => {
    expect(reportSchema.safeParse({ ...base, mode: 'web_baseline' }).success).toBe(true);
  });

  it('still rejects an unknown mode', () => {
    expect(reportSchema.safeParse({ ...base, mode: 'web' }).success).toBe(false);
  });
});
