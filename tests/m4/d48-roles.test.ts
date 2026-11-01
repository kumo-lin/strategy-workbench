/**
 * D-48 round 5 (M4): evidence roles, checked when rendering — a positive claim cites only what supports its
 * hypothesis; a refute only on a 不成立 condition, or as a contrast the text says (contrast: true and 但/不过/然而).
 * Real data: W5 v6 (its judgment and evidence files, copied from C's S3), where Q3's [^13] / [^16] and Q2's [^8] were
 * refutes hung on the answer. And (a): an [M#] taken out of the 依据 leaves "高层指示" where it was the subject (WS-A v8).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Evidence } from '@/lib/research/evidence';
import { directivesOutOfBasis } from '@/lib/research/execute';
import type { CheckedCondition, ClaimResult } from '@/lib/research/judge';
import { evidenceRoles, expandConditionRefs, segmentAnswer, type AnswerSegment } from '@/lib/research/report';

type Judged = { claimId: string; label: string; verdict: string; conditions: CheckedCondition[]; judgment: Record<string, unknown> };
const J = JSON.parse(readFileSync('tests/fixtures/d48/W5 报告 v6.judgment.json', 'utf8')) as { keyed: Record<string, string>; claims: Judged[] };
const RECORD = JSON.parse(readFileSync('tests/fixtures/d48/W5 报告 v6.evidence.json', 'utf8')) as { entries: { claim: string; ref: string; stance: 'supports' | 'refutes' }[] };

/** A ClaimResult as far as rendering the answer needs it: its keys with their stance under this hypothesis. */
function claim(id: string): ClaimResult {
  const c = J.claims.find((x) => x.claimId === id)!;
  const keys = [...new Set([...c.conditions.flatMap((x) => x.keys), ...((c.judgment.answer_segments as AnswerSegment[]) ?? []).flatMap((s) => s.keys)])];
  const keyed = new Map<string, Evidence>();
  for (const k of keys) {
    const stances = RECORD.entries.filter((x) => x.claim === id && x.ref === J.keyed[k]).map((x) => x.stance);
    keyed.set(k, { ref: J.keyed[k], stance: stances.includes('refutes') ? 'refutes' : 'supports' } as Evidence);
  }
  return { claim: { id }, label: c.label, verdict: c.verdict, conditions: c.conditions, judgment: c.judgment, keyed } as unknown as ClaimResult;
}
const keysOnly = (t: string) => t;

describe('W5 v6: refutes hung on the answer are taken off', () => {
  it('Q3: [^13] (E80) and [^16] (E82), the Qira page that says the capability is there, off the parts that say it is not', () => {
    const log: [string, string?][] = [];
    const out = segmentAnswer(claim('C3'), keysOnly, (m, kind) => log.push([m, kind]))!;
    expect(out).toBe('多半看不到面向企业 IT 的 Qira 管理能力，只有合规认证还在规划中 [E78]；多半还没有企业规模部署或采购的案例，个人版按用户每月 4.99 美元售卖 [E76]；受监管行业要日志审计和责任可追溯，Qira 多半还满足不了 [E72] [E78] [E70]。');
    expect(log.filter(([, k]) => k === 'role').map(([m]) => m)).toEqual(['H3 回答的一段（①）把反证 [E80] 挂在了正面的说法上，去掉了', 'H3 回答的一段（②）把反证 [E82] 挂在了正面的说法上，去掉了']);
  });

  it('Q2: [^8] (E47) off the second part; with E49 a refute too nothing is left, so it says "（还缺证据）"', () => {
    expect(evidenceRoles([claim('C2')]).get('E47')).toBe('refutes');
    const out = segmentAnswer(claim('C2'), keysOnly)!;
    expect(out.split('；')[1]).toBe('跨设备机队和硬件带外多半已被对手摊平，联想不占优（还缺证据）');
    expect(out).not.toMatch(/E47|E49/);
  });

  it('a refute stays on a 不成立 condition, and in a contrast the text says; contrast: true without 但/不过/然而 is not one', () => {
    const r = claim('C3');
    const on = (segs: AnswerSegment[], status: CheckedCondition['status'] = '证据不足') => segmentAnswer({ ...r, conditions: r.conditions.map((c) => ({ ...c, status })), judgment: { ...r.judgment, answer_segments: segs } as ClaimResult['judgment'] }, keysOnly)!;
    expect(on([{ text: '企业 IT 管理能力已经有了', cond: '①', keys: ['E80'] }], '不成立')).toBe('企业 IT 管理能力已经有了 [E80]。');
    expect(on([{ text: '官方文档里看不到，不过发布会说能下发策略', cond: '①', keys: ['E80', 'E78'], contrast: true } as AnswerSegment])).toBe('官方文档里看不到，不过发布会说能下发策略（还缺证据） [E80] [E78]。');
    expect(on([{ text: '官方文档里看不到', cond: '①', keys: ['E80', 'E78'], contrast: true } as AnswerSegment])).toBe('官方文档里看不到（还缺证据） [E78]。');
  });

  it('a block that both supports and refutes under one hypothesis counts as refutes', () => {
    const keyed = new Map<string, Evidence>([['E1', { ref: '[[a#^c1]]', stance: 'supports' } as Evidence], ['E2', { ref: '[[a#^c1]]', stance: 'refutes' } as Evidence], ['E3', { ref: '[[b#^c1]]', stance: 'supports' } as Evidence]]);
    expect(Object.fromEntries(evidenceRoles([{ keyed }]))).toEqual({ E1: 'refutes', E2: 'refutes', E3: 'supports' });
  });
});

// WS-A v9 (its judgment and evidence files, copied from C's S3): H3-1 ②'s 80% lost its only source to the role check
const V9 = JSON.parse(readFileSync('tests/fixtures/d48/WS-A 报告 v9.judgment.json', 'utf8')) as { keyed: Record<string, string>; claims: Judged[] };
const V9_RECORD = JSON.parse(readFileSync('tests/fixtures/d48/WS-A 报告 v9.evidence.json', 'utf8')) as typeof RECORD;
/** E107's block (BCG), what the number check reads. */
const QUOTES: Record<string, string> = { E107: '据BCG周三发布的一份报告显示，80%的AI支出发生在IT预算之外。' };
function v9(label: string): ClaimResult {
  const c = V9.claims.find((x) => x.label === label)!;
  const keys = [...new Set([...c.conditions.flatMap((x) => x.keys), ...((c.judgment.answer_segments as AnswerSegment[]) ?? []).flatMap((s) => s.keys)])];
  const keyed = new Map<string, Evidence>();
  for (const k of keys) {
    const stances = V9_RECORD.entries.filter((x) => x.claim === c.claimId && x.ref === V9.keyed[k]).map((x) => x.stance);
    keyed.set(k, { ref: V9.keyed[k], stance: stances.includes('refutes') ? 'refutes' : 'supports', quote: QUOTES[k] ?? '' } as Evidence);
  }
  return { claim: { id: c.claimId }, label: c.label, verdict: c.verdict, conditions: c.conditions, judgment: c.judgment, keyed } as unknown as ClaimResult;
}

describe('a refute that is the only source of a number in the part stays (the user, round 5: only this rule)', () => {
  it('WS-A v9 H3-1 ②: "…80% 的 AI 支出发生在 IT 预算之外" keeps E107 (its original says 80%), no flag, nothing logged', () => {
    const log: [string, string?][] = [];
    const out = segmentAnswer(v9('H3-1'), keysOnly, (m, kind) => log.push([m, kind]))!;
    expect(out.split('；')[1]).toBe('科目上多半没向软件与服务倾斜，80% 的 AI 支出发生在 IT 预算之外 [E107]');
    expect(log.filter(([m]) => m.includes('E107'))).toEqual([]);
  });

  it('a negation word does not keep a refute: H1 ② "…不只在 IT 一侧" (no number) still loses E31; ③ of H3-1 loses E99', () => {
    expect(segmentAnswer(v9('H1'), keysOnly)!.split('；')[2]).toBe('预算多半分散在 IT 与业务线，不只在 IT 一侧（还缺证据）。');
    expect(segmentAnswer(v9('H3-1'), keysOnly)!.split('；')[2]).toBe('这笔钱是不是新增还缺证据 [E97]。');
  });

  it('the number also in a supporting source: that one carries it, the refute goes; a number its original does not have: goes', () => {
    const r = v9('H3-1');
    const keyed = new Map(r.keyed).set('E89', { ref: '[[s#^c1]]', stance: 'supports', quote: '约 80% 的支出在 IT 预算之外' } as Evidence);
    const on = (segs: AnswerSegment[]) => segmentAnswer({ ...r, keyed, judgment: { ...r.judgment, answer_segments: segs } as ClaimResult['judgment'] }, keysOnly)!;
    expect(on([{ text: '80% 在 IT 预算之外', cond: '②', keys: ['E107', 'E89'] }])).toBe('80% 在 IT 预算之外（还缺证据） [E89]。');
    expect(on([{ text: '60% 在 IT 预算之外', cond: '②', keys: ['E107'] }])).toBe('60% 在 IT 预算之外（还缺证据）。');
  });
});

describe('[Qx①] in the Summary and the recommendation brings in supports only', () => {
  const r = claim('C3');
  const conds = new Map(r.conditions.map((c) => [`Q3${c.label}`, c]));
  const roles = evidenceRoles([r]);
  it('[Q3①]: E78, not E80 (logged); [Q2②] of W5 v6, all refutes: "（还缺证据）"', () => {
    const log: string[] = [];
    expect(expandConditionRefs('Qira 企业侧还看不到 [Q3①]', conds, undefined, { roles, log: (m) => log.push(m) })).toBe('Qira 企业侧还看不到 [E78]（靠 Q3 ①，待验证）');
    expect(log).toEqual(['引用 [Q3①] 带进来的反证 [E80] 挂在了正面的说法上，去掉了']);
    const q2 = new Map([['Q2②', { ...claim('C2').conditions[1], keys: ['E49', 'E47'] }]]);
    expect(expandConditionRefs('对手已摊平 [Q2②]', q2, undefined, { roles: evidenceRoles([claim('C2')]) })).toBe('对手已摊平（还缺证据）（靠 Q2 ②，待验证）');
  });
});

describe('(a) an [M#] out of the 依据: "高层指示" where the sentence read it as its subject', () => {
  // WS-A v8's 怎么回应高层指示, as the model wrote it (the report showed "， 说决定权在 CIO…", "； 的集中部署…", "所以 里…")
  const V8 =
    '修正：IT 管准入、管理三层有明文支撑，但可管只买到进场资格 [E29][E30]。依据：员工端 AI 进公司机队要 IT 登记、下发策略、接入身份与日志 [E1]，[M1] 说决定权在 CIO 和 IT 手里，这部分成立；[M1] 的集中部署与配置这一层在监管条文里有对应要求 [E6]，所以 [M1] 里「守住商用份额并靠可管变现」要改 [M1]。';
  it('every sentence whole, the directive\'s own footnote in the conclusion', () => {
    expect(directivesOutOfBasis(V8)).toBe(
      '修正：IT 管准入、管理三层有明文支撑，但可管只买到进场资格 [E29][E30][M1]。依据：员工端 AI 进公司机队要 IT 登记、下发策略、接入身份与日志 [E1]，高层指示说决定权在 CIO 和 IT 手里，这部分成立；高层指示的集中部署与配置这一层在监管条文里有对应要求 [E6]，所以高层指示里「守住商用份额并靠可管变现」要改。',
    );
  });
});
