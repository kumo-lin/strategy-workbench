/** Method notes reach the model whole (cut only at section boundaries): so what 提炼's step 4 must not be cut off. */
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { excerptBySections } from '@/lib/research/context';
import { parseMarkdown } from '@/lib/vault/frontmatter';

const DIR = path.join(process.cwd(), 'demo-vault/00_团队知识/方法库');

describe('excerptBySections', () => {
  it('the real so what 提炼 note keeps step 4 "推到 Now what" and its last bullet', () => {
    const file = readdirSync(DIR).find((f) => /so what/i.test(f))!;
    const body = parseMarkdown(readFileSync(path.join(DIR, file), 'utf8')).body;
    const out = excerptBySections(body, 8000);
    expect(out).toContain('推到 Now what');
    expect(out).toContain('什么情况下要改');
  });
  it('a note longer than the limit is cut between sections, never inside one', () => {
    const body = `# t\n\n## 一\n${'甲'.repeat(50)}\n\n## 二\n${'乙'.repeat(50)}\n\n## 三\n${'丙'.repeat(50)}\n`;
    const out = excerptBySections(body, 130);
    expect(out).toContain('## 二');
    expect(out).not.toContain('## 三');
    expect(out).toContain('后面的小节略');
  });
});
