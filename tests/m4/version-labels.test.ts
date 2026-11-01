/**
 * The versions a run left on the way say what they are (lib/research/version-status.ts), on the real files of C's
 * "买方采购逻辑（问题树）" (tests/fixtures/ws-a-tree-versions, copied as they are from C's S3 copy): v1 a 试水调查, v2 and
 * v3 full runs the self-check stopped as drafts — v2 on E5–E8 inside a %-encoded URL, v3 on "E7 Frontier Suite", a
 * product name the source quote also writes. A delivered v4 (C's rerun, not yet run) is added in a temp vault.
 */
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { defaultVersion, draftReason, isSmallRun, rewrittenFrom, versionStatuses, type VersionInfo } from '@/lib/research/version-status';
import { createVault } from '@/lib/vault';

const FIX = 'tests/fixtures/ws-a-tree-versions';
const fixtures = createVault(path.resolve(FIX));
// the files as the vault reads them (frontmatter and body), under a short path
const real = async (n: number): Promise<VersionInfo> => {
  const x = await fixtures.read(`报告 v${n}.md`);
  return { path: `d/报告 v${n}.md`, n, data: x.data, body: x.body };
};
const [V1, V2, V3] = await Promise.all([1, 2, 3].map(real));
const V4: VersionInfo = { path: 'd/报告 v4.md', n: 4, data: { delivery: '已交付', failed_checks: [], report_format: 'question_tree', research_run: { mode: 'full' } }, body: V3.body };

describe('the real WS-A versions', () => {
  it('as they are now: v1 a 试水调查 (delivered), v2 and v3 drafts stopped by an evidence-key false positive', () => {
    expect(V1.data).toMatchObject({ delivery: '已交付', research_run: { mode: 'small' } });
    expect(V2.data.failed_checks).toHaveLength(4);
    expect(Object.fromEntries(versionStatuses([V3, V2, V1]))).toEqual({
      'd/报告 v1.md': { label: '试水调查 · 只回答了第一个子问题', note: false },
      'd/报告 v2.md': { label: '草稿 · 自检未通过（证据编号检查误报）', note: true },
      'd/报告 v3.md': { label: '草稿 · 自检未通过（证据编号检查误报）', note: true },
    });
  });

  it('after C\'s rerun delivers v4: v1–v3 say "之后的 v4 已交付", v4 has no label', () => {
    const s = versionStatuses([V4, V3, V2, V1]);
    expect(s.get('d/报告 v1.md')?.label).toBe('试水调查 · 只回答了第一个子问题 · 之后的 v4 已交付');
    expect(s.get('d/报告 v2.md')?.label).toBe('草稿 · 自检未通过（证据编号检查误报） · 之后的 v4 已交付');
    expect(s.get('d/报告 v3.md')?.label).toBe('草稿 · 自检未通过（证据编号检查误报） · 之后的 v4 已交付');
    expect(s.has('d/报告 v4.md')).toBe(false);
  });

  it('the drafts name a later delivered version only: before v4, v1 (delivered) comes before them, not after', () => {
    expect(versionStatuses([V3, V2, V1]).get('d/报告 v2.md')?.label).not.toContain('之后的');
    // a later delivered version: the latest one is named
    const v5 = { ...V4, path: 'd/报告 v5.md', n: 5 };
    expect(versionStatuses([v5, V4, V3, V2, V1]).get('d/报告 v1.md')?.label).toMatch(/之后的 v5 已交付$/);
  });

  it('the page shows the latest delivered version by default: v1 now, v4 once it is there', () => {
    expect(defaultVersion([V3, V2, V1])?.n).toBe(1);
    expect(defaultVersion([V1, V2, V3, V4])?.n).toBe(4);
    expect(defaultVersion([V3, V2])?.n).toBe(3); // nothing delivered: the latest
    expect(defaultVersion([])).toBeUndefined();
  });
});

describe('the reason in plain words: the first kind of failed_checks', () => {
  const leak = '# x\n\n- 缺口：报道称资金仍会照常经 IT 预算流入 [E59]，这一反证没有被驳倒\n';

  it('evidence keys: a false positive when every key is the source\'s own text (%-encoded, or in a quoted original); a leak otherwise', () => {
    expect(draftReason(V2.data.failed_checks, V2.body)).toBe('证据编号检查误报');
    expect(draftReason(V3.data.failed_checks, V3.body)).toBe('证据编号检查误报');
    expect(draftReason(['证据编号没有展开成引用：[E59]', '正文里直接写了证据编号 E59：要么写成 [E59] 展开成引用，要么删掉'], leak)).toBe('正文里漏出了证据编号');
    // the draft notice above the title repeats the keys: not counted as where they are
    expect(draftReason(['正文里直接写了证据编号 E7：要么写成 [E7] 展开成引用，要么删掉'], `> - 正文里直接写了证据编号 E7\n\n# x\n\nE7 的结论成立\n`)).toBe('正文里漏出了证据编号');
  });

  it('other kinds; one it has no words for says "见报告顶部"', () => {
    expect(draftReason(['judge:C2: 判断的输出到了长度上限（16000 tokens，含模型思考）被截断'], '')).toBe('判断输出被截断');
    expect(draftReason(['引号里的原文和资料里的那一块对不上：[[资料A#^c1]]'], '')).toBe('引用的原文和资料对不上');
    expect(draftReason(['这一行有数字但没有出处：72% 的采购', '缺少“Summary”一节'], '')).toBe('数字没有出处'); // the first one
    expect(draftReason(['子问题 Q2 没有回答（“### Q2 的回答”下面要写出回答）'], '')).toBe('报告缺了必需的部分');
    expect(draftReason(['写入后的文件自检失败：[[资料A#^c1]]'], '')).toBe('写好的文件复查没有通过');
    expect(draftReason(['某个以后才有的检查没过'], '')).toBe('见报告顶部');
    expect(draftReason([], '')).toBe('见报告顶部');
    expect(draftReason(undefined, '')).toBe('见报告顶部');
  });
});

describe('what counts', () => {
  it('a 追加调查 records its budget as the mode: not a 试水调查; an older-structure small run "只查了第一个假设"', () => {
    expect(isSmallRun({ research_run: { mode: 'small', followUp: true }, follow_up: { claim: 'C1' } })).toBe(false);
    expect(isSmallRun({ run_mode: 'small' })).toBe(true);
    const old: VersionInfo = { path: 'd/报告 v1.md', n: 1, data: { delivery: '已交付', research_run: { mode: 'small' }, content_confirmed_by: '用户' }, body: '## 逐个假设\n' };
    expect(versionStatuses([old]).get(old.path)?.label).toBe('试水调查 · 只查了第一个假设');
  });

  it('a draft with no failed_checks gets no 自检 label (it was not the self-check)', () => {
    const d: VersionInfo = { ...V4, data: { delivery: '草稿', failed_checks: [], report_format: 'question_tree', research_run: { mode: 'full' } } };
    expect(versionStatuses([d]).has(d.path)).toBe(false);
  });

  it('a version only rewritten from an earlier one\'s evidence (D-48): "用 vN 的证据重写，没有重新调查", the earlier one unlabelled', async () => {
    const x = await createVault(path.resolve('tests/fixtures/d47')).read('报告 v5（样例）.md');
    const v5: VersionInfo = { path: 'd/报告 v5.md', n: 5, data: x.data, body: x.body };
    expect(rewrittenFrom(v5.data)).toBe(4);
    const s = versionStatuses([v5, V4, V3, V2, V1]);
    expect(s.get(v5.path)).toEqual({ label: '用 v4 的证据重写，没有重新调查', note: false });
    expect(s.has(V4.path)).toBe(false);
    expect(defaultVersion([v5, V4])?.path).toBe(v5.path);
    // rewrite_of written without the version, or left out: "上一版"; neither field: not a rewrite
    expect(rewrittenFrom({ research_run: { rewrite: true } })).toBe(0);
    expect(versionStatuses([{ ...v5, data: { ...v5.data, rewrite_of: '[[报告]]' } }]).get(v5.path)?.label).toBe('用上一版的证据重写，没有重新调查');
    expect(rewrittenFrom(V4.data)).toBeNull();
    // a rewrite the self-check stopped says both
    const draft = { ...v5, data: { ...v5.data, delivery: '草稿', failed_checks: ['这一行有数字但没有出处：…'] } };
    expect(versionStatuses([draft]).get(v5.path)?.label).toBe('用 v4 的证据重写，没有重新调查 · 草稿 · 自检未通过（数字没有出处）');
  });
});

describe('where it shows', () => {
  let cleanup: (() => Promise<void>) | undefined;
  afterEach(async () => {
    await cleanup?.();
    cleanup = undefined;
  });

  it('the report page: a draft opened says the same at the top', async () => {
    const { ReportViewer } = await import('@/components/research/report-viewer');
    const { createElement } = await import('react');
    const { renderToString } = await import('react-dom/server');
    const label = versionStatuses([V4, V3, V2, V1]).get(V3.path)!;
    expect(label.note).toBe(true);
    const html = renderToString(createElement(ReportViewer, { markdown: V3.body, citations: {}, delivery: '草稿', failedChecks: V3.data.failed_checks as string[], statusNote: label.label })).replace(/<!-- -->/g, '');
    expect(html).toContain('这一版是草稿 · 自检未通过（证据编号检查误报） · 之后的 v4 已交付：不要把它当成确认过的最新结论。');
  });
});
