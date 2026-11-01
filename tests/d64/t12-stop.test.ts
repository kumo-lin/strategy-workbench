/** D-64 T12: the stop rule wants two web rounds in a row with no new evidence (D63 §4). */
import { describe, expect, it } from 'vitest';
import { stopReason, type Evidence } from '@/lib/research/evidence';

let n = 0;
const ev = (over: Partial<Evidence> = {}): Evidence => {
  n++;
  return {
    ref: `[[s${n}#^c1]]`, path: `10_资料库/s${n}.md`, block: 'c1', text: '「x」', quote: 'x', sourceName: `s${n}`, publisher: `Pub${n}`,
    url: `https://pub${n}-site.com/a`, grade: 'B', origin: '网络', gradedBy: 'AI', published: null, claimId: 'C1', subQuestionId: 'C1-Q1',
    round: 'web1', stance: 'supports', reason: '', core: false, partial: false, ...over,
  };
};
const base = { webRoundsDone: 0, maxWebRounds: 5, searchesLeft: 9, evidence: [ev()] };

describe('T12 stop rule', () => {
  it('[3, 0] goes on', () => {
    expect(stopReason({ ...base, webRoundsDone: 2, newEvidenceByRound: [3, 0] })).toBeNull();
  });
  it('[3, 0, 0] stops: no new evidence', () => {
    expect(stopReason({ ...base, webRoundsDone: 3, newEvidenceByRound: [3, 0, 0] })).toBe('no_new_evidence');
  });
  it('[] goes on', () => {
    expect(stopReason({ ...base, newEvidenceByRound: [] })).toBeNull();
  });
  it('decidable when §9.5 can decide', () => {
    expect(stopReason({ ...base, evidence: [ev({ grade: 'A' }), ev({ grade: 'A' })], newEvidenceByRound: [] })).toBe('decidable');
  });
  it('rounds_exhausted when the rounds are used up', () => {
    expect(stopReason({ ...base, webRoundsDone: 5, newEvidenceByRound: [1, 0, 1, 0, 1] })).toBe('rounds_exhausted');
  });
});
