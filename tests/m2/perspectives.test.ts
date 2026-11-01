/**
 * D-32 perspective coverage: the team config lists the perspectives a research plan must cover; every claim (or
 * sub-question) names its perspectives; one not covered and not explained is flagged on the plan page (not blocking).
 * Field comparison only.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { afterEach, describe, expect, it } from 'vitest';
import { PlanEditor } from '@/components/research/plan-editor';
import { addSubQuestion, togglePerspective, updateSubQuestion } from '@/components/research/plan-edit-utils';
import { loadPerspectives } from '@/lib/config/perspectives';
import { researchPlanPrompt } from '@/lib/harness/prompts/research-plan';
import { researchPlanSchema } from '@/lib/notes/schema';
import { perspectiveGaps, unknownPerspectives } from '@/lib/research/perspectives';
import { checkPlanDraft } from '@/lib/research/plan-checks';
import { savePlanVersion } from '@/lib/research/plan-save';
import { renderPlanBody, toEditable, type EditablePlan } from '@/lib/research/plan-types';
import { createVault } from '@/lib/vault';
import { parseMarkdown } from '@/lib/vault/frontmatter';
import { ROLES } from '../helpers/fixture-vault';
import { RDIR, setup, WS } from './research-fixture';

const LIST = ['买方', '竞争对手', '我方自身的布局', '监管', '技术供给'];
const claim = (id: string, perspective?: string[]) => ({ id, statement: 's', hypothesis: null, conditions: [], sub_questions: [{ id: `${id}-Q1`, question: 'q', methods: ['知识库' as const] }], counter_search: 'c', ...(perspective ? { perspective } : {}) });
const plan = (claims: ReturnType<typeof claim>[], skipped?: { perspective: string; reason: string }[]): EditablePlan => ({ question: 'q', purpose: 'p', claims, ...(skipped ? { perspectives_skipped: skipped } : {}) });

let cleanup: (() => Promise<void>) | null = null;
afterEach(async () => {
  await cleanup?.();
  cleanup = null;
});

describe('the team list', () => {
  it('团队.md lists the five; the people-readable section names the same ones (both team files)', async () => {
    expect(await loadPerspectives(createVault('demo-vault'))).toEqual(LIST);
    for (const f of ['团队.md', '团队-市场部.md']) {
      const n = parseMarkdown(readFileSync(path.join('demo-vault/90_配置', f), 'utf8'));
      const section = n.body.split(/^## 必须覆盖的视角.*$/m)[1].split(/^## /m)[0];
      expect([...section.matchAll(/^- \*\*(.+?)\*\*：/gm)].map((m) => m[1])).toEqual(n.data.perspectives);
    }
  });
});

describe('perspectiveGaps (field comparison)', () => {
  it('all covered (claims and sub-questions both count): no gap', () => {
    const p = plan([claim('C1', ['买方', '竞争对手']), claim('C2', ['我方自身的布局', '技术供给'])]);
    p.claims[1].sub_questions[0] = { ...p.claims[1].sub_questions[0], perspective: ['监管'] };
    expect(perspectiveGaps(p, LIST)).toEqual([]);
  });
  it('one missing: flagged by name', () => {
    expect(perspectiveGaps(plan([claim('C1', ['买方', '竞争对手', '我方自身的布局', '技术供给'])]), LIST)).toEqual(['监管']);
  });
  it('skipped with a reason is not a gap; skipped without one is', () => {
    const c = [claim('C1', ['买方', '竞争对手', '我方自身的布局', '技术供给'])];
    expect(perspectiveGaps(plan(c, [{ perspective: '监管', reason: '这次的问题不涉及新的合规要求' }]), LIST)).toEqual([]);
    expect(perspectiveGaps(plan(c, [{ perspective: '监管', reason: ' ' }]), LIST)).toEqual(['监管']);
  });
  it('an old plan without the fields still parses; every perspective shows as missing; no list, nothing checked', async () => {
    const fx = await setup();
    cleanup = fx.cleanup;
    const old = (await fx.vault.read(`${RDIR}/计划 v1.md`)).data;
    const parsed = researchPlanSchema.parse(old);
    expect(parsed.claims[0].perspective).toBeUndefined();
    expect(perspectiveGaps(toEditable(parsed), LIST)).toEqual(LIST);
    expect(perspectiveGaps(toEditable(parsed), [])).toEqual([]);
  });
  it('a single name written as a string reads as a list; words off the list are reported', () => {
    const parsed = researchPlanSchema.shape.claims.element.parse({ ...claim('C1'), perspective: '买方' });
    expect(parsed.perspective).toEqual(['买方']);
    expect(unknownPerspectives(plan([claim('C1', ['买方', '客户'])]), LIST)).toEqual(['客户']);
  });
});

describe('writing and saving plans', () => {
  async function withTeamList() {
    const fx = await setup({ approved: false });
    cleanup = fx.cleanup;
    const t = await fx.vault.read('90_配置/团队.md');
    await fx.vault.write('90_配置/团队.md', { frontmatter: { ...t.data, perspectives: LIST }, body: t.body }, { overwrite: true });
    return fx;
  }

  it('a plan using a word that is not on the list is refused at write time (the model is told the list); a missing one is not', async () => {
    const fx = await withTeamList();
    await expect(checkPlanDraft('# p\n', fx.ctx, { claims: [claim('C1', ['客户'])] })).rejects.toThrow(/视角“客户”不在团队的视角清单里.*买方、竞争对手/);
    await expect(checkPlanDraft('# p\n', fx.ctx, { claims: [claim('C1', ['买方'])] })).resolves.toBeUndefined();
  });

  it('saving a new version keeps the perspectives and the skip reasons, and the plan body shows them', async () => {
    const fx = await withTeamList();
    const p = toEditable((await fx.vault.read(`${RDIR}/计划 v1.md`)).data as never);
    p.claims[0].perspective = ['买方'];
    p.perspectives_skipped = [{ perspective: '监管', reason: '不涉及合规' }];
    const saved = await savePlanVersion({ vault: fx.vault, workspacePath: WS, researchDir: RDIR, role: ROLES.juniorA, plan: p });
    const back = toEditable((await fx.vault.read(saved.path)).data as never);
    expect(back.claims[0].perspective).toEqual(['买方']);
    expect(back.perspectives_skipped).toEqual([{ perspective: '监管', reason: '不涉及合规' }]);
    const body = renderPlanBody(back, 't');
    expect(body).toContain('- 视角：买方');
    expect(body).toContain('## 这次不查的视角\n- 监管：不涉及合规');
  });

  it('the plan prompt carries the list and says to cover by tagging, never by adding claims', async () => {
    const fx = await withTeamList();
    const prompt = await researchPlanPrompt(fx.ctx);
    expect(prompt).toContain('团队要求每份计划覆盖这几个视角：买方、竞争对手、我方自身的布局、监管、技术供给');
    expect(prompt).toContain('不要为了凑齐视角多加子问题或假设');
    expect(prompt).toContain('"perspectives_skipped"');
  });
});

describe('the plan page', () => {
  const props = (p: EditablePlan) => ({ plan: p, planName: '计划 v1', approved: false, canEdit: true, onSave: async () => ({ ok: true as const, name: 'x' }), onApprove: async () => ({ ok: true as const }), perspectives: LIST });
  it('a gap is shown prominently (plan-perspective-gaps), and approval is still possible', () => {
    const out = renderToString(createElement(PlanEditor, props(plan([claim('C1', ['买方', '竞争对手', '我方自身的布局', '技术供给'])])))).replace(/<!-- -->/g, '');
    expect(out).toContain('data-testid="plan-perspective-gaps"');
    expect(out).toContain('漏了：监管');
    expect(out).toMatch(/批准/);
  });
  it('nothing missing: no notice; a skipped perspective is listed with its reason', () => {
    const out = renderToString(createElement(PlanEditor, props(plan([claim('C1', ['买方', '竞争对手', '我方自身的布局', '技术供给'])], [{ perspective: '监管', reason: '不涉及合规' }])))).replace(/<!-- -->/g, '');
    expect(out).not.toContain('plan-perspective-gaps');
    expect(out).toContain('这次不查的视角：监管（不涉及合规）');
  });
});

describe('D-34: perspectives are picked on the plan page (sub-questions and claims)', () => {
  const props = (p: EditablePlan, canEdit = true) => ({ plan: p, planName: '计划 v1', approved: false, canEdit, onSave: async () => ({ ok: true as const, name: 'x' }), onApprove: async () => ({ ok: true as const }), perspectives: LIST });
  const covered = ['买方', '竞争对手', '我方自身的布局', '技术供给'];

  it('togglePerspective: several, or none (no field left)', () => {
    expect(togglePerspective(undefined, '监管')).toEqual(['监管']);
    expect(togglePerspective(['买方'], '监管')).toEqual(['买方', '监管']);
    expect(togglePerspective(['买方', '监管'], '买方')).toEqual(['监管']);
    expect(togglePerspective(['监管'], '监管')).toBeUndefined();
  });

  it('a sub-question added live has no perspective; picking 监管 on it clears "漏了：监管" at once (no save needed)', () => {
    const p0 = addSubQuestion(plan([claim('C1', covered)]), 'C1', '受监管行业有没有写进采购要求');
    const added = p0.claims[0].sub_questions.at(-1)!;
    expect(added.perspective).toBeUndefined();
    expect(perspectiveGaps(p0, LIST)).toEqual(['监管']);
    const p1 = updateSubQuestion(p0, added.id, { perspective: togglePerspective(added.perspective, '监管') });
    expect(p1.claims[0].sub_questions.at(-1)!.perspective).toEqual(['监管']);
    expect(perspectiveGaps(p1, LIST)).toEqual([]);
    // unpicked again: the field goes, the gap is back
    const p2 = updateSubQuestion(p1, added.id, { perspective: undefined });
    expect('perspective' in p2.claims[0].sub_questions.at(-1)!).toBe(false);
    expect(perspectiveGaps(p2, LIST)).toEqual(['监管']);
  });

  it('saving a new version writes the picked perspective', async () => {
    const fx = await setup({ approved: false });
    cleanup = fx.cleanup;
    const old = toEditable((await fx.vault.readTyped(fx.ctx.research!.planPath!, 'research_plan')).note);
    const p0 = addSubQuestion(old, old.claims[0].id, '受监管行业有没有写进采购要求');
    const sub = p0.claims[0].sub_questions.at(-1)!;
    const saved = await savePlanVersion({ vault: fx.vault, workspacePath: WS, researchDir: RDIR, role: ROLES.juniorA, plan: updateSubQuestion(p0, sub.id, { perspective: ['监管'] }) });
    const back = (await fx.vault.readTyped(saved.path, 'research_plan')).note;
    expect(back.claims[0].sub_questions.find((q) => q.id === sub.id)?.perspective).toEqual(['监管']);
  });

  it('each sub-question and each claim shows the team list as toggles, the picked ones pressed', () => {
    const p = plan([claim('C1', ['买方'])]);
    p.claims[0].sub_questions[0] = { ...p.claims[0].sub_questions[0], perspective: ['监管'] };
    const out = renderToString(createElement(PlanEditor, props(p))).replace(/<!-- -->/g, '');
    for (const x of LIST) {
      expect(out).toContain(`aria-label="子问题 C1-Q1 视角：${x}"`);
      expect(out).toContain(`aria-label="论点 C1 视角：${x}"`);
    }
    expect(out).toMatch(/aria-pressed="true"[^>]*aria-label="子问题 C1-Q1 视角：监管"/);
    expect(out).toMatch(/aria-pressed="false"[^>]*aria-label="子问题 C1-Q1 视角：买方"/);
    expect(out).toMatch(/aria-pressed="true"[^>]*aria-label="论点 C1 视角：买方"/);
    // read-only viewers see them, disabled
    expect(renderToString(createElement(PlanEditor, props(p, false)))).toMatch(/aria-label="子问题 C1-Q1 视角：监管"[^>]*disabled|disabled[^>]*aria-label="子问题 C1-Q1 视角：监管"/);
  });

  it('no team list: no picker', () => {
    const out = renderToString(createElement(PlanEditor, { ...props(plan([claim('C1')])), perspectives: [] }));
    expect(out).not.toContain('视角：买方');
  });
});
