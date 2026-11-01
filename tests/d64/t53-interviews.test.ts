/** D-64 T53: the simulated minutes and the three simulated interview records of the M1 demo. */
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createVault } from '@/lib/vault';

const interviews = createVault(path.resolve('demo-vault/.snapshots/m1-qira-interviews'));
const m1 = createVault(path.resolve('demo-vault/.snapshots/m1-qira'));
const DIR = '20_项目/个人AI战略/访谈';

describe('T53 interviews', () => {
  it('three interview records: valid meetings of kind 访谈, simulated, with no percentage retention figure', async () => {
    const files = (await interviews.list(DIR)).filter((e) => e.kind === 'file');
    expect(files.map((f) => f.name).sort()).toEqual(['访谈-Qira 产品分析负责人.md', '访谈-多设备重度用户.md', '访谈-隐私与信任团队负责人.md'].sort());
    for (const f of files) {
      const { note, body } = await interviews.readTyped(f.path, 'meeting');
      expect(note).toMatchObject({ kind: '访谈', simulated: true });
      expect(body).not.toMatch(/\d+(\.\d+)?\s*[%％]/);
    }
  });

  it('what they say: cross-device only for "prepare on the PC, follow up on the phone"; calendar yes, sending email no', async () => {
    const all = (await Promise.all((await interviews.list(DIR)).map((f) => interviews.read(f.path)))).map((n) => n.body).join('\n');
    expect(all).toContain('电脑上准备');
    expect(all).toContain('手机上跟进');
    expect(all).toContain('愿意授权日历');
    expect(all).toContain('不愿意让 AI 代发邮件');
  });

  it('the minutes of the direction meeting are a simulated meeting of kind 会议', async () => {
    const { note } = await m1.readTyped('20_项目/个人AI战略/会议/2027 个人 AI 战略方向会（模拟）.md', 'meeting');
    expect(note).toMatchObject({ kind: '会议', simulated: true });
  });
});
