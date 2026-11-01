/**
 * D-64 T51: the M1 library holds real sources with their fetched text; every claim is a verbatim sentence of that text
 * (whitespace collapsed: a chart's cells are fetched one per line; a PDF wraps Chinese lines where the text has no space,
 * so a claim is also found with all whitespace removed), and every number the document uses is in a claim.
 */
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { gradeSource } from '@/lib/research/grading';
import { createVault, type VaultNote } from '@/lib/vault';

const LIB = '10_资料库';
const library = createVault(path.resolve('demo-vault/.snapshots/m1-qira'));
const mockWeb = createVault(path.resolve('tests/fixtures'));
const FIELDS = ['id', 'type', 'status', 'created', 'updated', 'author', 'derived_from', 'relates_to', 'url', 'publisher', 'published', 'retrieved', 'origin', 'grade', 'graded_by', 'authority', 'link_checked'];
const norm = (s: string) => s.replace(/\s+/g, ' ').trim();
const bare = (s: string) => s.replace(/\s+/g, '');
const claims = (n: VaultNote) => [...n.body.split('## 抓取原文')[0].matchAll(/^- 「(.+)」— 位置：.*\^c\d+\s*$/gm)].map((m) => m[1]);
const fetched = (n: VaultNote) => n.body.split(/^## 抓取原文\s*$/m)[1] ?? '';

async function notes(): Promise<VaultNote[]> {
  const lib = await Promise.all(readdirSync(path.join(library.root, LIB)).filter((f) => f.endsWith('.md')).map((f) => library.read(`${LIB}/${f}`)));
  const web = await Promise.all(readdirSync(path.join(mockWeb.root, 'mock-web')).filter((f) => f.endsWith('.md')).map((f) => mockWeb.read(`mock-web/${f}`)));
  return [...lib, ...web];
}

/** Handbook T51: each number of the document, and the source whose claims must carry it. */
const NUMBERS: [string, string[]][] = [
  // 49% is not verbatim on the "Americans and AI 2026" page (it says "About half"); the same survey's
  // "Why Don't People Use Chatbots?" page has it in its chart (see the execution record, T51)
  ['Pew 2026-06 Why Don’t People Use Chatbots', ['49%']],
  ['Pew 2026-06 Americans and AI 2026', ['24%']],
  ['Pew 2026-06 How Opinions and Use of AI Differ by Age', ['34%', '31%']],
  ['RevenueCat 2026 State of Subscription Apps', ['6.1%', '9.5%']],
  ['Ping Identity 2026-06 Consumer Survey AI Trust', ['33%', 'five hours']],
  ['联想 2026-09 Qira扩展', ['more than 80 supported PC configurations']],
  ['Gartner 2026-05 消费者要 AI 帮忙购物，不要 AI 替自己下单', ['11%']],
  ['OECD 2026-01 个人 AI 使用', ['more than one-third of individuals across the OECD']],
];

describe('T51 sources', () => {
  it('1. every note has the 17 fields, and the preset ones are graded by a person', async () => {
    const all = await notes();
    expect(all.length).toBeGreaterThanOrEqual(10);
    for (const n of all) {
      for (const f of FIELDS) expect(n.data, `${n.path} lacks ${f}`).toHaveProperty(f);
      expect(n.note?.type, n.path).toBe('source');
    }
    const pew = all.find((n) => n.title === 'Pew 2026-06 Americans and AI 2026')!;
    expect(pew.data).toMatchObject({ grade: 'A', graded_by: '人', origin: '预置' });
  });

  it('2. every claim is found verbatim in the note\'s fetched text', async () => {
    for (const n of await notes()) {
      const page = norm(fetched(n));
      // the public edition keeps only the quoted claims of each fetched page (no third-party full text): the section
      // must still be there, and every claim must still be found in it verbatim
      expect(page.length, `${n.path} has no ## 抓取原文`).toBeGreaterThan(0);
      const cs = claims(n);
      expect(cs.length, n.path).toBeGreaterThan(0);
      for (const c of cs) expect(page.includes(norm(c)) || bare(page).includes(bare(c)), `${n.path}: 「${c.slice(0, 60)}」`).toBe(true);
    }
  });

  it('3. each number the document uses is in a claim of its source', async () => {
    const all = await notes();
    for (const [title, nums] of NUMBERS) {
      const n = all.find((x) => x.title === title);
      expect(n, title).toBeDefined();
      const text = claims(n!).join('\n');
      for (const num of nums) expect(text, `${title} ${num}`).toContain(num);
    }
  });

  it('S10 Recon Analytics and S12 Gartner are mock-web pages, not in the library; reconanalytics.com grades B as a research firm', async () => {
    expect(readdirSync(path.join(library.root, LIB)).some((f) => f.startsWith('Recon') || f.startsWith('Gartner'))).toBe(false);
    expect(readdirSync(path.join(mockWeb.root, 'mock-web')).sort()).toEqual(['Gartner 2026-05 消费者要 AI 帮忙购物，不要 AI 替自己下单.md', 'Recon Analytics 2026-10 AI 用户切换工具.md']);
    expect(gradeSource({ url: 'https://www.reconanalytics.com/ai-tool-switching/' }).grade).toBe('B');
  });
});
