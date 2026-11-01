/** Spec 5a-T7: the prefilled summary and focus for the "发给 Senior 征求意见" dialog. */
import { describe, expect, it } from 'vitest';
import { suggestSend } from '@/lib/workplan/send-draft';

const BODY = [
  '# Workplan',
  '',
  '## 要回答的问题与要支撑的决策',
  '',
  '为什么 **联想** 能赢？[[资料|联想能赢]]',
  '第二行，保持原样。',
  '',
  '空白行后的一段 `代码`。',
  '',
  '## 前提',
  '',
  '这是一段不该被选中的话。',
  '',
  '## 风险和待确认',
  '',
  '- [[资料|假设 H1]] 能不能被证伪',
  '- 数据够不够',
  '* 有没有反证',
  '1. 时间够不够',
  '- 第五条',
  '',
  '## next action',
  '',
  '- 不相关',
].join('\n');

describe('suggestSend', () => {
  it('takes the summary from the question section, cleaned', () => {
    expect(suggestSend(BODY).summary).toBe(
      '为什么 联想 能赢？联想能赢\n第二行，保持原样。\n\n空白行后的一段 代码。',
    );
  });

  it('takes the first four risk bullets, in order, each at most 120 characters', () => {
    const { focus } = suggestSend(BODY);
    expect(focus).toEqual(['假设 H1 能不能被证伪', '数据够不够', '有没有反证', '时间够不够']);
    expect(focus.every((item) => item.length <= 120)).toBe(true);
  });

  it('keeps exactly four bullets and cuts a long one to 120 characters', () => {
    const long = '长'.repeat(130);
    const body = ['## 风险和待确认', '', '- 一', '- 二', '- 三', '- 四', '- 五', `- ${long}`].join('\n');
    const { focus } = suggestSend(body);
    expect(focus).toHaveLength(4);
    expect(focus).toEqual(['一', '二', '三', '四']);

    const one = suggestSend(`## 风险和待确认\n\n- ${long}`);
    expect(one.focus[0]).toHaveLength(120);
    expect(one.focus[0]).toBe('长'.repeat(120));
  });

  it('falls back for a missing risk section', () => {
    expect(suggestSend('## 要回答的问题与要支撑的决策\n\n问题。').focus).toEqual([
      '假设能不能被证伪',
      '要回答的问题有没有说清',
    ]);
  });

  it('falls back to the first paragraph when the question section is missing', () => {
    const body = ['# Workplan', '', '第一段第一行。', '第一段第二行。[[资料|别名]]', '', '第二段。'].join('\n');
    expect(suggestSend(body).summary).toBe('第一段第一行。\n第一段第二行。别名');
  });

  it('returns the fallbacks for an empty body', () => {
    expect(suggestSend('')).toEqual({
      summary: '请看这份 workplan。',
      focus: ['假设能不能被证伪', '要回答的问题有没有说清'],
    });
  });

  it('cuts a long summary to at most 600 characters at a 。 within the last 120', () => {
    const text = '甲'.repeat(590) + '。' + '乙'.repeat(50);
    const { summary } = suggestSend(`## 要回答的问题与要支撑的决策\n\n${text}\n`);
    expect(summary.length).toBeLessThanOrEqual(600);
    expect(summary).toBe('甲'.repeat(590) + '。');
    expect(summary.endsWith('。')).toBe(true);
  });
});
