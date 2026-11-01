/** 复核: the M1 script's decision draft cites, for each reason, the source that says it (v6 2.11) — not whatever comes first. */
import { describe, expect, it } from 'vitest';
import { m1DecisionAnswer } from '@/lib/testing/scripts/m1';

const prompt = [
  '## 本 Workspace：M1 用户持续使用',
  '- [[Ping Identity 2026-06 Consumer Survey AI Trust#^c1]]（B 级，知识库）',
  '- [[联想 2026-01 Qira发布#^c3]]（A 级，知识库）',
  '- [[Pew 2026-06 Why Don’t People Use Chatbots#^c2]]（A 级，知识库）',
].join('\n');

describe('M1 decision draft citations', () => {
  it('① adoption → Pew, ② cross-device value → Qira, ③ assistance over autonomy → Ping', () => {
    const d = m1DecisionAnswer(prompt) as { reasons: { text: string; cites: string[] }[] };
    expect(d.reasons.map((r) => r.cites[0])).toEqual([
      '[[Pew 2026-06 Why Don’t People Use Chatbots#^c2]]',
      '[[联想 2026-01 Qira发布#^c3]]',
      '[[Ping Identity 2026-06 Consumer Survey AI Trust#^c1]]',
    ]);
    expect(d.reasons[2].text).toContain('辅助');
  });
});
