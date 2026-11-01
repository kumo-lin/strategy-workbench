/** Step ②: what is still missing, and how a report from the model is merged (D-56 ③ v2). */
import { describe, expect, it } from 'vitest';
import { applyFrameUpdate, describeMissing, frameStatus } from '@/lib/workplan/compose/frame';
import { newState, type ComposeState, type PackItem } from '@/lib/workplan/compose/types';

const item = (id: string, kind: PackItem['kind'], title = `资料${id}`): PackItem => ({ id, kind, title, path: `x/${title}.md`, gist: '', ...(kind === 'directive' ? { block: '^m1' } : {}) });
const full = { question: '问', decision: '决策', scope: '2026', success: '知道付费条件', known: '暂无现成结论', bar: '一个独立来源' };

function stateWith(over: Partial<ComposeState>): ComposeState {
  return { ...newState(), pack: [item('K1', 'directive', '高层周会'), item('K2', 'policy', '业务方针'), item('K3', 'reference')], ...over };
}

describe('research resources', () => {
  it('start from the default, never block the frame, and change only when the user said so', () => {
    const s = stateWith({ frame: full });
    expect(s.resources).toContain('不做实验');
    expect(frameStatus({ ...s, frame: { ...full, bar: '' } }).emptySlots).toEqual(['bar']);
    expect(applyFrameUpdate(s, { resources: '  ' }).state.resources).toBe(s.resources);
    expect(applyFrameUpdate(s, { resources: '可以约 3 位客户访谈' }).state.resources).toBe('可以约 3 位客户访谈');
  });
});

describe('frameStatus', () => {
  it('is framing while a slot is empty, and lists the empty slots in the order they are asked', () => {
    const s = frameStatus(stateWith({ frame: { ...full, scope: '', decision: '' } }));
    expect(s.stage).toBe('framing');
    expect(s.emptySlots).toEqual(['decision', 'scope']);
  });

  it('needs a mark for every directive/decision/policy item, but not for references', () => {
    const s = frameStatus(stateWith({ frame: full, marks: [{ ref: 'K1', verdict: '一致', note: '一致' }] }));
    expect(s.stage).toBe('framing');
    expect(s.unmarked.map((i) => i.id)).toEqual(['K2']);
  });

  it('an unsettled conflict keeps it framing; a conflict with a resolution does not', () => {
    const marks = [
      { ref: 'K1', verdict: '冲突' as const, note: '方向不同' },
      { ref: 'K2', verdict: '无关' as const, note: '无关' },
    ];
    expect(frameStatus(stateWith({ frame: full, marks })).openConflicts.map((m) => m.ref)).toEqual(['K1']);
    const settled = [{ ...marks[0], resolution: '按指示' as const }, marks[1]];
    expect(frameStatus(stateWith({ frame: full, marks: settled })).stage).toBe('confirm');
  });

  it('is ready only after the user confirmed', () => {
    const marks = [
      { ref: 'K1', verdict: '一致' as const, note: 'a' },
      { ref: 'K2', verdict: '一致' as const, note: 'b' },
    ];
    expect(frameStatus(stateWith({ frame: full, marks })).stage).toBe('confirm');
    expect(frameStatus(stateWith({ frame: full, marks, confirmed: true })).stage).toBe('ready');
  });

  it('a pack with nothing to mark and a full frame is ready to confirm', () => {
    expect(frameStatus({ ...newState(), frame: full }).stage).toBe('confirm');
  });
});

describe('applyFrameUpdate', () => {
  it('fills slots, trims, and ignores empty strings', () => {
    const r = applyFrameUpdate(stateWith({ frame: { ...full, scope: '旧范围' } }), { question: '  新问题 ', scope: '  ' });
    expect(r.state.frame).toMatchObject({ question: '新问题', scope: '旧范围' });
    expect(r.problems).toEqual([]);
  });

  it('refuses a mark for an id that is not in the pack, a reference, a missing note, or a resolution on a non-conflict', () => {
    const r = applyFrameUpdate(stateWith({}), {
      marks: [
        { ref: 'K9', verdict: '一致', note: 'x' },
        { ref: 'K3', verdict: '一致', note: 'x' },
        { ref: 'K1', verdict: '一致', note: ' ' },
        { ref: 'K2', verdict: '一致', note: 'x', resolution: '按指示' },
      ],
    });
    expect(r.state.marks).toEqual([]);
    expect(r.problems).toHaveLength(4);
    expect(r.problems[0]).toContain('K9');
    expect(r.problems[1]).toContain('参考资料');
  });

  it('a later mark replaces an earlier one; a settled conflict keeps its resolution when it is reported again', () => {
    let s = applyFrameUpdate(stateWith({}), { marks: [{ ref: 'K1', verdict: '冲突', note: '方向不同' }] }).state;
    s = applyFrameUpdate(s, { marks: [{ ref: 'K1', verdict: '冲突', note: '方向不同', resolution: '按用户的想法' }] }).state;
    s = applyFrameUpdate(s, { marks: [{ ref: 'K1', verdict: '冲突', note: '还是不同' }] }).state;
    expect(s.marks).toEqual([{ ref: 'K1', verdict: '冲突', note: '还是不同', resolution: '按用户的想法' }]);
    s = applyFrameUpdate(s, { marks: [{ ref: 'K1', verdict: '一致', note: '改主意了' }] }).state;
    expect(s.marks[0]).toEqual({ ref: 'K1', verdict: '一致', note: '改主意了' });
  });

  it('confirmed:true is refused while something is missing, and says what', () => {
    const r = applyFrameUpdate(stateWith({ frame: { ...full, success: '' } }), { confirmed: true });
    expect(r.state.confirmed).toBe(false);
    expect(r.problems[0]).toContain('还没填：成功的样子');
    expect(r.problems[0]).toContain('K1');
  });

  it('confirmed:true is accepted when everything is filled and marked, in the same update that fills the last slot', () => {
    const base = stateWith({
      frame: { ...full, success: '' },
      marks: [
        { ref: 'K1', verdict: '一致', note: 'a' },
        { ref: 'K2', verdict: '无关', note: 'b' },
      ],
    });
    const r = applyFrameUpdate(base, { success: '知道条件', confirmed: true });
    expect(r.problems).toEqual([]);
    expect(r.state.confirmed).toBe(true);
  });

  it('changing a slot after the confirmation withdraws it', () => {
    const ready = stateWith({
      frame: full,
      confirmed: true,
      marks: [
        { ref: 'K1', verdict: '一致', note: 'a' },
        { ref: 'K2', verdict: '一致', note: 'b' },
      ],
    });
    expect(applyFrameUpdate(ready, { scope: '改了范围' }).state.confirmed).toBe(false);
    expect(applyFrameUpdate(ready, { question: full.question }).state.confirmed).toBe(true);
  });

  it('describeMissing is empty when nothing is missing', () => {
    const s = stateWith({ frame: full, marks: [{ ref: 'K1', verdict: '一致', note: 'a' }, { ref: 'K2', verdict: '一致', note: 'b' }] });
    expect(describeMissing(frameStatus(s), s.pack)).toBe('');
  });
});

describe('size of the question', () => {
  it('defaults to a big question and is set by a frame update', () => {
    const s = newState();
    expect(s.size).toBe('大题');
    expect(applyFrameUpdate(s, { size: '小题' }).state.size).toBe('小题');
    expect(applyFrameUpdate({ ...s, size: '小题' }, { question: '问' }).state.size).toBe('小题');
  });
});
