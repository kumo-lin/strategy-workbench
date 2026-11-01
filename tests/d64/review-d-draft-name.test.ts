/**
 * 接手卡 #3：Senior 退回（status「已否决」）一份决定后，AI 再起草同名决定时另存「第 N 稿」，
 * 退回记录原样保留。退回是历史事实，不能被覆盖；再起草也不是覆盖，而是同一件事的下一稿。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { proposeDecision, type DraftModelInfo } from '@/lib/decisions/propose';
import type { ProposeDecisionArgs } from '@/lib/decisions/schema';
import { executeTool } from '@/lib/harness';
import type { Vault } from '@/lib/vault';
import { ctxFor, DECISIONS, GOOD_DRAFT, makeM3Vault, REPORT, ROLES } from '../m3/fixture';

let vault: Vault;
let cleanup: () => Promise<void>;
beforeEach(async () => {
  ({ vault, cleanup } = await makeM3Vault());
});
afterEach(async () => cleanup());

const draftPath = `${DECISIONS}/${GOOD_DRAFT.name}.md`;
const secondPath = `${DECISIONS}/${GOOD_DRAFT.name}（第 2 稿）.md`;
const thirdPath = `${DECISIONS}/${GOOD_DRAFT.name}（第 3 稿）.md`;
const propose = async (extra: Record<string, unknown> = {}) =>
  (await executeTool('propose_decision', { ...GOOD_DRAFT, report: REPORT, why: '起草', ...extra }, await ctxFor(vault, ROLES.senior))) as { path: string; replaced: boolean; model: string | null };

/** 走产品里的退回路径：Senior 退回后，文件状态是「已否决」，理由留在 return_reason。 */
async function returnDraft(path: string, reason = '证据不够，别先写死') {
  const n = await vault.read(path);
  await vault.write(path, { frontmatter: { ...n.data, status: '已否决', decided_by: 'Senior', return_reason: reason }, body: n.body }, { overwrite: true });
}

describe('#3 退回后再起草', () => {
  it('另存为「第 2 稿」，退回记录一个字节不动', async () => {
    const first = await propose();
    expect(first.path).toBe(draftPath);
    await returnDraft(draftPath);
    const before = await vault.read(draftPath);

    const again = await propose();
    expect(again.path).toBe(secondPath);
    expect(again.replaced).toBe(false);

    const after = await vault.read(draftPath);
    expect(after.data.status).toBe('已否决');
    expect(after.data.return_reason).toBe('证据不够，别先写死');
    expect(after.body).toBe(before.body);

    const second = await vault.read(secondPath);
    expect(second.data).toMatchObject({ type: 'decision', status: '推断', author: 'AI', decided_by: null });
    expect(second.data.derived_from).toEqual(['[[20_项目/P/WS-A/调查/R1/报告 v1|报告 v1]]']);
    expect(second.body).toContain(`# ${GOOD_DRAFT.name}（第 2 稿）`);
  });

  it('连续退回两次，落到「第 3 稿」', async () => {
    await propose();
    await returnDraft(draftPath);
    const second = await propose();
    expect(second.path).toBe(secondPath);
    await returnDraft(secondPath);
    const third = await propose();
    expect(third.path).toBe(thirdPath);
    expect((await vault.read(secondPath)).data.status).toBe('已否决');
  });

  it('已确认的决定仍然不许覆盖', async () => {
    const first = await propose();
    const n = await vault.read(first.path);
    await vault.write(first.path, { frontmatter: { ...n.data, status: '已确认', decided_by: 'Senior' }, body: n.body }, { overwrite: true });
    await expect(propose()).rejects.toThrow(/不能覆盖/);
  });

  it('同一模型重起草自己的推断稿，仍是原地替换', async () => {
    const first = await propose();
    const again = await propose();
    expect(again.path).toBe(first.path);
    expect(again.replaced).toBe(true);
  });

  it('两个模型各自起草，仍按模型名区分而不是稿号', async () => {
    const ctx = await ctxFor(vault, ROLES.senior);
    const args = { ...GOOD_DRAFT, report: REPORT, why: '起草' } as unknown as ProposeDecisionArgs;
    const claude: DraftModelInfo = { providerId: 'p1', label: 'Claude', model: 'claude-x' };
    const sol: DraftModelInfo = { providerId: 'p2', label: 'Sol', model: 'sol-6.1' };
    await proposeDecision(args, { ...ctx, draftModel: claude });
    const second = await proposeDecision(args, { ...ctx, draftModel: sol });
    expect(second.path).toBe(`${DECISIONS}/${GOOD_DRAFT.name}（Sol）.md`);
    expect((await vault.read(draftPath)).data.drafted_by_model).toBe('Claude（claude-x）');
  });
});

describe('复核 P11: a long name keeps its suffix', () => {
  it('the base is shortened, never 「（第 N 稿）」', async () => {
    const { withSuffix } = await import('@/lib/decisions/propose');
    const long = '跨'.repeat(70);
    expect(withSuffix(long, '（第 2 稿）')).toMatch(/（第 2 稿）$/);
    expect(withSuffix(long, '（第 2 稿）').length).toBeLessThanOrEqual(60);
    expect(withSuffix(long, '（第 2 稿）')).not.toBe(withSuffix(long, '（第 3 稿）'));
    expect(withSuffix('短名字', '（第 2 稿）')).toBe('短名字（第 2 稿）');
  });
});
