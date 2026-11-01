/**
 * The decision panel shows what the routes return, without waiting for router.refresh() (E2E saw
 * 1 run in 6 where the draft answered 200 and the card never appeared). Pure state helpers, a
 * server render of the panel, and the two routes returning the card.
 */
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Role } from '@/lib/config/roles';
import { DecisionPanel } from '@/components/decision/decision-panel';
import {
  cancelEdit,
  cardFromResponse,
  cardKey,
  hasUpdate,
  initialState,
  isDirty,
  isEditing,
  loadLatest,
  receiveServer,
  setEditField,
  setEditText,
  startEdit,
  storeCard,
  type DecisionCard,
} from '@/components/decision/decision-state';
import type { Vault } from '@/lib/vault';
import { DECISIONS, GOOD_DRAFT, jsonModel, makeM3Vault, RDIR_A, REPORT, ROLES, WS_A } from './fixture';

const card = (name: string, over: Partial<DecisionCard> = {}): DecisionCard => ({
  path: `${DECISIONS}/${name}.md`,
  name,
  status: '推断',
  decidedBy: null,
  draftedByModel: null,
  body: `# ${name}\n\n## 决定\n\n${name} 的决定\n`,
  problems: [],
  ...over,
});

describe('decision-state: a late or stale server render never undoes what the routes already told the panel', () => {
  const names = (st: { cards: DecisionCard[] }) => st.cards.map((c) => c.name);

  it('storeCard adds a new card, or replaces the one with the same path, sorted by name', () => {
    const a = card('A');
    const b = card('B');
    expect(names(storeCard(initialState([b]), a))).toEqual(['A', 'B']);
    expect(storeCard(initialState([a, b]), { ...a, status: '已确认' }).cards.map((c) => [c.name, c.status])).toEqual([['A', '已确认'], ['B', '推断']]);
  });

  it('a card the route just returned stays while the server render does not have it yet', () => {
    const st = storeCard(initialState([]), card('新草稿'));
    expect(names(receiveServer(st, []))).toEqual(['新草稿']);
  });

  it('a stale render still showing 推断 does not turn a confirmed card back (render arrives after the confirm)', () => {
    const draft = card('A');
    let st = initialState([draft]);
    st = storeCard(st, { ...draft, status: '已确认', decidedBy: 'Senior', body: `${draft.body}\n**已确认**` });
    // a slow refresh started before the confirm lands now, with the version it rendered
    st = receiveServer(st, [draft]);
    expect(st.cards[0]).toMatchObject({ status: '已确认', decidedBy: 'Senior' });
  });

  it('a stale render does not undo a saved edit either (same status, old body), and neither does one two versions old', () => {
    const v0 = card('A');
    const v1 = { ...v0, body: `${v0.body}\n- Senior 补充 1\n` };
    const v2 = { ...v0, body: `${v0.body}\n- Senior 补充 1\n- Senior 补充 2\n` };
    let st = storeCard(storeCard(initialState([v0]), v1), v2);
    st = receiveServer(st, [v0]);
    expect(st.cards[0].body).toBe(v2.body);
    st = receiveServer(st, [v1]);
    expect(st.cards[0].body).toBe(v2.body);
  });

  it('the order does not matter: a stale render before the confirm, then the confirm, ends up confirmed too', () => {
    const draft = card('A');
    let st = receiveServer(initialState([draft]), [draft]);
    st = storeCard(st, { ...draft, status: '已确认', decidedBy: 'Senior' });
    expect(st.cards[0].status).toBe('已确认');
  });

  it('a render that has caught up, or a version the panel has never seen (edited in Obsidian), wins', () => {
    const v0 = card('A');
    const confirmed = { ...v0, status: '已确认', decidedBy: 'Senior' };
    let st = storeCard(initialState([v0]), confirmed);
    st = receiveServer(st, [confirmed, card('B')]);
    expect(names(st)).toEqual(['A', 'B']);
    const obsidian = { ...confirmed, body: '# A\n\n在 Obsidian 里改过\n' };
    expect(receiveServer(st, [obsidian, card('B')]).cards[0].body).toContain('在 Obsidian 里改过');
  });

  it('cardFromResponse takes the card out of a route answer, and rejects anything else', () => {
    const c = card('A');
    expect(cardFromResponse({ path: 'x', card: c })).toEqual(c);
    expect(cardFromResponse({ path: 'x' })).toBeNull();
    expect(cardFromResponse({ card: { name: 'A' } })).toBeNull();
  });
});

describe('editing lives in the panel: a late render, even one that differs by a single newline, cannot reset it', () => {
  const A = card('A');
  const typed = `${A.body.trimEnd()}\n- Senior 补充：先看 WS-B 的比例\n`;

  it('the React key is the path only: nothing that changes during an edit or a confirm can remount the card', () => {
    expect(cardKey(A)).toBe(A.path);
    const longer: DecisionCard = { ...A, body: `${A.body}\n` };
    const confirmed: DecisionCard = { ...A, status: '已确认', body: 'x' };
    expect(cardKey(longer)).toBe(cardKey(A));
    expect(cardKey(confirmed)).toBe(cardKey(A));
  });

  it('opening the editor starts from the card body; typing is not "dirty" until the text really differs', () => {
    let st = startEdit(initialState([A]), A.path);
    expect(isEditing(st, A.path)).toBe(true);
    expect(st.edits[A.path]).toMatchObject({ text: A.body, base: A.body });
    expect(isDirty(st.edits[A.path])).toBe(false);
    st = setEditText(st, A.path, `${A.body}\n\n`); // only trailing whitespace
    expect(isDirty(st.edits[A.path])).toBe(false);
    st = setEditText(st, A.path, typed);
    expect(isDirty(st.edits[A.path])).toBe(true);
  });

  it('D-64 T41: typing in a field starts the edit, keeps what is typed as typed, and writes it into its section', () => {
    const st = setEditField(initialState([A]), A.path, 'decision', 'A 先做 ');
    expect(st.edits[A.path]).toMatchObject({ editing: true, fields: { decision: 'A 先做 ' } });
    expect(st.edits[A.path].text).toContain('## 决定\n\nA 先做\n');
    expect(isDirty(st.edits[A.path])).toBe(true);
  });

  it('half-way through an edit, a render that differs only by a trailing newline changes nothing: text kept, still editing, no "有更新"', () => {
    let st = setEditText(startEdit(initialState([A]), A.path), A.path, typed);
    st = receiveServer(st, [{ ...A, body: `${A.body}\n` }]);
    expect(isEditing(st, A.path)).toBe(true);
    expect(st.edits[A.path].text).toBe(typed);
    expect(hasUpdate(st.edits[A.path], st.cards[0])).toBe(false);
  });

  it('a render with real changes keeps the Senior\'s text and only flags 有更新; 载入最新版本 is the only way to lose the text', () => {
    let st = setEditText(startEdit(initialState([A]), A.path), A.path, typed);
    const theirs = { ...A, body: `${A.body.trimEnd()}\n- 在 Obsidian 里加了一条\n` };
    st = receiveServer(st, [theirs]);
    expect(st.cards[0].body).toBe(theirs.body);
    expect(st.edits[A.path].text).toBe(typed); // the editor still holds what the Senior typed
    expect(hasUpdate(st.edits[A.path], st.cards[0])).toBe(true);
    st = loadLatest(st, A.path);
    expect(st.edits[A.path]).toMatchObject({ text: theirs.body, base: theirs.body });
    expect(hasUpdate(st.edits[A.path], st.cards[0])).toBe(false);
  });

  it('cards coming and going around the one being edited do not touch its edit', () => {
    const B = card('B');
    let st = setEditText(startEdit(initialState([A, B]), A.path), A.path, typed);
    st = receiveServer(st, [B]); // the server render does not list A at all (yet)
    st = receiveServer(st, [B, A, card('C')]);
    expect(st.cards.map((c) => c.name)).toEqual(['A', 'B', 'C']);
    expect(st.edits[A.path].text).toBe(typed);
  });

  it('a route answer (save / confirm) ends the edit on that card only', () => {
    const B = card('B');
    let st = startEdit(startEdit(initialState([A, B]), A.path), B.path);
    st = storeCard(cancelEdit(st, A.path), { ...A, status: '已确认', decidedBy: 'Senior' });
    expect(isEditing(st, A.path)).toBe(false);
    expect(isEditing(st, B.path)).toBe(true);
    expect(st.cards[0].status).toBe('已确认');
  });

  it('the stale-render rule still holds while editing: an old version of the card does not come back', () => {
    const saved = { ...A, body: typed };
    let st = storeCard(initialState([A]), saved);
    st = startEdit(st, A.path);
    st = receiveServer(st, [A]); // a slow refresh from before the save
    expect(st.cards[0].body).toBe(typed);
    expect(hasUpdate(st.edits[A.path], st.cards[0])).toBe(false);
  });
});

describe('DecisionPanel (server render)', () => {
  const html = (decisions: DecisionCard[]) =>
    renderToString(createElement(DecisionPanel, { workspacePath: WS_A, researchDir: RDIR_A, reportPath: REPORT, decisions })).replace(/<!-- -->/g, '');

  it('shows 起草模型 when the note records one, and nothing when it does not', () => {
    const out = html([card('A', { draftedByModel: 'Kimi（kimi-k2）' }), card('B')]);
    expect(out).toContain('起草模型：Kimi<'); // the reader sees the name; the id stays in the hover text (复核 A)
    expect(out).toContain('title="Kimi（kimi-k2）"');
    expect((out.match(/data-testid="decision-drafted-by"/g) ?? []).length).toBe(1);
  });

  it('two or more drafts sit side by side, one draft stays stacked; each card carries its model', () => {
    const one = html([card('A', { draftedByModel: 'DeepSeek（deepseek-v4-flash）' })]);
    expect(one).toContain('data-layout="stacked"');
    const two = html([card('A', { draftedByModel: 'DeepSeek（deepseek-v4-flash）' }), card('B', { draftedByModel: 'Kimi（kimi-k2）' })]);
    expect(two).toContain('data-layout="side-by-side"');
    expect(two).toContain('@xl:grid-cols-2'); // the panel's own width decides, not the window's (it sits in a column next to the citation sidebar)
    expect(two).toContain('data-model="Kimi（kimi-k2）"');
    expect(two).toContain('data-model="DeepSeek（deepseek-v4-flash）"');
    expect((two.match(/data-testid="confirm-store"/g) ?? []).length).toBe(2); // D-64 T41: was decision-confirm
    // one draft plus one confirmed decision is not a comparison
    expect(html([card('A'), card('B', { status: '已确认', decidedBy: 'Senior' })])).toContain('data-layout="stacked"');
  });

  it('long content is folded by default (display only), with an expand control per card', () => {
    // D-64 T41: a draft shows the three fields instead; a decided card keeps the folded text
    const long = card('A', { status: '已确认', decidedBy: 'Senior', body: `# A\n\n## 理由\n\n${Array.from({ length: 60 }, (_, i) => `- 第 ${i} 条`).join('\n')}\n` });
    const out = html([long, card('B', { status: '已确认', decidedBy: 'Senior' })]);
    expect((out.match(/data-collapsed="true"/g) ?? []).length).toBe(2);
    expect((out.match(/data-testid="decision-expand"/g) ?? []).length).toBe(2);
    expect(out).toContain('max-h-60'); // the fold is a height cap, the full text is still in the page
    expect(out).toContain('第 59 条');
    expect(out).toContain('展开全文');
    expect(out).toContain('aria-expanded="false"');
  });

  it('renders the cards it is given, with their status, and the right button label', () => {
    expect(html([])).toContain('起草决定');
    expect(html([])).not.toContain('data-testid="decision-card"');
    const out = html([card('A'), card('B', { status: '已确认', decidedBy: 'Senior' })]);
    expect(out).toContain('重新起草决定');
    expect(out).toMatch(/data-testid="decision-card" data-status="推断"/);
    expect(out).toMatch(/data-testid="decision-card" data-status="已确认"/);
    expect(out).toContain('Senior 确认');
    expect(out).toContain('data-testid="confirm-store"'); // only on the 推断 one (D-64 T41: was decision-confirm)
    expect((out.match(/data-testid="confirm-store"/g) ?? []).length).toBe(1);
  });
});

describe('the routes return the card, so the panel needs no refetch', () => {
  let vault: Vault;
  let cleanup: () => Promise<void>;
  let role: Role = ROLES.senior;
  beforeEach(async () => {
    ({ vault, cleanup } = await makeM3Vault());
    role = ROLES.senior;
    vi.resetModules();
    vi.doMock('@/lib/session/role', () => ({ getCurrentRole: async () => role }));
    vi.doMock('@/lib/vault', async (orig) => ({ ...(await orig<typeof import('@/lib/vault')>()), getVault: () => vault }));
    const { report: _r, ...draft } = { ...GOOD_DRAFT, report: '' };
    vi.doMock('@/lib/models/provider', () => ({ getModel: async () => ({ providerId: 'alpha', provider: { label: 'Alpha', model: 'alpha-1' }, model: jsonModel(draft).model }) }));
  });
  afterEach(async () => {
    vi.doUnmock('@/lib/session/role');
    vi.doUnmock('@/lib/vault');
    vi.doUnmock('@/lib/models/provider');
    await cleanup();
  });
  const req = (url: string, body: object) => new Request(`http://x${url}`, { method: 'POST', body: JSON.stringify(body) });
  const path = `${DECISIONS}/${GOOD_DRAFT.name}.md`;

  it('draft → the new 推断 card; save → the edited card; confirm → the 已确认 card', async () => {
    const draftRoute = await import('@/app/api/decision/draft/route');
    const confirmRoute = await import('@/app/api/decision/confirm/route');

    const drafted = await draftRoute.POST(req('/api/decision/draft', { workspacePath: WS_A, researchDir: RDIR_A, reportPath: REPORT }));
    expect(drafted.status).toBe(200);
    const d = cardFromResponse(await drafted.json());
    expect(d).toMatchObject({ path, name: GOOD_DRAFT.name, status: '推断', decidedBy: null, problems: [] });
    expect(d?.body).toContain('## 理由');
    expect(d?.draftedByModel).toBe('Alpha（alpha-1）');

    const body = `${d!.body.trimEnd()}\n- Senior 补充：先看 WS-B 的比例\n`;
    const saved = await confirmRoute.POST(req('/api/decision/confirm', { decision: path, action: 'save', body }));
    expect(saved.status).toBe(200);
    expect(cardFromResponse(await saved.json())).toMatchObject({ status: '推断', body: expect.stringContaining('Senior 补充') });

    const confirmed = await confirmRoute.POST(req('/api/decision/confirm', { decision: path }));
    expect(confirmed.status).toBe(200);
    const c = cardFromResponse(await confirmed.json());
    expect(c).toMatchObject({ status: '已确认', decidedBy: 'Senior', draftedByModel: 'Alpha（alpha-1）' });
    expect(c?.body).toContain('**已确认**：Senior');
  });

  it('a refused call returns no card (403 for a Junior)', async () => {
    const draftRoute = await import('@/app/api/decision/draft/route');
    role = ROLES.juniorA;
    const res = await draftRoute.POST(req('/api/decision/draft', { workspacePath: WS_A, researchDir: RDIR_A, reportPath: REPORT }));
    expect(res.status).toBe(403);
    expect(cardFromResponse(await res.json())).toBeNull();
  });
});
