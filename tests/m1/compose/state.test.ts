/** The pipeline's data shapes and its state file (D-56 ③ v2). */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { access } from 'node:fs/promises';
import path from 'node:path';
import type { Vault } from '@/lib/vault';
import { readState, readTreeSidecar, statePath, treeSidecarPath, updateState, writeTreeSidecar } from '@/lib/workplan/compose/state';
import {
  emptyFrame,
  emptySlots,
  labelsOf,
  leavesOf,
  newState,
  treeSchema,
} from '@/lib/workplan/compose/types';
import { makeM1Vault, WS } from '../helpers';
import { hyp, leaf, sampleTree } from './fixtures';

let vault: Vault;
let cleanup: () => Promise<void>;
beforeEach(async () => {
  ({ vault, cleanup } = await makeM1Vault());
});
afterEach(async () => cleanup());

describe('types', () => {
  it('emptySlots lists the empty slots in the order they are asked', () => {
    expect(emptySlots(emptyFrame())).toEqual(['question', 'decision', 'scope', 'success', 'known', 'bar']);
    expect(emptySlots({ question: '问', decision: ' ', scope: '范围', success: '', known: '已知', bar: '门槛' })).toEqual(['decision', 'success']);
  });

  it('labelsOf numbers by reading order and leavesOf keeps only the lowest level', () => {
    const t = sampleTree();
    expect(labelsOf(t).map((x) => x.label)).toEqual(['Q1', 'Q2', 'Q2-1', 'Q2-2', 'Q3']);
    expect(leavesOf(t).map((x) => x.label)).toEqual(['Q1', 'Q2-1', 'Q2-2', 'Q3']);
  });

  it('a branch needs at least two children, and at least two top-level questions are needed', () => {
    const t = sampleTree();
    expect(() => treeSchema.parse({ ...t, subquestions: [leaf('只有一个')] })).toThrow();
    expect(() => treeSchema.parse({ ...t, subquestions: [leaf('甲'), { question: '乙', children: [leaf('丙')] }] })).toThrow();
  });

  it('a hypothesis needs a falsifier and 1-3 conditions; "where" is a pack id or 上网', () => {
    const h = hyp('x');
    expect(() => treeSchema.parse({ ...sampleTree(), subquestions: [{ question: 'a', hypothesis: { ...h, falsifier: '' } }, leaf('b')] })).toThrow();
    expect(() => treeSchema.parse({ ...sampleTree(), subquestions: [{ question: 'a', hypothesis: { ...h, conditions: [] } }, leaf('b')] })).toThrow();
    const bad = { ...h, to_verify: [{ what: 'w', where: 'a file.md', support: 's', counter: 'c' }] };
    expect(() => treeSchema.parse({ ...sampleTree(), subquestions: [{ question: 'a', hypothesis: bad }, leaf('b')] })).toThrow();
    const good = { ...h, to_verify: [{ what: 'w', where: 'K3', support: 's', counter: 'c' }, { what: 'w2', where: '上网', support: 's', counter: 'c' }] };
    expect(() => treeSchema.parse({ ...sampleTree(), subquestions: [{ question: 'a', hypothesis: good }, leaf('b')] })).not.toThrow();
  });
});

describe('state file', () => {
  it('a Workspace without a file starts fresh', async () => {
    const s = await readState(vault, WS);
    expect(s).toMatchObject({ version: 1, confirmed: false, pack: [], marks: [] });
    expect(emptySlots(s.frame)).toHaveLength(6);
  });

  it('updateState round-trips and stamps the time; the file sits under 拆题/', async () => {
    const at = new Date('2026-10-27T01:02:03.000Z');
    await updateState(vault, WS, (s) => ({ ...s, topic: '帮我看看', frame: { ...s.frame, question: '问题' } }), at);
    const s = await readState(vault, WS);
    expect(s.frame.question).toBe('问题');
    expect(s.updated).toBe(at.toISOString());
    await access(path.join(vault.root, statePath(WS)));
    expect(statePath(WS)).toBe(`${WS}/拆题/状态.json`);
  });

  it('a damaged file falls back to a fresh state instead of throwing', async () => {
    await updateState(vault, WS, (s) => s);
    const { writeFile } = await import('node:fs/promises');
    await writeFile(path.join(vault.root, statePath(WS)), '{ not json', 'utf8');
    expect(await readState(vault, WS)).toMatchObject({ version: 1, confirmed: false });
  });

  it('the tree sidecar keeps one file per workplan version', async () => {
    await writeTreeSidecar(vault, WS, 1, sampleTree(), []);
    await writeTreeSidecar(vault, WS, 2, sampleTree(), []);
    expect(treeSidecarPath(WS, 2)).toBe(`${WS}/拆题/workplan v2.树.json`);
    expect((await readTreeSidecar(vault, WS, 1))?.version).toBe(1);
    expect(await readTreeSidecar(vault, WS, 3)).toBeNull();
  });

  it('rejects a workspace path that could leave the vault', () => {
    expect(() => statePath('../x')).toThrow();
    expect(() => statePath('/abs')).toThrow();
  });

  it('newState is valid', () => {
    expect(newState().version).toBe(1);
  });
});
