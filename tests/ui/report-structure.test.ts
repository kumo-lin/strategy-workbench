/** D-48 page: the third layer of each hypothesis card is folded and the question tree is drawn; other reports show as before. */
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { parseMarkdown } from '@/components/research/markdown-lite';
import { conditionLine, duplicateAnswerBlocks, findFolds, foldTitle, isQuestionTree, questionTree } from '@/components/research/report-structure';
import { ReportViewer } from '@/components/research/report-viewer';
import { lengthKey, readLengthFlags } from '@/lib/report/length-flags';
import { parseMarkdown as parseNote } from '@/lib/vault';

const html = (el: Parameters<typeof renderToString>[0]) => renderToString(el).replace(/<!-- -->/g, '');
const V4 = readFileSync('tests/fixtures/ws-a-tree-versions/报告 v4.md', 'utf8');
const render = (markdown: string) => html(createElement(ReportViewer, { markdown, citations: {}, delivery: '已交付' }));

describe('the fold around each hypothesis card (v4 of WS-A)', () => {
  const blocks = parseMarkdown(V4);
  const folds = findFolds(blocks);

  it('is a question-tree report with six cards, each with one fold', () => {
    expect(isQuestionTree(blocks)).toBe(true);
    expect(folds).toHaveLength(6);
  });

  it('counts the evidence rows, the challenge rows and the questions for the expert', () => {
    expect(folds[0].counts).toEqual({ support: 5, counter: 28, asks: 5 });
    expect(foldTitle(folds[0].counts)).toBe('证据、反证和挑战、缺口（支持 5 · 反证 28 · 要问专家 5）');
  });

  it('starts at 支持的证据 and ends before the next heading', () => {
    for (const f of folds) {
      const list = blocks[f.start];
      expect(list.kind).toBe('list');
      expect(blocks[f.end]?.kind === 'heading' || f.end === blocks.length).toBe(true);
      expect(blocks.slice(f.start + 1, f.end).some((b) => b.kind === 'heading')).toBe(false);
    }
  });

  it('is closed by default, and what it holds comes after 判断 / 理由 / So What', () => {
    const out = render(V4);
    expect(out.match(/data-testid="evidence-fold"/g)).toHaveLength(6);
    expect(out).not.toMatch(/<details[^>]*\sopen/);
    expect(out).toContain('证据、反证和挑战、缺口（支持 5 · 反证 28 · 要问专家 5）');
    const first = out.indexOf('data-testid="evidence-fold"');
    const closed = out.indexOf('</details>', first);
    const inside = out.slice(first, closed);
    expect(inside).toContain('支持的证据：');
    expect(inside).toContain('反证和挑战（逐条回应）：');
    expect(inside).toContain('缺口，以及要问专家的问题：');
    // the card's own lines stay outside, before the fold
    const before = out.slice(0, first);
    expect(before).toContain('提议的判断：');
    expect(before).toContain('So What：');
    expect(before).not.toContain('支持的证据：');
  });
});

describe('the question tree is drawn under the Summary 问题树 line', () => {
  it('Q1, Q2 → Q2-1, Q2-2, Q3 → Q3-1…3-3, with each question after its number', () => {
    const tree = questionTree(parseMarkdown(V4));
    expect(tree.map((n) => n.id)).toEqual(['Q1', 'Q2', 'Q3']);
    expect(tree[1].children.map((n) => n.id)).toEqual(['Q2-1', 'Q2-2']);
    expect(tree[2].children.map((n) => n.id)).toEqual(['Q3-1', 'Q3-2', 'Q3-3']);
    expect(tree[1].children[0].text).toMatch(/^“可管”是不是放行的门槛/);
  });

  it('is in the Summary right after the 问题树 line, and the headings carry the anchors the nodes link to', () => {
    const out = render(V4);
    const line = out.indexOf('问题树：');
    const tree = out.indexOf('data-testid="question-tree"');
    expect(line).toBeGreaterThan(0);
    expect(tree).toBeGreaterThan(line);
    expect(tree).toBeLessThan(out.indexOf('各子问题的回答：'));
    expect(out).toContain('href="#q-Q2-1"');
    expect(out).toContain('id="q-Q2-1"');
    expect(out).toContain('id="q-Q3"');
  });
});

describe('other reports show as before', () => {
  it('a flat report (no question tree) has no fold and no tree', () => {
    const flat = ['## Summary', '- 回答：x', '', '## 逐个假设', '', '### H1 一个假设', '- 提议的判断：成立', '- 支持的证据：', '  - a', '- 反证和挑战（逐条回应）：无'].join('\n');
    const out = render(flat);
    expect(out).not.toContain('evidence-fold');
    expect(out).not.toContain('question-tree');
    expect(out).toContain('支持的证据：');
  });

  it('a tree report whose card has no 支持的证据 line has no fold for that card', () => {
    const md = ['## Summary', '- 问题树：核心问题 → Q1 问', '', '## Q1 问', '', '### 假设 H1：x', '- 提议的判断：成立', '', '### Q1 的回答', '', '答'].join('\n');
    const out = render(md);
    expect(out).not.toContain('evidence-fold');
    expect(out).toContain('data-testid="question-tree"');
  });
});

function firstItem(md: string) {
  const list = parseMarkdown(md)[0];
  if (list?.kind !== 'list') throw new Error('not a list');
  return list.items[0].inline;
}

const CARD = [
  '## Summary',
  '- 问题树：核心问题 → Q1 谁拍板？',
  '',
  '## Q1 谁拍板？',
  '',
  '### 假设 H1：IT 一手包办',
  '- 当时的假设，逐条对照：',
  '  - ① 买不买由 IT 决定 → 成立[^1][^2]',
  '  - ② 钱从 IT 预算出 → 不成立：22% 由 IT 集中管[^3]',
  '  - ③ 员工自己订阅走不到企业采购 → 证据不足',
  '- 提议的判断：需要修改（② 不成立、③ 证据不足）',
  '- 改了什么：改成 IT 管准入、钱由多方出',
  '- 回答：IT 管准入；钱由多方出[^3]',
  '- 支持的证据：',
  '',
  '### Q1 的回答',
  '',
  'IT 管准入；钱由多方出[^3]',
  '',
  '## 对 workplan 的影响',
].join('\n');

describe('①②③: the plan\'s conditions with what the check found', () => {
  it('splits a line at its status', () => {
    const line = conditionLine(firstItem('- ② 钱从 IT 预算出 → 不成立：22% 由 IT 集中管[^3]'));
    expect(line?.mark).toBe('②');
    expect(line?.status).toBe('不成立');
    expect(JSON.stringify(line?.before)).toContain('钱从 IT 预算出');
    expect(JSON.stringify(line?.after)).toContain('22% 由 IT 集中管');
  });

  it('is shown as three lines with a status each, in the plan\'s order, outside the fold', () => {
    const out = render(CARD);
    expect(out.match(/data-testid="hypothesis-condition"/g)).toHaveLength(3);
    expect([...out.matchAll(/data-status="([^"]+)"/g)].map((m) => m[1])).toEqual(['成立', '不成立', '证据不足']);
    expect(out.indexOf('data-testid="hypothesis-condition"')).toBeLessThan(out.indexOf('data-testid="evidence-fold"'));
  });

  it('an ordinary list item is not a condition', () => {
    expect(conditionLine(firstItem('- 提议的判断：成立'))).toBeNull();
  });
});

describe('an unsplit sub-question shows its answer once', () => {
  it('the card\'s 回答 stays, the same sentence under ### Q1 的回答 is left out', () => {
    const blocks = parseMarkdown(CARD);
    expect(duplicateAnswerBlocks(blocks).size).toBe(2); // the heading and its paragraph
    const out = render(CARD);
    expect(out.match(/IT 管准入；钱由多方出/g)).toHaveLength(1);
    expect(out).not.toContain('Q1 的回答');
  });

  it('a different sentence (a roll-up of split questions) stays', () => {
    const md = CARD.replace('IT 管准入；钱由多方出[^3]\n\n## 对', '合起来的另一句话。\n\n## 对');
    expect(duplicateAnswerBlocks(parseMarkdown(md)).size).toBe(0);
    expect(render(md)).toContain('Q1 的回答');
  });

  it('older reports (no 回答： line in the card) keep their 回答 section', () => {
    const out = render(V4);
    expect(out).toContain('Q1 的回答');
    expect(out).toContain('Q3 的回答');
  });
});

describe('length_flags: ⚠ 超过 N 字 beside the over-long sentence', () => {
  const LONG = 'IT 管准入；钱由多方出，IT 集中出的只占约两成';
  const md = CARD.replace('回答：IT 管准入；钱由多方出[^3]', `回答：${LONG}[^3]`).replace('### Q1 的回答\n\nIT 管准入；钱由多方出[^3]\n\n', '');
  const flags = [{ where: 'Q1 回答', text: `${LONG}[^3]`, limit: 10, length: 23 }];

  it('reads the frontmatter field and leaves out what does not fit', () => {
    expect(readLengthFlags({ length_flags: [...flags, { where: 'x' }, 'y'] })).toEqual(flags);
    expect(readLengthFlags({})).toEqual([]);
  });

  it('matches a sentence however its marks are written', () => {
    expect(lengthKey('所以联想“不押”NPU[^3!] （推断）[E4]')).toBe('所以联想不押NPU');
  });

  it('marks the entry holding the sentence, and only that one', () => {
    const out = html(createElement(ReportViewer, { markdown: md, citations: {}, delivery: '已交付', lengthFlags: flags }));
    expect(out.match(/data-testid="length-warning-tag"/g)).toHaveLength(1);
    expect(out).toContain('⚠ 超过 10 字');
    expect(out.indexOf('length-warning-tag')).toBeGreaterThan(out.indexOf(LONG));
    expect(html(createElement(ReportViewer, { markdown: md, citations: {}, delivery: '已交付' }))).not.toContain('length-warning-tag');
  });
});

describe('M4\'s v5 sample (the new layout, rewrite of v4)', () => {
  const note = parseNote(readFileSync('tests/fixtures/d47/报告 v5（样例）.md', 'utf8'));
  const out = html(createElement(ReportViewer, { markdown: note.body, citations: {}, delivery: '已交付', lengthFlags: readLengthFlags(note.data) }));

  it('each card shows its ①②③ with a status, outside the fold', () => {
    expect([...out.matchAll(/data-testid="hypothesis-condition" data-status="([^"]+)"/g)].map((m) => m[1])).toEqual(['成立', '证据不足', '证据不足', '证据不足', '不成立', '证据不足']);
    const last = out.lastIndexOf('data-testid="hypothesis-condition"');
    expect(out.indexOf('data-testid="evidence-fold"')).toBeGreaterThan(out.indexOf('data-testid="hypothesis-condition"'));
    expect(out.indexOf('提议的判断：需要修改（② 证据不足、③ 证据不足）')).toBeGreaterThan(0);
    expect(last).toBeGreaterThan(0);
    // the line keeps the plan's own words, quote marks included, and the system review note
    expect(out).toContain('系统复核：模型判不成立');
  });

  it('the card\'s 改了什么 / 回答 / 理由 / So What stay above the fold; the unsplit Q1 answer is shown once', () => {
    const firstFold = out.indexOf('data-testid="evidence-fold"');
    for (const label of ['改了什么：', '回答：', '理由：', 'So What：']) expect(out.slice(0, firstFold)).toContain(label);
    expect(out).not.toContain('Q1 的回答');
    expect(out).toContain('Q2 的回答'); // the roll-up of Q2-1 / Q2-2 is not a duplicate
    expect(out.match(/钱由多方出，IT 集中管的 AI 预算只占约两成/g)?.length).toBeGreaterThanOrEqual(2); // Summary line + table cell + card: the section was the only thing dropped
  });

  it('the over-long 理由 line carries ⚠ 超过 40 字, and nothing else does', () => {
    expect(out.match(/data-testid="length-warning-tag"/g)).toHaveLength(1);
    expect(out).toContain('⚠ 超过 40 字');
    expect(out.indexOf('length-warning-tag')).toBeGreaterThan(out.indexOf('也没有一份 2025 年以来的招标或采购文件把管理写成资格条款'));
  });

  it('the tree and the folds still work on the new layout', () => {
    expect(out).toContain('data-testid="question-tree"');
    expect(out.match(/data-testid="evidence-fold"/g)).toHaveLength(2);
  });
});

describe('only a passage from a source is set off as a quotation', () => {
  const styled = (out: string) => out.match(/border-l-2 pl-1\.5 italic/g)?.length ?? 0;

  it('quoted words in a sentence stay plain quotes, of any length, even with a footnote later in the sentence', () => {
    const out = render('## Summary\n- IT 管“能不能进”；资料说「这笔钱的预算归属在 IT 一侧」不成立[^3]');
    expect(out).toContain('IT 管“能不能进”；');
    expect(out).toContain('“这笔钱的预算归属在 IT 一侧”不成立');
    expect(styled(out)).toBe(0);
  });

  it('a quote with a footnote or a block link right after it (marks and a （等级） in between allowed) keeps the quote style', () => {
    const out = render('## Summary\n- a “管得太死，员工会绕过去。”[^2]\n- b “某句原文”（B 级，知识库）[[资料甲#^c1]]\n- c “别的词” 后面才有脚注[^4]');
    expect(styled(out)).toBe(2);
  });

  it('the plan\'s condition and the tree\'s questions keep their quote marks, none of them styled', () => {
    expect(conditionLine(firstItem('- ③ 「AI 能力更强但管不住」的产品拿不到采购 → 证据不足'))?.before.some((n) => n.kind === 'quote')).toBe(true);
    const out = render(CARD.replace('员工自己订阅走不到企业采购', '「AI 能力更强但管不住」的产品拿不到采购'));
    expect(out).toContain('“AI 能力更强但管不住”的产品拿不到采购');
    expect(styled(out)).toBe(0);
  });
});

describe('the Summary 问题树 line: the tree is drawn, only the split basis stays as text', () => {
  const line = (out: string) => out.slice(out.indexOf('问题树：'), out.indexOf('data-testid="question-tree"'));

  it('with a split basis: the basis, then the tree; the long 核心问题 → Q1 …／Q2 … sentence is not on the page', () => {
    const md = '## Summary\n- 问题树：按一笔采购的要素拆（谁拍板、按什么标准放行）：核心问题 → Q1 谁拍板？／Q2 按什么放行？\n\n## Q1 谁拍板？\n\n### 假设 H1：x\n- 提议的判断：成立\n\n## Q2 按什么放行？\n\n### 假设 H2：y\n- 提议的判断：成立';
    const out = render(md);
    expect(line(out)).toContain('按一笔采购的要素拆（谁拍板、按什么标准放行）：');
    expect(out).not.toContain('核心问题 → Q1');
    expect(out).not.toContain('／Q2 按什么放行？');
    expect(out).toContain('data-testid="question-tree"');
  });

  it('without a basis (older reports): only the label, then the tree', () => {
    const md = V4;
    const out = render(md);
    expect(line(out).replace(/<[^>]*>?/g, '')).toBe('问题树：');
    expect(out).not.toContain('核心问题 → Q1');
    expect(out).toContain('data-testid="question-tree"');
  });

  it('a report without a question tree keeps its line whole', () => {
    expect(render('## Summary\n- 问题树：核心问题 → Q1 一个问题')).toContain('核心问题 → Q1 一个问题');
  });
});
