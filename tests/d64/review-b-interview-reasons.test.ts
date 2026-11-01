import { describe, expect, it } from 'vitest';
import { reasonsWithInterviews, type InterviewHit } from '@/lib/research/interview-followup';
import type { EvidenceRecordEntry } from '@/lib/research/evidence-record';
import type { JudgmentFile } from '@/lib/research/judgment-file';
import { explanationJudgment } from '../helpers/explanation-fixture';

const REF = '[[资料甲#^c1]]';
const record = (claim: string, ref = REF): EvidenceRecordEntry => ({ claim, sub: `${claim}-Q1`, ref, stance: 'supports', core: false, partial: false, round: 'kb', reason: 'recorded' });
const hit = (interview: string, claims = ['C1'], text = '同一句访谈支持'): InterviewHit => ({ interview, claims, reason: text });
function fixture(): JudgmentFile {
  const file = explanationJudgment(1) as unknown as JudgmentFile;
  file.keyed = { E1: REF, E2: REF };
  file.claims[0].judgment.support_lines = ['支持甲[E1]'];
  file.claims[1].judgment.support_lines = ['支持乙[E2]'];
  file.summary!.reasons = ['E1', 'E2'].map((key) => ({ title: key, basis: [{ text: `原文${key}`, kind: '事实', source: '资料甲', refs: [key] }] }));
  return file;
}
const supported = (file: JudgmentFile, rec: EvidenceRecordEntry[], hits: InterviewHit[], simulated = new Set<string>()) => reasonsWithInterviews(file, rec, hits, simulated);
const interviews = (r: ReturnType<typeof supported>, i = 0) => r.reasons[i].basis.filter((b) => b.kind === '访谈支持');

describe('review B3 interview reason ownership and deduplication', () => {
  it('shared block references never expand a key to another claim', () => {
    const result = supported(fixture(), [record('C1'), record('C2')], [hit('访谈乙', ['C2'])]);
    expect(interviews(result, 0)).toEqual([]);
    expect(interviews(result, 1)).toHaveLength(1);
    expect(result.added[0]).toEqual([]);
  });

  it.each(['conditions', 'support', 'challenge', 'rebutted'] as const)('recognizes the key consumed by %s', (field) => {
    const file = fixture();
    const claim = file.claims[0];
    claim.judgment.support_lines = [];
    if (field === 'conditions') claim.conditions = [{ n: 1, label: '条件', text: '条件', status: '成立', keys: ['E1'], note: '证据' }];
    if (field === 'support') claim.judgment.support_lines = ['支持[E1]'];
    if (field === 'challenge') claim.judgment.challenge_responses = [{ key: 'E1', challenge: '反证', response: '回应', effect: '不影响判断' }];
    if (field === 'rebutted') claim.judgment.rebutted = ['E1'];
    const result = supported(file, [record('C1')], [hit('访谈甲')], new Set(['访谈甲']));
    expect(interviews(result)).toEqual([{ text: '同一句访谈支持', kind: '访谈支持', source: '访谈甲，模拟访谈', refs: [] }]);
    expect(result.reasons[0].basis[0]).toEqual(file.summary!.reasons![0].basis[0]);
  });

  it('an ambiguous key has no guessed owner even if the evidence record names a claim', () => {
    const file = fixture();
    file.claims[1].judgment.support_lines.push('也消费同key[E1]');
    expect(interviews(supported(file, [record('C1')], [hit('访谈甲')]))).toEqual([]);
  });

  it('a record entry cannot create ownership when no stored claim consumes the key', () => {
    const file = fixture();
    file.claims[0].judgment.support_lines = ['产品E1不是证据引用'];
    expect(interviews(supported(file, [record('C1')], [hit('访谈甲')]))).toEqual([]);
  });

  it.each([{ rec: [] }, { rec: [record('C2')] }, { rec: [record('C1', '[[资料乙#^c1]]')] }])('requires record corroboration of the unique claim and reference: %j', ({ rec }) => {
    expect(interviews(supported(fixture(), rec, [hit('访谈甲')]))).toEqual([]);
  });

  it('keeps identical testimony from distinct sources, deduplicating repeated hits within a round', () => {
    const result = supported(fixture(), [record('C1')], [hit('访谈甲'), hit('访谈乙'), hit('访谈甲')]);
    expect(interviews(result).map((b) => b.source)).toEqual(['访谈甲', '访谈乙']);
    expect(result.added[0]).toHaveLength(2);
  });

  it('does not append the same source and text again on a later round', () => {
    const file = fixture();
    const rec = [record('C1')];
    const first = supported(file, rec, [hit('访谈甲')]);
    file.summary!.reasons = first.reasons;
    const second = supported(file, rec, [hit('访谈甲')]);
    expect(interviews(second)).toEqual(interviews(first));
    expect(second.added[0]).toEqual([]);
    const changed = supported(file, rec, [hit('访谈甲', ['C1'], '新的一句访谈支持')]);
    expect(interviews(changed)).toHaveLength(2);
  });

  it('an existing fact with the same source and text is not mistaken for an interview', () => {
    const file = fixture();
    file.summary!.reasons![0].basis[0].text = '同一句访谈支持';
    file.summary!.reasons![0].basis[0].source = '访谈甲';
    expect(interviews(supported(file, [record('C1')], [hit('访谈甲')]))).toHaveLength(1);
  });
});
