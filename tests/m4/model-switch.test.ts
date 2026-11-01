/** 4.3: switching the model is a config edit; the run's log, result and the UI's model text follow it. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { activeModelInfo, modelLine, modelText } from '@/lib/config/model-info';
import { getModel } from '@/lib/models/provider';
import { executeResearch } from '@/lib/research/execute';
import { clearPageCache } from '@/lib/research/page-cache';
import { fakeWeb, scriptedModel, setup } from '../m2/research-fixture';

let cleanup: (() => Promise<void>) | null = null;
afterEach(async () => {
  vi.unstubAllGlobals();
  await cleanup?.();
  cleanup = null;
});

describe('model switch (4.3)', () => {
  it('T55: a config read half-written (or left invalid) shows a notice in the model line instead of failing the whole page', async () => {
    const fx = await setup();
    cleanup = fx.cleanup;
    const env = { ALPHA_KEY: 'a', BETA_KEY: 'b' } as unknown as NodeJS.ProcessEnv;
    expect(await modelLine(fx.vault, env)).toBe('Alpha'); // the id is for the config page only (复核 A)
    // what a reader sees while the file is being saved: truncated, empty
    await (await import('node:fs/promises')).writeFile((await import('node:path')).join(fx.vault.root, '90_配置/模型.md'), '');
    await expect(activeModelInfo(fx.vault, env)).rejects.toThrow();
    expect(await modelLine(fx.vault, env)).toBe('模型配置读不出来，请到方法与配置页检查');
  });

  it('editing `active` in 90_配置/模型.md changes the resolved model and the text the UI shows, no restart', async () => {
    const fx = await setup();
    cleanup = fx.cleanup;
    const env = { ALPHA_KEY: "a", BETA_KEY: "b" } as unknown as NodeJS.ProcessEnv;
    expect(modelText(await activeModelInfo(fx.vault, env))).toBe('Alpha（alpha-1）');
    expect((await getModel({ vault: fx.vault, env })).provider.model).toBe('alpha-1');

    const cfg = await fx.vault.read('90_配置/模型.md');
    await fx.vault.write('90_配置/模型.md', { frontmatter: { ...cfg.data, active: 'beta' }, body: cfg.body }, { overwrite: true });

    expect(modelText(await activeModelInfo(fx.vault, env))).toBe('Beta（beta-1）');
    expect((await getModel({ vault: fx.vault, env })).provider.model).toBe('beta-1');
  });

  it('Deep Research writes the model name into its log rows and result', async () => {
    clearPageCache();
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 200 })));
    const fx = await setup();
    cleanup = fx.cleanup;
    const info = { providerId: 'beta', label: 'Beta', model: 'beta-1' };
    const r = await executeResearch({ ctx: fx.ctx, mode: 'small', model: scriptedModel().model, modelInfo: info, webClient: fakeWeb() });
    expect(r.model).toEqual(info);
    const log = await fx.vault.readLog(fx.ctx.logPath);
    expect(log.find((l) => l.action === 'research:start')?.reason).toContain('Beta（beta-1）');
    expect(log.find((l) => l.action === 'research:done')?.reason).toContain('Beta（beta-1）');
  });
});
