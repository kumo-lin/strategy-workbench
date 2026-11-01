/**
 * Step ② of the decomposition: pin the question down before anything is drafted (D-56 ③ v2).
 *
 * The model fills six slots (what to answer, what decision it supports, scope and time, what success looks like,
 * what is already known, how strong the evidence must be) and marks every directive / decision / policy item of the pack as 一致 / 冲突 / 无关 against the user's direction.
 * This file is the code that decides what is still missing: while anything is missing the model is only given
 * `ask_user` and `frame_topic` (see gate.ts). Pure; no I/O.
 */
import { emptySlots, isMarkable, SLOT_KEYS, SLOT_LABELS, type ComposeState, type Size, type DirectiveMark, type Frame, type PackItem, type SlotKey } from './types';

export type FrameStage =
  /** Something is missing: a slot, a mark, or a conflict nobody settled. */
  | 'framing'
  /** Everything is filled and marked; the user has not said "split it like this" yet. */
  | 'confirm'
  /** The user confirmed: composing may start. */
  | 'ready';

export interface FrameStatus {
  stage: FrameStage;
  emptySlots: SlotKey[];
  /** Markable pack items that carry no mark yet. */
  unmarked: PackItem[];
  /** Conflicts the user has not decided (no `resolution`). */
  openConflicts: DirectiveMark[];
}

export function frameStatus(state: Pick<ComposeState, 'frame' | 'pack' | 'marks' | 'confirmed'>): FrameStatus {
  const markable = state.pack.filter(isMarkable);
  const marked = new Set(state.marks.map((m) => m.ref));
  const unmarked = markable.filter((i) => !marked.has(i.id));
  const empty = emptySlots(state.frame);
  const openConflicts = state.marks.filter((m) => m.verdict === '冲突' && !m.resolution);
  const complete = empty.length === 0 && unmarked.length === 0 && openConflicts.length === 0;
  return { stage: !complete ? 'framing' : state.confirmed ? 'ready' : 'confirm', emptySlots: empty, unmarked, openConflicts };
}

export interface FrameUpdate {
  question?: string;
  decision?: string;
  scope?: string;
  success?: string;
  known?: string;
  bar?: string;
  resources?: string;
  marks?: { ref: string; verdict: DirectiveMark['verdict']; note: string; resolution?: DirectiveMark['resolution'] }[];
  /** The user said "split it like this" on the confirm card. */
  confirmed?: boolean;
  size?: Size;
}

export interface FrameResult {
  state: ComposeState;
  /** Why part of the update was refused: said back to the model so it can fix and retry. */
  problems: string[];
}

/** Merge what the model reported into the state. Never throws: a bad part is refused and named in `problems`. */
export function applyFrameUpdate(state: ComposeState, update: FrameUpdate): FrameResult {
  const problems: string[] = [];
  const frame: Frame = { ...state.frame };
  for (const k of SLOT_KEYS) {
    const v = update[k]?.trim();
    if (v) frame[k] = v;
  }

  const byId = new Map(state.pack.map((i) => [i.id, i]));
  const marks = new Map(state.marks.map((m) => [m.ref, m]));
  for (const m of update.marks ?? []) {
    const item = byId.get(m.ref);
    if (!item) {
      problems.push(`${m.ref} 不在资料包里：只能标资料包里有的编号。`);
      continue;
    }
    if (!isMarkable(item)) {
      problems.push(`${m.ref}（《${item.title}》）是参考资料，不用标一致/冲突。`);
      continue;
    }
    if (!m.note.trim()) {
      problems.push(`${m.ref} 要写一句话说明为什么${m.verdict}。`);
      continue;
    }
    if (m.resolution && m.verdict !== '冲突') {
      problems.push(`${m.ref} 只有标了「冲突」才有处理结果（resolution）。`);
      continue;
    }
    // A later report of the same item replaces the earlier one, but a settled conflict keeps its resolution unless a new one comes.
    const prev = marks.get(m.ref);
    marks.set(m.ref, {
      ref: m.ref,
      verdict: m.verdict,
      note: m.note.trim(),
      ...(m.resolution ? { resolution: m.resolution } : prev?.verdict === '冲突' && m.verdict === '冲突' && prev.resolution ? { resolution: prev.resolution } : {}),
    });
  }

  let next: ComposeState = { ...state, frame, marks: [...marks.values()], ...(update.size ? { size: update.size } : {}), ...(update.resources?.trim() ? { resources: update.resources.trim() } : {}) };

  if (update.confirmed !== undefined) {
    if (update.confirmed) {
      const s = frameStatus({ ...next, confirmed: false });
      if (s.stage !== 'confirm') problems.push(describeMissing(s, next.pack));
      else next = { ...next, confirmed: true };
    } else {
      next = { ...next, confirmed: false };
    }
  }
  // Changing a slot after the user confirmed means the confirmation no longer covers it.
  const changed = SLOT_KEYS.some((k) => frame[k] !== state.frame[k]);
  if (changed && update.confirmed !== true && next.confirmed) next = { ...next, confirmed: false };
  return { state: next, problems };
}

/** One sentence saying what is still missing, for the model and the log. */
export function describeMissing(s: FrameStatus, pack: PackItem[]): string {
  const parts: string[] = [];
  if (s.emptySlots.length) parts.push(`还没填：${s.emptySlots.map((k) => SLOT_LABELS[k]).join('、')}`);
  if (s.unmarked.length) parts.push(`还没标一致/冲突/无关：${s.unmarked.map((i) => `${i.id}（《${i.title}》）`).join('、')}`);
  if (s.openConflicts.length) {
    const titles = s.openConflicts.map((m) => {
      const item = pack.find((i) => i.id === m.ref);
      return `${m.ref}${item ? `（《${item.title}》）` : ''}`;
    });
    parts.push(`冲突还没问用户怎么处理：${titles.join('、')}`);
  }
  return parts.length ? `不能确认：${parts.join('；')}。` : '';
}

/** The frame as one readable block (for the prompt and for the confirm card). */
export function frameLines(frame: Frame): string[] {
  return SLOT_KEYS.map((k) => `${SLOT_LABELS[k]}：${frame[k] || '（空）'}`);
}
