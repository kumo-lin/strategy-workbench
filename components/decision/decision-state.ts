/**
 * The decision panel's own state. The draft / confirm / save routes return the card as stored, and
 * the panel puts it straight in, so a card never waits for a server render. Server renders that
 * arrive later (VaultLiveRefresh, possibly 10+ s late when the machine is busy) are merged in,
 * and must never undo something newer that this panel already knows:
 *   - a card we stored locally (confirmed, edited, re-drafted) replaces the version before it;
 *     a server render still showing that OLD version is stale and ignored — by content, because a
 *     status check alone would let a stale 推断 render overwrite an edit the Senior just saved
 *   - a card the server does not have yet stays
 *   - a version we have never seen (edited in Obsidian) wins
 */
import { decisionFields, withFields, type DecisionFields } from '@/lib/decisions/fields';
import type { DecisionCard } from '@/lib/decisions/review';

export type { DecisionCard };

/** One card being edited. Lives in the panel, by path, so nothing a server render does can reset it. */
export interface EditState {
  editing: boolean;
  /** What is in the editor. */
  text: string;
  /** The body the editing started from: `text !== base` means the Senior changed something. */
  base: string;
  /** D-64 T41: the three fields as typed (a round trip through the body would trim what is being typed). */
  fields?: DecisionFields;
}

export interface PanelState {
  cards: DecisionCard[];
  /** Fingerprints of versions this panel has replaced: a server card with one of them is stale. */
  superseded: string[];
  edits: Record<string, EditState>;
}

/** The React key of a card: its path, nothing that changes while it is edited or confirmed. */
export const cardKey = (card: Pick<DecisionCard, 'path'>) => card.path;

/** Bodies that differ only by trailing whitespace or line endings are the same text. */
const sameText = (a: string, b: string) => a.replace(/\r\n/g, '\n').trimEnd() === b.replace(/\r\n/g, '\n').trimEnd();

const byName = (a: DecisionCard, b: DecisionCard) => a.name.localeCompare(b.name);
const fingerprint = (c: DecisionCard) => `${c.path}\n${c.status}\n${c.decidedBy ?? ''}\n${c.body}`;

export const initialState = (cards: DecisionCard[]): PanelState => ({ cards: [...cards].sort(byName), superseded: [], edits: {} });

/** A route returned this card: insert or replace (same path), remembering the version it replaces. */
export function storeCard(state: PanelState, card: DecisionCard): PanelState {
  const old = state.cards.find((c) => c.path === card.path);
  const superseded = old && fingerprint(old) !== fingerprint(card) ? [...state.superseded, fingerprint(old)] : state.superseded;
  return { ...state, cards: [...state.cards.filter((c) => c.path !== card.path), card].sort(byName), superseded };
}

/** A server render arrived (it may be older than what the routes have told us since). */
export function receiveServer(state: PanelState, server: DecisionCard[]): PanelState {
  const stale = new Set(state.superseded);
  const merged = new Map<string, DecisionCard>();
  for (const s of server) {
    if (!stale.has(fingerprint(s))) merged.set(s.path, s);
  }
  for (const c of state.cards) {
    const s = server.find((x) => x.path === c.path);
    // the server has no card, or only a stale version of it: ours stands
    if (!merged.has(c.path) && (!s || stale.has(fingerprint(s)))) merged.set(c.path, c);
  }
  const cards = [...merged.values()].sort(byName);
  return { ...state, cards };
}

/** The `card` field of a draft / confirm response, or null if it is not one. */
export function cardFromResponse(json: Record<string, unknown>): DecisionCard | null {
  const c = json.card as Partial<DecisionCard> | undefined;
  if (!c || typeof c.path !== 'string' || typeof c.name !== 'string' || typeof c.status !== 'string' || typeof c.body !== 'string') return null;
  return { path: c.path, name: c.name, status: c.status, decidedBy: typeof c.decidedBy === 'string' ? c.decidedBy : null, draftedByModel: typeof c.draftedByModel === 'string' ? c.draftedByModel : null, body: c.body, problems: Array.isArray(c.problems) ? c.problems.map(String) : [] };
}

// ── editing ──────────────────────────────────────────────────────────────────

export const isEditing = (state: PanelState, path: string) => state.edits[path]?.editing === true;

/** Open the editor on a card, starting from its current body. */
export function startEdit(state: PanelState, path: string): PanelState {
  const card = state.cards.find((c) => c.path === path);
  if (!card || state.edits[path]?.editing) return state;
  return { ...state, edits: { ...state.edits, [path]: { editing: true, text: card.body, base: card.body } } };
}

export function setEditText(state: PanelState, path: string, text: string): PanelState {
  const e = state.edits[path];
  return e?.editing ? { ...state, edits: { ...state.edits, [path]: { ...e, text } } } : state;
}

/** D-64 T41: the Senior typed in one of the three fields; the edit starts on the first change. */
export function setEditField(state: PanelState, path: string, key: keyof DecisionFields, value: string): PanelState {
  const started = startEdit(state, path);
  const e = started.edits[path];
  if (!e) return state;
  const fields = { ...(e.fields ?? decisionFields(e.text)), [key]: value };
  return { ...started, edits: { ...started.edits, [path]: { ...e, fields, text: withFields(e.text, fields) } } };
}

/** Close the editor and drop what was typed. */
export function cancelEdit(state: PanelState, path: string): PanelState {
  if (!state.edits[path]) return state;
  const { [path]: _gone, ...edits } = state.edits;
  return { ...state, edits };
}

/** The Senior changed something (not merely opened the editor). */
export function isDirty(e: EditState | undefined): boolean {
  return Boolean(e?.editing) && !sameText(e!.text, e!.base);
}

/**
 * The card changed under the editor (a server render, or a re-draft) in more than whitespace.
 * The editor keeps the Senior's text; the card only says "有更新".
 */
export function hasUpdate(e: EditState | undefined, card: DecisionCard): boolean {
  return Boolean(e?.editing) && !sameText(card.body, e!.base);
}

/** Throw away the edit and take the latest version of the card into the editor. */
export function loadLatest(state: PanelState, path: string): PanelState {
  const card = state.cards.find((c) => c.path === path);
  const e = state.edits[path];
  if (!card || !e?.editing) return state;
  return { ...state, edits: { ...state.edits, [path]: { editing: true, text: card.body, base: card.body } } };
}
