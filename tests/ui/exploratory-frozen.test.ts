/** Frozen S3 reports must render byte-for-byte as before (D-56 5a only changes what NEW notes are written as). */
import { readFile, readdir } from 'node:fs/promises';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ReportViewer } from '@/components/research/report-viewer';
import { parseMarkdown } from '@/lib/vault/frontmatter';

const DIR = 'demo-vault/.snapshots/S3-C7-ws-a/20_项目/个人AI战略/WS-A 买方/调查/买方采购逻辑';
const html = (el: Parameters<typeof renderToString>[0]) => renderToString(el).replace(/<!-- -->/g, '');

describe('frozen S3 reports', () => {
  it('render the exploratory ones exactly as before', async () => {
    const files = (await readdir(DIR)).filter((f) => /^报告 v\d+\.md$/.test(f)).sort();
    const notes = await Promise.all(files.map(async (file) => ({ file, ...parseMarkdown(await readFile(`${DIR}/${file}`, 'utf8')) })));
    const exploratory = notes.filter((n) => n.data.exploratory === true);
    // 报告 v2 is the frozen exploratory report the task names. Its frontmatter says
    // `exploratory: false` in this snapshot, so fall back to it rather than snapshot nothing.
    const targets = exploratory.length ? exploratory : notes.filter((n) => n.file === '报告 v2.md');
    expect(targets.length).toBeGreaterThan(0);
    for (const note of targets) {
      const out = html(
        createElement(ReportViewer, {
          markdown: note.body,
          exploratory: true,
          delivery: note.data.delivery as '已交付' | '草稿',
          citations: {},
        }),
      );
      expect(out).toContain('探索性');
      expect(out).toMatchSnapshot(note.file);
    }
  });
});
