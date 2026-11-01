/** D-64 复核 B1: a Workspace on the project's issue tree (项目.md issue_tree) says where it sits, and which line waits for it. */
import { describe, expect, it } from 'vitest';
import { loadProjectOverview, originOf } from '@/lib/project/overview';
import { createVault } from '@/lib/vault';

const vault = createVault('tests/fixtures/e2e-vault-m1');
const P = '个人AI战略';

describe('复核 B1: origin from the issue tree', () => {
  it('M1 sits on line A, item M1; L2 waits for it', async () => {
    const o = originOf(await loadProjectOverview(vault, P), `20_项目/${P}/M1 用户持续使用`);
    expect(o.line).toEqual({ title: '市场如何演进', item: 'M1 哪些用户会持续使用' });
    expect(o.dependents.map((w) => w.name)).toEqual(['L2 凭什么赢']);
  });
  it('L2 sits on line B and waits for M1', async () => {
    const o = originOf(await loadProjectOverview(vault, P), `20_项目/${P}/L2 凭什么赢`);
    expect(o.line).toEqual({ title: '联想如何选择', item: 'L2 凭什么赢' });
    expect(o.dependents).toEqual([]);
  });
});
