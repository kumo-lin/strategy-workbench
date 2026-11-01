/**
 * Source reliability (D-21 v3: a "金融监管总局 2024-06 AI 风险管理指引" that does not exist, retold in a .docx on
 * renrendoc.com, held up three citations). A disproven source never becomes evidence again; an unverified one is
 * marked; user-upload document platforms are always C and labelled as retellings.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { describeSource } from '@/lib/research/citation-types';
import { restoreEvidence } from '@/lib/research/evidence-record';
import { executeResearch } from '@/lib/research/execute';
import { gradeSource, isUserUploadPlatform } from '@/lib/research/grading';
import { clearPageCache } from '@/lib/research/page-cache';
import { footnoteText } from '@/lib/research/report';
import { claimBlocksOf, loadSourceInfo } from '@/lib/research/sources';
import { fakeWeb, scriptedModel, setup } from './research-fixture';

let cleanup: (() => Promise<void>) | null = null;
beforeEach(() => {
  clearPageCache();
  vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 200 })));
});
afterEach(async () => {
  vi.unstubAllGlobals();
  await cleanup?.();
  cleanup = null;
});

const SRC = '10_资料库/资料甲.md';
async function mark(fx: Awaited<ReturnType<typeof setup>>, patch: Record<string, unknown>) {
  const n = await fx.vault.read(SRC);
  await fx.vault.write(SRC, { frontmatter: { ...n.data, ...patch }, body: n.body }, { overwrite: true });
}

describe('user-upload document platforms', () => {
  it('人人文库 / 道客巴巴 / 豆丁 / 原创力文档 / 百度文库 are C, before any other rule', () => {
    for (const url of ['https://www.renrendoc.com/paper/123.html', 'https://www.doc88.com/p-1.html', 'https://www.docin.com/p-2.html', 'https://max.book118.com/html/2024/0601/1.shtm', 'https://wenku.baidu.com/view/abc.html']) {
      expect(isUserUploadPlatform(url)).toBe(true);
      const g = gradeSource({ url });
      expect(g.grade).toBe('C');
      expect(g.reason).toMatch(/用户上传文档的平台/);
    }
    expect(isUserUploadPlatform('https://www.baidu.com/s?wd=x')).toBe(false);
    expect(gradeSource({ url: 'https://www.nfra.gov.cn/x' }).grade).toBe('A');
  });

  it('an AI-graded note on such a platform reads as C whatever it was graded; the citation says it is a retelling', async () => {
    const fx = await setup();
    cleanup = fx.cleanup;
    await mark(fx, { url: 'https://www.renrendoc.com/paper/1.html', grade: 'B', graded_by: 'AI', origin: '网络' });
    const info = (await loadSourceInfo(fx.vault, SRC))!;
    expect(info.grade).toBe('C');
    const [d] = await claimBlocksOf(fx.vault, info);
    expect(footnoteText({ ...d, claimId: 'C1', subQuestionId: 'C1-Q1', round: 'kb', stance: 'supports', reason: '', core: false, partial: false })).toMatch(/（C 级，网络 · AI 定级 · 用户上传文档，转述）\[\[资料甲#\^c1\]\]$/);
    expect(describeSource({ grade: 'C', origin: '网络', gradedBy: 'AI', userUpload: true })).toBe('C 级 · 网络 · AI 定级 · 用户上传文档，转述');
    // a person's own grading stands
    await mark(fx, { graded_by: '人', grade: 'B' });
    expect((await loadSourceInfo(fx.vault, SRC))!.grade).toBe('B');
  });
});

describe('reliability on the source note', () => {
  it('disproven: never a candidate (vault lookup, logged), and dropped from a follow-up\'s starting evidence', async () => {
    const fx = await setup();
    cleanup = fx.cleanup;
    await mark(fx, { reliability: 'disproven', reliability_note: '所谓监管指引并不存在' });
    const r = await executeResearch({ ctx: fx.ctx, mode: 'small', model: scriptedModel().model, webClient: fakeWeb() });
    const body = (await fx.vault.read(r.reportPath)).body;
    expect(body).not.toContain('[[资料甲#^');
    expect((await fx.vault.readLog(fx.ctx.logPath)).some((l) => l.action === 'research:source-disproven' && l.change.includes('资料甲'))).toBe(true);
    const seed = await restoreEvidence(fx.vault, [{ claim: 'C1', sub: 'C1-Q1', ref: '[[资料甲#^c1]]', stance: 'supports', core: false, partial: false, round: 'kb', reason: '' }]);
    expect(seed).toEqual([]);
  });

  it('unverified: still evidence, marked 未核实 (with the note) in the report and in the citation panel', async () => {
    const fx = await setup();
    cleanup = fx.cleanup;
    await mark(fx, { reliability: 'unverified', reliability_note: '只找到转述，没找到原文' });
    const r = await executeResearch({ ctx: fx.ctx, mode: 'small', model: scriptedModel().model, webClient: fakeWeb() });
    const body = (await fx.vault.read(r.reportPath)).body;
    expect(body).toMatch(/^\[\^\d+\]: “[^”]+”（[^）]*· 未核实：只找到转述，没找到原文）\[\[资料甲#\^c\d\]\]$/m);
    expect(r.failedChecks).toEqual([]);
    expect(describeSource({ grade: 'B', origin: '知识库', gradedBy: '人', unverified: true })).toBe('B 级 · 知识库 · 未核实');
  });

  it('the schema accepts the fields (and only these values)', async () => {
    const { sourceSchema } = await import('@/lib/notes/schema');
    const fx = await setup();
    cleanup = fx.cleanup;
    const base = (await fx.vault.read(SRC)).data;
    expect(sourceSchema.safeParse({ ...base, reliability: 'unverified', reliability_note: 'x' }).success).toBe(true);
    expect(sourceSchema.safeParse({ ...base, reliability: 'maybe' }).success).toBe(false);
  });
});
