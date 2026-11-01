/**
 * D-21-4 v4 (a): the full-budget follow-up's first-hand passes stop only on a page fetched in THIS run whose source
 * type is 监管 / 采购招标 / 官方发布. In C's v4 they never ran: the knowledge base's Gartner and 数位时代 notes (B, v3's
 * H4 evidence, "new" for C2) counted as first-hand, so all six passes were skipped after 2 searches.
 * The source notes are C's real ones (tests/fixtures/d21b-v4/sources/).
 */
import { readFileSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildToolContext } from '@/lib/harness';
import type { Evidence } from '@/lib/research/evidence';
import { executeResearch } from '@/lib/research/execute';
import { addFollowUpSubQuestion, executeFollowUp, FIRST_HAND_PASSES, isFirstHand } from '@/lib/research/followup';
import { FIRST_HAND_CATEGORIES, sourceCategory } from '@/lib/research/grading';
import { clearPageCache } from '@/lib/research/page-cache';
import { claimBlocksOf, loadSourceInfo } from '@/lib/research/sources';
import { createVault } from '@/lib/vault';
import { ROLES } from '../helpers/fixture-vault';
import { fakeWeb, RDIR, scriptedModel, setup, WS } from './research-fixture';

vi.setConfig({ testTimeout: 60_000 });

let cleanup: (() => Promise<void>) | undefined;
afterEach(async () => {
  clearPageCache();
  await cleanup?.();
  cleanup = undefined;
});

describe('sourceCategory: deterministic, from the URL only', () => {
  it.each([
    ['https://www.nfra.gov.cn/cn/view/pages/ItemDetail.html?docId=1', 'regulator'],
    ['https://www.miit.gov.cn/zwgk/zcwj/wjfb/tz/art/2026/art_1.html', 'regulator'],
    ['https://www.sec.gov/Archives/edgar/data/1/0001.htm', 'regulator'],
    ['https://www.ccgp.gov.cn/cggg/zygg/gkzb/202610/t20261020_1.htm', 'procurement'],
    ['http://www.ccgp-jiangsu.gov.cn/ggxx/gkzbgg/1.html', 'procurement'],
    ['https://www.ggzy.gov.cn/information/deal/html/a/1.html', 'procurement'],
    ['https://www.cebpubservice.com/ctpsp_iiss/searchbusinesstypebeforedooraction/getStringMethod.do', 'procurement'],
    ['https://ted.europa.eu/en/notice/-/detail/1-2026', 'procurement'],
    ['https://www.nanjing.gov.cn/zfcg/cggg/202610/t1.html', 'procurement'], // a government site's procurement notice page
    ['https://www.lenovo.com.cn/news/2026/ai-pc.html', 'official'],
    ['https://investor.example-corp.com/news/2026', 'official'],
    ['https://www.tsinghua.edu.cn/info/1.htm', 'official'],
    ['https://www.gartner.com/en/newsroom/press-releases/2026-02-26-gartner-says-surging-memory-costs', 'research'],
    ['https://www.idc.com/getdoc.jsp?containerId=1', 'research'],
    ['https://www.reuters.com/technology/ai-pc-2026', 'media'],
    ['https://www.bnext.com.tw/article/92616/ai-pc-shipments-crash-2026-q3-ram-shortage', 'other'], // 数位时代
    ['https://www.gcph.com.cn/contents/773/5134.html', 'other'], // 南京市高淳人民医院 (C): not a listed site
    ['https://www.gcph.com.cn/zbgg/773/5134.html', 'other'], // a procurement-looking path on a C site is still not trusted
    ['https://www.renrendoc.com/paper/477316881.html', 'other'], // 用户上传文档：never a source
    ['https://mp.weixin.qq.com/s/abc', 'other'],
    ['not a url', 'other'],
  ])('%s → %s', (url, kind) => {
    expect(sourceCategory(url)).toBe(kind);
  });

  it('the first-hand types are exactly the three kinds of FIRST_HAND_PASSES', () => {
    expect([...FIRST_HAND_CATEGORIES].sort()).toEqual(['official', 'procurement', 'regulator']);
    expect(FIRST_HAND_PASSES.map((p) => p.kind)).toEqual(['监管规定原文', '招标与采购文件', '官方发布']);
  });
});

describe('isFirstHand on v4\'s real evidence', () => {
  async function evidenceOf(name: string, block: string, override: Partial<Evidence> = {}): Promise<Evidence> {
    const root = await mkdtemp(path.join(tmpdir(), 'sw-firsthand-'));
    const prev = cleanup;
    cleanup = async () => {
      await prev?.();
      await rm(root, { recursive: true, force: true });
    };
    await mkdir(path.join(root, '10_资料库'), { recursive: true });
    await writeFile(path.join(root, '10_资料库', `${name}.md`), readFileSync(path.join('tests/fixtures/d21b-v4/sources', `${name}.md`)));
    const vault = createVault(root);
    const info = (await loadSourceInfo(vault, `10_资料库/${name}.md`))!;
    const [d] = await claimBlocksOf(vault, info, new Set([block]));
    return { ...d, claimId: 'C2', subQuestionId: 'C2-Q5', round: 'kb', stance: 'supports', reason: '', core: false, partial: false, ...override };
  }
  const none = new Set<string>();

  it('the knowledge base\'s Gartner and 数位时代 (B, v3\'s H4 evidence, new for C2) are not first-hand: v4\'s false "found"', async () => {
    const gartner = await evidenceOf('Gartner 2026-02 内存涨价压低出货', 'c4'); // [^86]
    const bnext = await evidenceOf('数位时代 2026-10 AI换机潮落空', 'c4'); // [^91]
    expect(gartner.grade).toBe('B');
    expect(bnext.grade).toBe('B');
    // reused from the vault: not fetched by this run
    expect(isFirstHand(none, none)(gartner)).toBe(false);
    expect(isFirstHand(none, none)(bnext)).toBe(false);
    // even fetched again now, an analyst firm's press release / a media article retells the original
    expect(isFirstHand(none, new Set([gartner.path]))(gartner)).toBe(false);
    expect(isFirstHand(none, new Set([bnext.path]))(bnext)).toBe(false);
  });

  it('the hospital\'s procurement page this run fetched ([^97]) is C: not an A/B first-hand source', async () => {
    const hospital = await evidenceOf('南京市高淳人民医院', 'c1');
    expect(hospital.grade).toBe('C');
    expect(isFirstHand(none, new Set([hospital.path]))(hospital)).toBe(false);
  });

  it('a regulator / procurement / official page counts only when this run fetched it and vN did not already cite it', async () => {
    const base = await evidenceOf('Gartner 2026-02 内存涨价压低出货', 'c4');
    const gov = { ...base, path: '10_资料库/监管通知.md', ref: '[[监管通知#^c1]]', url: 'https://www.nfra.gov.cn/cn/view/pages/ItemDetail.html?docId=1', grade: 'A' as const };
    const fetched = new Set([gov.path]);
    expect(isFirstHand(none, fetched)(gov)).toBe(true);
    expect(isFirstHand(none, none)(gov)).toBe(false); // found again in the vault
    expect(isFirstHand(new Set([gov.ref]), fetched)(gov)).toBe(false); // vN's evidence
    expect(isFirstHand(none, fetched)({ ...gov, sourceKind: 'expert' })).toBe(false);
    expect(isFirstHand(none, fetched)({ ...gov, url: 'https://www.ccgp.gov.cn/cggg/zygg/gkzb/1.htm' })).toBe(true);
    expect(isFirstHand(none, fetched)({ ...gov, url: 'https://www.lenovo.com.cn/news/1.html' })).toBe(true);
  });
});

describe('a full-budget follow-up: what ends the first-hand passes', () => {
  const QUESTION = '集中部署配置和数据权限边界，是否真的写进了采购的资格条款';
  /** A B-grade analyst note already in the knowledge base (like v4's Gartner), that the kb search finds for the new sub-question. */
  const GARTNER = `---
id: src-gartner-kb
type: source
status: 推断
created: "2026-10-20"
updated: "2026-10-20"
author: AI
derived_from: ["[[团队]]"]
relates_to: ["[[团队]]"]
url: https://www.gartner.com/en/newsroom/press-releases/2026-02-26-it-buyers
publisher: Gartner
published: "2026-02-26"
retrieved: "2026-10-20"
origin: 网络
grade: B
graded_by: AI
authority: 3
link_checked: true
---

# Gartner 2026-02 IT 买方

## 论断

- 「IT 部门在企业 AI PC 采购里看重可管理性和预算。」— 位置：第 2 段 ^c1
`;

  async function fullFollowUp(web: ReturnType<typeof fakeWeb>) {
    const fx = await setup({ approved: true });
    cleanup = fx.cleanup;
    const first = await executeResearch({ ctx: fx.ctx, mode: 'small', model: scriptedModel().model, webClient: fakeWeb() });
    expect(first.delivered).toBe(true);
    // added after v1, so it is new evidence for the follow-up, found in the vault (not fetched)
    await fx.vault.write('10_资料库/Gartner 2026-02 IT 买方.md', { frontmatter: (await import('@/lib/vault/frontmatter')).parseMarkdown(GARTNER).data, body: (await import('@/lib/vault/frontmatter')).parseMarkdown(GARTNER).body });
    const added = await addFollowUpSubQuestion({ vault: fx.vault, workspacePath: WS, researchDir: RDIR, role: ROLES.juniorA, claimId: 'C1', question: QUESTION });
    const ctx = await buildToolContext({ vault: fx.vault, role: ROLES.juniorA, workspacePath: WS, researchDir: RDIR, track: 'research' });
    const follow = await executeFollowUp({ ctx, claimId: 'C1', subQuestionId: added.subQuestionId, model: scriptedModel().model, webClient: web, budget: 'full' });
    return { v2: await fx.vault.read(follow.reportPath), log: await fx.vault.readLog(fx.ctx.logPath) };
  }

  it('a B-grade analyst note reused from the knowledge base does not end them: all six run (v4 ran none)', async () => {
    const web = fakeWeb();
    const { v2, log } = await fullFollowUp(web);
    expect(v2.body).toContain('[[Gartner 2026-02 IT 买方#^c1]]'); // the reused note IS new evidence of this follow-up
    expect(log.filter((r) => r.action === 'research:first-hand')).toHaveLength(FIRST_HAND_PASSES.length * 2);
    expect(v2.body).toContain('查完仍没有找到，这一问判为证据不足，转成要问专家的问题');
  });

  it('B-grade analyst pages fetched now do not end them either; a regulator page fetched now does', async () => {
    const asGartner = fakeWeb();
    const search = asGartner.search.bind(asGartner);
    let k = 0;
    asGartner.search = async (req) => {
      const out = await search(req);
      out.results = out.results.map((r) => ({ ...r, url: `https://www.gartner.com/en/newsroom/press-releases/report/${900 + ++k}`, site_name: 'Gartner' }));
      return out;
    };
    const research = await fullFollowUp(asGartner);
    expect(research.log.filter((r) => r.action === 'research:first-hand')).toHaveLength(FIRST_HAND_PASSES.length * 2);
    await cleanup?.();
    cleanup = undefined;
    clearPageCache();

    const asRegulator = fakeWeb();
    const search2 = asRegulator.search.bind(asRegulator);
    let j = 0;
    asRegulator.search = async (req) => {
      const out = await search2(req);
      if (/^enterprise AI PC procurement tender|IT 可管理性|企业 AI PC 采购/.test(req.query) && !req.query.includes('员工 并不在乎')) {
        out.results = out.results.map((r) => ({ ...r, url: `https://www.nfra.gov.cn/cn/view/pages/report/${700 + ++j}`, site_name: '金融监管总局' }));
      }
      return out;
    };
    const regulator = await fullFollowUp(asRegulator);
    expect(regulator.log.filter((r) => r.action === 'research:first-hand').length).toBeLessThan(FIRST_HAND_PASSES.length * 2);
    expect(regulator.v2.body).not.toContain('这一问的结论：证据不足（这次没有找到一手来源）');
  });
});
