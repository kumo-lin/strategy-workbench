import { describe, expect, it } from 'vitest';
import { plainChatText, preprocessChatText, wikiLabel } from '@/components/chat/rich-text';

describe('wikiLabel', () => {
  it('alias wins; else the last path segment; block refs keep the block id', () => {
    expect(wikiLabel('20_项目/P/WS-A/workplan v1|workplan v1')).toEqual({ target: '20_项目/P/WS-A/workplan v1', label: 'workplan v1' });
    expect(wikiLabel('WS-A-H1 IT 可管理性')).toEqual({ target: 'WS-A-H1 IT 可管理性', label: 'WS-A-H1 IT 可管理性' });
    expect(wikiLabel('20_项目/P/WS-A/review/G1 2026-10-24#^m1').label).toBe('G1 2026-10-24 · m1');
    expect(wikiLabel('示例资料-AI PC 企业采购#^c1|资料甲#c1').label).toBe('资料甲#c1');
    expect(wikiLabel('a/b.md').label).toBe('b');
  });
});

describe('preprocessChatText', () => {
  it('turns ==x== into a mark link and [[x]] into a wiki link', () => {
    const out = preprocessChatText('这是==关键判断==，见 [[20_项目/P/WS-A/workplan v1|workplan v1]]。');
    expect(out).toContain('[关键判断](#sw-mark)');
    expect(out).toContain('[workplan v1](#sw-wiki:20_%E9%A1%B9');
    expect(out).not.toContain('[[');
    expect(out).not.toContain('==');
  });

  it('handles block refs and several links on one line', () => {
    const out = preprocessChatText('[[a/G1 2026-10-24#^m1]] 和 [[H1]]');
    expect(out).toMatch(/^\[G1 2026-10-24 · m1\]\(#sw-wiki:a%2FG1%202026-10-24%23%5Em1\) 和 \[H1\]\(#sw-wiki:H1\)$/);
  });

  it('leaves code spans and fences alone', () => {
    const src = '`==x== [[y]]`\n\n```\n==a== [[b]]\n```\n外面 ==z==';
    const out = preprocessChatText(src);
    expect(out).toContain('`==x== [[y]]`');
    expect(out).toContain('```\n==a== [[b]]\n```');
    expect(out).toContain('[z](#sw-mark)');
  });

  it('does not treat a lone == or an operator as a mark; escapes brackets in labels', () => {
    expect(preprocessChatText('a == b 和 x==y')).toBe('a == b 和 x==y');
    expect(preprocessChatText('[[x[1]|a]]')).toBe('[[x[1]|a]]'); // not a valid wikilink: left as is
    expect(preprocessChatText('[[文件|名(称)]]')).toContain('[名\\(称\\)](#sw-wiki:');
  });

  it('is a no-op for plain text', () => {
    expect(preprocessChatText('没有标记')).toBe('没有标记');
  });
});

describe('plainChatText (what a person sent, as their bubble shows it)', () => {
  it('shows a link to a vault file by its name, never the path or the [[ #^ syntax (走查截图 2.4)', () => {
    const sent = '请帮我解读这条意见（G1 2026-10-30）：\n「不要把跨设备当成普遍价值」\n[[20_项目/个人AI战略/M1 用户持续使用/review/G1 2026-10-30#^m1]]';
    const shown = plainChatText(sent);
    expect(shown).toBe('请帮我解读这条意见（G1 2026-10-30）：\n「不要把跨设备当成普遍价值」\nG1 2026-10-30 · m1');
    expect(shown).not.toMatch(/\[\[|#\^|20_项目/);
  });

  it('leaves plain text alone', () => {
    expect(plainChatText('TechRadar 那篇讲企业采购的，和 M1 有关吗？')).toBe('TechRadar 那篇讲企业采购的，和 M1 有关吗？');
  });
});
