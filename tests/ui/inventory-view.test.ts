/** The internal pass of a run → what the run page shows (per-sub counts, the grade line, the gap rows). D-64 T22: no confirm panel any more. */
import { describe, expect, it } from 'vitest';
import type { Inventory } from '@/lib/research/inventory';
import { inventoryView } from '@/lib/research/inventory-view';

const source = (grade: 'A' | 'B' | 'C' | null, supports = 0, refutes = 0) => ({ path: `${grade ?? 'x'}.md`, title: 't', grade, simulated: false, supports, refutes });

const inventory: Inventory = {
  version: 1,
  planPath: '20_项目/P/WS/调查/R1/计划 v1.md',
  planVersion: 1,
  mode: 'small',
  createdAt: '2026-10-24T10:00:00.000Z',
  claimIds: ['C1', 'C2'],
  notExecuted: [],
  subs: [
    {
      claimId: 'C1',
      label: 'H1',
      subId: 'C1-Q1',
      question: '内部资料够吗？',
      webAllowed: false,
      status: 'enough',
      note: '够',
      tried: [],
      webQueries: [],
      sources: [source('A', 2, 0), source('B', 1, 0)],
    },
    {
      claimId: 'C1',
      label: 'H1',
      subId: 'C1-Q2',
      question: '缺口在哪？',
      webAllowed: true,
      status: 'gap',
      note: '缺一线数据',
      tried: [],
      webQueries: ['q'],
      sources: [source('B', 0, 0), source('C'), source(null)],
    },
    {
      claimId: 'C2',
      label: 'H2',
      subId: 'C2-Q1',
      question: '只查知识库？',
      webAllowed: false,
      status: 'kb_only',
      note: '',
      tried: [],
      webQueries: [],
      sources: [],
    },
  ],
  counterNotes: {},
  counterQueries: {},
  evidence: [],
  searches: 0,
  fetches: 0,
};

describe('inventoryView', () => {
  it('one row per sub, in the inventory order', () => {
    expect(inventoryView(inventory).rows.map((r) => r.subId)).toEqual(['C1-Q1', 'C1-Q2', 'C2-Q1']);
  });

  it('counts the sources, writes the grades and sums supports/refutes', () => {
    const [enough, gap, kb] = inventoryView(inventory).rows;
    expect(enough).toMatchObject({ sourceCount: 2, gradeText: 'A 1 · B 1', supports: 3, refutes: 0, status: 'enough' });
    expect(gap).toMatchObject({ sourceCount: 3, gradeText: 'B 1 · C 1 · 未分级 1', supports: 0, refutes: 0, status: 'gap', note: '缺一线数据', webAllowed: true });
    expect(kb).toMatchObject({ sourceCount: 0, gradeText: '', status: 'kb_only', webAllowed: false });
  });

  it('defaultSelection is only the gap rows that may go to the web, in row order', () => {
    expect(inventoryView(inventory).defaultSelection).toEqual(['C1-Q2']);
    const more = inventoryView({
      ...inventory,
      subs: [inventory.subs[1], { ...inventory.subs[1], subId: 'C1-Q3' }, inventory.subs[0]],
    });
    expect(more.defaultSelection).toEqual(['C1-Q2', 'C1-Q3']);
  });

  it('missing arrays are empty, not a throw', () => {
    const sparse = { mode: 'small', subs: [{ subId: 'X', status: 'gap', webAllowed: true }] } as unknown as Inventory;
    expect(inventoryView(sparse).rows[0]).toMatchObject({ subId: 'X', sourceCount: 0, gradeText: '', supports: 0, refutes: 0 });
    expect(inventoryView(sparse).defaultSelection).toEqual(['X']);
    expect(() => inventoryView({ mode: 'small' } as unknown as Inventory)).not.toThrow();
    expect(inventoryView({ mode: 'full', subs: [] } as unknown as Inventory).rows).toEqual([]);
  });
});
