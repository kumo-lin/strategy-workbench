/**
 * E: walking the demo path showed a submitted report jumping to step 8 ("决定已确认", with no decision yet), and no
 * way for the owner to submit it. `结论待审` / an open `结论` review is step 6, the Senior's turn; step 8 without a
 * confirmed decision says the report is in the project files.
 */
import { cp, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadWorkspaceFlow } from '@/lib/workflow/load';
import { nextStepFor } from '@/lib/workflow/next-step';
import { computeFlow, type FlowFacts } from '@/lib/workflow/steps';
import { createVault } from '@/lib/vault';

const facts = (over: Partial<FlowFacts> = {}): FlowFacts => ({
  projectConfirmed: true,
  projectOwner: 'Senior',
  owner: 'Junior A',
  reviewer: 'Senior',
  stage: '执行中',
  g1: 'approved',
  unhandledComments: 0,
  research: 'reported',
  decisionDrafted: false,
  decisionConfirmed: false,
  next: { workspace: 'WS-B 用户', owner: 'Junior B' },
  ...over,
});

const next = (over: Partial<FlowFacts>, actor: string) => {
  const f = facts(over);
  return nextStepFor({ facts: f, state: computeFlow(f), actor: { name: actor }, unhandled: 0, base: '/workspace/p/w', investigation: 'inv' });
};

describe('a report handed to the Senior is step 6', () => {
  it('结论待审 is step 6, the Senior’s turn', () => {
    expect(computeFlow(facts({ stage: '结论待审' }))).toMatchObject({ current: 6, who: 'Senior' });
  });
  it('an open 结论 review is step 6 too, whatever the stage says', () => {
    expect(computeFlow(facts({ stage: '执行中', reportReview: 'open' }))).toMatchObject({ current: 6, who: 'Senior' });
  });
  it('a confirmed report is step 7 (存入项目文件, D-64 T30)', () => {
    expect(computeFlow(facts({ stage: '撰写中', reportReview: 'confirmed' }))).toMatchObject({ current: 7 });
  });
});

describe('the next-step sentence while a report waits', () => {
  it('the Senior is asked to confirm it', () => {
    const n = next({ stage: '结论待审' }, 'Senior');
    expect(n).toMatchObject({ step: 6, turn: 'mine' });
    expect(n.text).toContain('提交了报告，等你确认');
    expect(n.action).toMatchObject({ kind: 'link', label: '去确认', href: '/workspace/p/w/research/inv' });
  });
  it('the owner and everyone else wait for the Senior', () => {
    const owner = next({ stage: '结论待审' }, 'Junior A');
    expect(owner).toMatchObject({ step: 6, turn: 'waiting' });
    expect(owner.text).toContain('报告在等 Senior 确认');
    expect(next({ stage: '结论待审' }, 'Junior B')).toMatchObject({ turn: 'waiting', text: expect.stringContaining('报告在等 Senior 确认') });
  });
});

describe('the owner submits the report', () => {
  it('before submitting, the owner is asked to submit it', () => {
    for (const reportReview of [undefined, 'none', 'sent_back'] as const) {
      const n = next({ reportReview }, 'Junior A');
      expect(n).toMatchObject({ step: 3, turn: 'mine', action: { kind: 'link', label: '去读报告', href: '/workspace/p/w/research/inv' } });
      expect(n.text).toContain('提交给 Senior 确认');
    }
  });
  it('the Senior at the same state waits for the owner to submit', () => {
    const n = next({}, 'Senior');
    expect(n).toMatchObject({ step: 3, turn: 'waiting' });
    expect(n.text).toContain('等待中：第 3 步 · 报告已交付');
  });
});

describe('step 7 says what was confirmed', () => {
  it('a confirmed report, no decision: it is in the project files', () => {
    const n = next({ stage: '撰写中', decisionConfirmed: false }, 'Junior B');
    expect(n).toMatchObject({ step: 7, turn: 'done' });
    expect(n.text).toContain('报告已确认，存入项目文件');
    expect(n.text).toContain('WS-B 用户（Junior B）打开“文件管理”就能看到');
  });
  it('a confirmed decision keeps the old sentence', () => {
    const n = next({ stage: '撰写中', decisionConfirmed: true }, 'Senior');
    expect(n.text).toContain('决定已确认');
    expect(n.text).not.toContain('报告已确认');
  });
});

const P = '个人AI战略';
const WS = `20_项目/${P}/WS-A 买方`;
let root = '';
afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
  root = '';
});

describe('loadWorkspaceFlow reads the latest 结论 review', () => {
  it('an open 结论 review makes reportReview open', async () => {
    root = await mkdtemp(path.join(tmpdir(), 'report-step-'));
    await cp('demo-vault/.snapshots/S3-D48', root, { recursive: true });
    await writeFile(
      path.join(root, WS, 'review', '结论 2026-10-26.md'),
      `---
id: ws-a-review-conclusion-2026-10-26
type: review
status: 进行中
created: 2026-10-26T10:00:00.000Z
updated: 2026-10-26T10:00:00.000Z
author: Junior A
derived_from:
  - "[[${WS}/调查/买方采购逻辑（问题树）/报告 v10|报告 v10]]"
relates_to:
  - "[[${WS}/workspace|WS-A 买方]]"
requester: Junior A
reviewer: Senior
result: null
gate: 结论
---

# 结论 2026-10-26

## 提交说明

请确认这份报告。
`,
    );
    expect((await loadWorkspaceFlow(createVault(root), P, WS)).facts.reportReview).toBe('open');
  });
});
