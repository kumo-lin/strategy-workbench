/** The workplan chat eval runner, dry mode: the scripted model drives the co-creation chat to a workplan. */
import { mkdtemp, mkdir, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runWorkplanEval } from '../../evals/workplan-chat';
import { makeM1Vault, WS } from '../m1/helpers';

let tmp: string;
let cleanups: (() => Promise<void>)[];

beforeEach(async () => {
  tmp = await mkdtemp(path.join(tmpdir(), 'sw-eval-workplan-'));
  cleanups = [];
});

afterEach(async () => {
  for (const c of cleanups) await c();
  await rm(tmp, { recursive: true, force: true });
});

describe('workplan chat eval (dry, MODEL_MOCK)', () => {
  it('drives the co-creation chat to a workplan and writes the results file', async () => {
    const fixture = await makeM1Vault();
    cleanups.push(fixture.cleanup);
    const outDir = path.join(tmp, 'out');
    await mkdir(outDir, { recursive: true });
    // Importing the module must not start a run: nothing is in the output folder before the call.
    expect(await readdir(outDir)).toEqual([]);

    const prevMock = process.env.MODEL_MOCK;
    const { resultsPath, runs } = await runWorkplanEval({
      questions: [1],
      runs: 1,
      concurrency: 1,
      vault: fixture.root,
      workspace: WS,
      judge: false,
      dry: true,
      outDir,
      scratchDir: path.join(tmp, 'scratch'),
    });

    expect(runs).toHaveLength(1);
    const { record, checks } = runs[0];
    expect(record.error).toBeUndefined();
    expect(record.rounds.length).toBeGreaterThanOrEqual(2);
    expect(record.rounds.some((r) => r.ask && r.answer)).toBe(true);
    expect(record.workplan).not.toBeNull();
    expect(checks.length).toBeGreaterThan(0);

    const md = await readFile(resultsPath, 'utf8');
    expect(md).toContain('## 工作计划对话评测');
    expect(md).toContain('### 题 1 · 题目清楚 · 第 1 次');
    expect(md).toContain('外部评审：');
    expect(md).not.toContain('ask_user');

    // The mock switch is restored even though the run changed it.
    expect(process.env.MODEL_MOCK).toBe(prevMock);
  });
});
