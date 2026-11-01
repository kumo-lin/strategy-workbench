/** T55: real orchestration with the M1 mock (one table row per hypothesis), never prewritten report judgments. */
import { cp, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { applyApprovalEvent, buildToolContext } from '@/lib/harness';
import { executeResearch } from '@/lib/research/execute';
import { keyQuestionVerdict } from '@/lib/research/evidence';
import { changeTableOf, interviewAdviceOf } from '@/lib/research/interview-advice';
import { executeInterviewFollowUp, saveInterview } from '@/lib/research/interview-followup';
import { readJudgmentFile } from '@/lib/research/judgment-file';
import type { ProgressEvent } from '@/lib/research/progress';
import { planApprovalProblems } from '@/lib/research/plan-checks';
import { nextStep } from '@/lib/testing/mock-agent';
import { createMockModel } from '@/lib/testing/mock-model';
import { createMockWebClient } from '@/lib/testing/mock-web';
import { M1_SO_WHAT_V1 } from '@/lib/testing/scripts/m1';
import { createVault } from '@/lib/vault';

let root = '';
afterEach(async () => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); if (root) await rm(root, { recursive: true, force: true }); });
it('M1 produces K2/K3 gaps, then changes only K3/K4 and keeps the interview ceiling', async () => {
  root = await mkdtemp(path.join(tmpdir(), 'sw-t55-m1-'));
  await cp('tests/fixtures/e2e-vault-m1', root, { recursive: true });
  vi.stubEnv('VAULT_DIR', root); vi.stubEnv('MODEL_PROVIDER', 'mock'); vi.stubEnv('WEB_TOOLS', 'mock');
  vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 200 })));
  const vault = createVault(root);
  const ws = '20_项目/个人AI战略/M1 用户持续使用';
  const dir = `${ws}/调查/M1 全链路`;
  const actor = { id: 'junior-a', name: '分析师甲', kind: 'junior' as const };
  const draft = await nextStep({ system: `Workspace：${ws}。`, lastUser: '拟调查计划', calls: ['ask_user', 'ask_user', 'ask_user'], results: [], tools: ['ask_user', 'write_draft'] });
  if (!('call' in draft)) throw new Error('The M1 mock must draft the investigation plan');
  const input = draft.call.input as { frontmatter: Record<string, unknown>; body: string };
  const planPath = `${dir}/计划 v1.md`;
  await vault.write(planPath, { frontmatter: { ...input.frontmatter, type: 'research_plan', status: '推断', author: 'AI', created: '2026-10-29', updated: '2026-10-29', exploratory: false }, body: input.body });
  expect(await planApprovalProblems(vault, planPath)).toEqual([]);
  await applyApprovalEvent(vault, { type: 'research_plan.approve', actor, workspace: `${ws}/workspace.md`, plan: planPath }, { logPath: `${ws}/日志.md`, reason: '测试负责人批准合法调查计划' });
  const ctx = await buildToolContext({ vault, role: actor, workspacePath: ws, researchDir: dir, track: 'research' });
  const events: ProgressEvent[] = [];
  const r1 = await executeResearch({ ctx, mode: 'full', model: createMockModel(), verifyModel: createMockModel(), webClient: createMockWebClient(), emit: (e) => events.push(e) });
  expect(r1.failedChecks).toEqual([]);
  expect(r1.delivered).toBe(true);
  const before = await vault.read(r1.reportPath);
  for (const flags of ['number_flags', 'summary_flags', 'length_flags']) expect(before.data[flags] ?? [], flags).toEqual([]);
  // each hypothesis searched the web with its own query (the workplan background names every K, the queries must not)
  const searched = events.flatMap((e) => (e.kind === 'tool-start' && e.tool === 'web_search' ? [e.input as { sub_question_id: string; query: string }] : []));
  expect(searched.filter((q) => /cross-device/.test(q.query)).map((q) => q.sub_question_id)).toEqual(['C1-Q1', 'C1-Q1']);
  expect(searched.filter((q) => /switching/.test(q.query)).map((q) => q.sub_question_id)).toEqual(['C2-Q1']);
  expect(searched.filter((q) => /purchase decisions/.test(q.query)).map((q) => q.sub_question_id)).toEqual(['C8-Q1']);
  // K3's two web rounds read pages and found nothing new: the stop rule, not the script, ends the search
  expect(events.filter((e) => e.kind === 'search-card' && e.stop).map((e) => (e as { subQuestion: string }).subQuestion)).toEqual(['C1-Q1']);
  // 复核 A: what the run page shows (step titles and details, card lines) names a sub-question by its words, never its id
  const shown = events.flatMap((e) => (e.kind === 'step' ? [e.title, e.detail ?? ''] : e.kind === 'search-card' ? [e.question ?? ''] : []));
  expect(shown.filter((t) => /C\d+-Q\d+|· C\d+\b|C\d+（/.test(t))).toEqual([]);
  expect(events.filter((e) => e.kind === 'search-card').every((e) => (e as { question?: string }).question)).toBe(true);
  // The checker does not translate word-numbers: verify the time condition against the original, not just its flags.
  expect(before.body).toContain('即使每周能省下五小时，也只有 33% 愿意给 AI 主邮箱的只读权限');
  expect(before.body).not.toContain('前提是每周节省时间');
  expect((await vault.read('10_资料库/Ping Identity 2026-06 Consumer Survey AI Trust.md')).body).toContain('saving five hours per week');
  const sources = await readdir(path.join(root, '10_资料库'));
  // 入库前过滤：every source the run added from the web carries at least one quote checked word for word against its page
  for (const f of sources) {
    const n = await vault.read(`10_资料库/${f}`);
    if (n.data.origin !== '网络') continue;
    expect([...(await vault.getBlocks(`10_资料库/${f}`)).keys()].filter((k) => /^c\d+$/.test(k)).length, f).toBeGreaterThan(0);
  }
  expect(sources.some((p) => p.includes('Recon'))).toBe(true);
  expect(sources.some((p) => p.includes('Gartner'))).toBe(true);
  const saved = await readFile(path.join(root, r1.reportPath), 'utf8');
  const j1 = (await readJudgmentFile(vault, r1.reportPath))!;
  const interviews = [];
  const overlay = 'tests/fixtures/e2e-vault-m1-interviews/20_项目/个人AI战略/访谈';
  for (const filename of (await readdir(overlay)).filter((p) => p.endsWith('.md'))) {
    interviews.push((await saveInterview(vault, actor, ws, { name: filename, content: await readFile(path.join(overlay, filename), 'utf8'), simulated: true })).path);
  }
  const r2 = await executeInterviewFollowUp({ ctx, interviews, model: createMockModel() });
  const after = await vault.read(r2.reportPath);
  const j2 = (await readJudgmentFile(vault, r2.reportPath))!;
  const claims = ctx.research!.plan!.claims;
  expect([...new Set(claims.map((c) => c.key))].sort()).toEqual(['K1', 'K2', 'K3', 'K4']);
  // 复核 F (v6 2.9): three people to ask — none of them the enterprise buyer
  expect(interviewAdviceOf(before.body).groups.map((g) => g.who)).toEqual(['Qira 产品分析负责人', '隐私与信任团队负责人', '多设备重度用户']);
  const keys = interviewAdviceOf(before.body).gaps.map((g) => g.question.slice(0, 2));
  expect(keys).toEqual(expect.arrayContaining(['K2', 'K3']));
  expect(j1.summary!.so_what).toContain(M1_SO_WHAT_V1);
  // 复核 P8: the top So what has no sub-question tag
  expect(before.body.split('## 为什么')[0]).not.toMatch(/\[Q\d/);
  expect(M1_SO_WHAT_V1.length).toBeLessThanOrEqual(50);
  // every reason cites what it rests on (49% and 24%: Pew; 80: Lenovo; 33%: Ping)
  expect(j1.summary!.reasons!.map((r) => r.basis.flatMap((b) => b.refs ?? []).length > 0)).toEqual([true, true, true]);
  // a gap says what is missing, never how the search went
  // a gap and an answer say what is missing, never how the search went (that is the appendix's 怎么查的)
  const said = before.body.split('\n').filter((l) => /^\s*- (缺口：|Q\d+ →)/.test(l));
  expect(said.length).toBeGreaterThan(0);
  for (const l of said) expect(l).not.toMatch(/联网|\d+ 轮/);
  // 复核 A: the reader never sees the internal sub-question ids
  expect(before.body).not.toMatch(/C\d+-Q\d+/);
  const verdict = (file: typeof j1, key: string) => keyQuestionVerdict(file.claims.filter((c) => claims.find((p) => p.id === c.claimId)?.key === key).map((c) => c.verdict));
  expect(verdict(j1, 'K3')).toBe('证据不足');
  expect(verdict(j2, 'K3')).toBe('访谈支持');
  expect(verdict(j1, 'K4')).toBe('需要修改');
  expect(verdict(j1, 'K1')).toBe('需要修改');
  expect(verdict(j1, 'K2')).toBe('证据不足');
  expect(verdict(j2, 'K4')).toBe('需要修改');
  const changes = changeTableOf(after.body)!;
  // 复核 A: the change table sits at the top, among the reader's sections: no sub-question tag left on the old So what
  expect(changes.find((r) => r[0] === 'So what')?.join('')).not.toMatch(/\[Q\d/);
  for (const key of ['K1', 'K2']) {
    expect(changes.find((r) => r[0].startsWith(key))?.[2]).toContain('不变（访谈没有涉及）');
    for (const c of j1.claims.filter((c) => claims.find((p) => p.id === c.claimId)?.key === key)) expect(j2.claims.find((n) => n.claimId === c.claimId)).toEqual(c);
  }
  expect(changes.find((r) => r[0].startsWith('K4'))?.slice(1)).toEqual(['部分支持', '部分支持']);
  expect(j2.claims.filter((c) => claims.find((p) => p.id === c.claimId)?.key === 'K3').some((c) => c.verdict === '成立')).toBe(false);
  expect(after.body).toContain('模拟访谈');
  // 复核 P3 (v6 2.10): asked whether K3 can be 成立, the answer leads with 不能 and says what the interviews gave
  const { loadExplanationContext } = await import('@/lib/research/explanation-context');
  const { answerExplanation } = await import('@/lib/research/explanation-answer');
  const ex = await loadExplanationContext(vault, after);
  const k3 = ex.targets.find((t) => t.token === 'K3')!;
  expect(k3.interviewSaid?.join('；')).toContain('口径和方向');
  const answer = answerExplanation(ex, k3.id, 'verdict_limit');
  expect(answer).toMatch(/^不能。K3/);
  expect(answer).toContain('口径和方向');
  expect(answer).toContain('访谈支持');
  // 复核 B3 (v6 2.10): v2 has its three reasons again, ② and ③ with what the interviews said, tagged 访谈支持, never 事实
  const said2 = (i: number) => j2.summary!.reasons![i].basis.filter((b) => b.kind === '访谈支持').map((b) => b.text).join('；');
  expect(said2(0)).toBe('');
  expect(said2(1)).toContain('电脑上准备、手机上跟进');
  expect(said2(2)).toContain('不愿让 AI 代发邮件');
  expect(said2(2)).not.toContain('电脑上准备');
  const why2 = after.body.slice(after.body.indexOf('## 为什么'), after.body.indexOf('## 缺乏信息'));
  expect(why2.match(/^ {3}- 访谈支持：/gm)?.length).toBeGreaterThanOrEqual(2);
  expect(why2).not.toMatch(/事实：[^\n]*访谈/);
  expect(await readFile(path.join(root, r1.reportPath), 'utf8')).toBe(saved);
});
