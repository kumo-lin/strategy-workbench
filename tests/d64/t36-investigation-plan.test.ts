/** D-64 T36 (ui-2c): the investigation plan grouped by key question, its competing hypotheses side by side. */
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { afterEach, describe, expect, it } from 'vitest';
import { InvestigationPlanView } from '@/components/research/investigation-plan';
import { planSaveRequestSchema } from '@/lib/research/plan-request';
import { savePlanVersion } from '@/lib/research/plan-save';
import { toEditable, type EditablePlan } from '@/lib/research/plan-types';
import { M1_PLAN } from '@/lib/testing/scripts/m1';
import { ROLES } from '../helpers/fixture-vault';
import { RDIR, setup, WS } from '../m2/research-fixture';

const html = (el: Parameters<typeof renderToString>[0]) => renderToString(el).replace(/<!-- -->/g, '');
const plan = toEditable({ ...M1_PLAN, claims: M1_PLAN.claims.map((c) => ({ ...c, hypothesis: null, sub_questions: [{ id: `${c.id}-Q1`, question: c.question, methods: ['知识库'] as never }] })) } as never);

let cleanup: () => Promise<void> = async () => {};
afterEach(async () => cleanup());

describe('T36 investigation plan', () => {
  it('every text and testid of ui-2c; K3 holds H1, H2, H3 side by side', () => {
    const out = html(createElement(InvestigationPlanView, { plan }));
    for (const t of ['假设驱动', '为什么查', '问题树', '竞争假设，和每个假设要什么证据', '假设', '必须成立的条件', '要什么证据', '去哪里查', '证伪标准']) expect(out, t).toContain(t);
    expect(out).toContain('data-testid="investigation-plan"');
    const group = out.split('data-key="K3"')[1].split('</table>')[0];
    expect([...group.matchAll(/data-testid="hypothesis-row" data-h="(H\d+)"/g)].map((m) => m[1])).toEqual(['H1', 'H2', 'H3']);
    expect(out).toContain('K3');
    expect(out).toContain(M1_PLAN.purpose);
    expect(out).toContain('找控制重度用户后跨设备与单设备没有差异的数据'); // 证伪标准: how it would be shown wrong
  });

  it('the complete M1 plan also renders two competing hypotheses for K1, K2 and K4', () => {
    const out = html(createElement(InvestigationPlanView, { plan }));
    expect([...out.matchAll(/data-key="(K\d)"/g)].map((m) => m[1])).toEqual(['K1', 'K2', 'K3', 'K4']);
    for (const key of ['K1', 'K2', 'K4']) {
      const group = out.split(`data-key="${key}"`)[1].split('</table>')[0];
      expect([...group.matchAll(/data-testid="hypothesis-row"/g)], key).toHaveLength(2);
    }
  });

  it('a plan without key questions is not grouped (older plans keep the editor only)', () => {
    const old: EditablePlan = { ...plan, claims: plan.claims.map(({ key: _k, if_bad: _i, ...c }) => c) };
    expect(html(createElement(InvestigationPlanView, { plan: old }))).toBe('');
  });

  it('the start button reads 计划定了，开始调查 → (start-run); the chat says 和 AI 讨论 · 调查计划', () => {
    expect(readFileSync('components/research/plan-editor.tsx', 'utf8')).toMatch(/data-testid="start-run"[\s\S]{0,400}计划定了，开始调查 →/);
    // 复核 P7: the title follows the step; on the plan step it is 和 AI 讨论 · 调查计划
    const src = readFileSync('components/research/research-workbench.tsx', 'utf8');
    expect(src).toContain("和 AI 讨论 · {CHAT_TITLE[tab] ?? '调查计划'}");
    expect(src).toContain("plan: '调查计划'");
  });

  it('saving an edited plan keeps each hypothesis\' key question and what changes if it is bad', async () => {
    const fx = await setup({ keys: ['K3', 'K3'] });
    cleanup = fx.cleanup;
    const v1 = toEditable((await fx.vault.readTyped(`${RDIR}/计划 v1.md`, 'research_plan')).note);
    expect(v1.claims.map((c) => c.key)).toEqual(['K3', 'K3']);
    const body = planSaveRequestSchema.parse(JSON.parse(JSON.stringify({ workspacePath: WS, researchDir: RDIR, plan: { ...v1, claims: v1.claims.map((c) => ({ ...c, if_bad: '跨设备不作为主打卖点' })) } })));
    const saved = await savePlanVersion({ vault: fx.vault, workspacePath: WS, researchDir: RDIR, role: ROLES.juniorA, plan: body.plan });
    const v2 = (await fx.vault.readTyped(saved.path, 'research_plan')).note;
    expect(v2.claims.map((c) => [c.key, c.if_bad])).toEqual([
      ['K3', '跨设备不作为主打卖点'],
      ['K3', '跨设备不作为主打卖点'],
    ]);
  });
});
