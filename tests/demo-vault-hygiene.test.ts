/**
 * Hygiene guard for demo-vault/ (and its snapshots): a strategy team's vault must not carry traces of
 * how the demo was built — pointers to a decision trail, hand-over wording, tool or project names of the
 * build process, key prefixes. Only note BODIES are scanned (frontmatter field names don't count).
 *
 * The trail itself lives outside the vault (not published).
 *
 * Allowlist (each entry says why a term is legitimate there):
 *  - fetched web text (10_资料库 `## 抓取原文` sections and `## 论断` quotes) is somebody else's writing;
 *  - 日志.md rows are tool output and search queries, not prose;
 *  - 普通模式报告*.md are the baseline model's own analysis of the market and may name Claude as a product;
 *  - the method library's "grill" is the name of the questioning method (grill-me);
 *  - a 10_资料库 note's H1 is the fetched page's own title (e.g. an article about Anthropic's models);
 *  - a [[link]] target that resolves to a 10_资料库 note is that page's title, written by the fetcher, not by us.
 *    Its |alias, and links to any other note, are still checked;
 *  - in the m1-* snapshots (D-64, the topic of the explanation document v4) M1–M4 are the issue tree's item ids, not
 *    build milestones.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { answerExplanation, explanationText } from '@/lib/research/explanation-answer';
import { parseMarkdown } from '@/lib/vault/frontmatter';

const REFERENCE_PROJECT = 'OpenMAIC';
const ROOT = path.join(process.cwd(), 'demo-vault');

const PROCESS_TERMS: { term: RegExp; label: string }[] = [
  { term: /决策依据/, label: '决策依据' },
  { term: /待你确认/, label: '待你确认' },
  { term: /内容决策记录/, label: '内容决策记录' },
  { term: /待 ?C3/, label: '待 C3' },
  { term: /总控台/, label: '总控台' },
  { term: /转达/, label: '转达' },
  { term: /M0 占位/, label: 'M0 占位' },
  { term: /grill/i, label: 'grill' },
  { term: new RegExp(REFERENCE_PROJECT, 'i'), label: REFERENCE_PROJECT },
  { term: /PRD/, label: 'PRD' },
  { term: /\bM[0-5]\b/, label: 'M0–M5' },
];
/** Only checked where nobody else is quoted. */
const NAME_TERMS: { term: RegExp; label: string }[] = [
  { term: /Claude/, label: 'Claude' },
  { term: /\bsessions?\b/i, label: 'session' },
];
const KEY_PREFIX = /\bsk-[A-Za-z0-9_-]{16,}/;

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith('.md')) out.push(p);
  }
  return out;
}

const files = walk(ROOT).map((p) => path.relative(ROOT, p).split(path.sep).join('/'));

const isSourceNote = (rel: string) => /(^|\/)10_资料库\//.test(rel);
/** The vault a file belongs to: '' for S0, '.snapshots/<name>/' for a snapshot. */
const vaultOf = (rel: string) => /^\.snapshots\/[^/]+\//.exec(rel)?.[0] ?? '';
const noExt = (p: string) => p.replace(/\.md$/, '');

/** Per vault: the names a link may use to point at a source note (basename and vault-relative path). */
const sourceTargets = new Map<string, Set<string>>();
for (const rel of files.filter(isSourceNote)) {
  const v = vaultOf(rel);
  const set = sourceTargets.get(v) ?? new Set<string>();
  set.add(noExt(rel.slice(v.length)));
  set.add(noExt(rel.split('/').pop()!));
  sourceTargets.set(v, set);
}

/** Body of a note, minus the parts that are not our own prose. */
function ownProse(rel: string, raw: string, sources: ReadonlySet<string> = new Set()): string {
  let body = parseMarkdown(raw).body;
  if (isSourceNote(rel)) {
    body = body.split(/^## (?:论断|抓取原文)\s*$/m)[0].replace(/^# .*$/m, '');
  }
  // a report's footnote quotes its source word for word (WS-A 问题树 v3: "Apple MacBook Air，…，M5芯片")
  body = body.replace(/^(\[\^\d+\]: )“[^”\n]*”/gm, '$1');
  // [[target#^c3|alias]]: drop the target when it is a source note, keep the alias (ours) either way
  return body.replace(/\[\[([^\]|#]+)(#[^\]|]*)?(?:\|([^\]]*))?\]\]/g, (m, target: string, _anchor, alias?: string) =>
    sources.has(target.trim()) ? (alias ?? '') : m,
  );
}

describe('demo-vault hygiene', () => {
  it('scans something', () => expect(files.length).toBeGreaterThan(50));

  it.each(files)('%s has no build-process traces', (rel) => {
    const raw = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    expect(KEY_PREFIX.test(raw), `${rel}: looks like an API key`).toBe(false);
    const prose = ownProse(rel, raw, sourceTargets.get(vaultOf(rel)));
    const isLog = rel.endsWith('/日志.md');
    const isBaseline = /\/普通模式报告 v\d+\.md$/.test(rel);
    const isMethod = rel.includes('00_团队知识/方法库/');
    const isM1Topic = rel.startsWith('.snapshots/m1-');
    const hits: string[] = [];
    if (!isLog) {
      for (const { term, label } of PROCESS_TERMS) {
        if (label === 'grill' && isMethod) continue;
        if (label === 'M0–M5' && isM1Topic) continue;
        if (isBaseline && label !== REFERENCE_PROJECT && label !== 'PRD') continue;
        if (term.test(prose)) hits.push(label);
      }
      if (!isBaseline) for (const { term, label } of NAME_TERMS) if (term.test(prose)) hits.push(label);
    }
    expect(hits, `${rel}: remove or reword ${hits.join('、')}`).toEqual([]);
  });

  it('the allowlist is narrow: outside 10_资料库 a title or a non-source link still counts', () => {
    const sources = new Set(['3 Ways the Claude Mythos Delay Hurts Anthropic 2026']);
    const src = '---\ntype: source\n---\n# 3 Ways the Claude Mythos Delay Hurts Anthropic 2026\n\n## 论断\n';
    expect(ownProse('10_资料库/3 Ways the Claude Mythos Delay Hurts Anthropic 2026.md', src, sources)).not.toMatch(/Claude/);
    const cite = '---\ntype: report\n---\n[^1]: “x”[[3 Ways the Claude Mythos Delay Hurts Anthropic 2026#^c6]]\n';
    expect(ownProse('20_项目/p/报告 v3.md', cite, sources)).not.toMatch(/Claude/);
    // a footnote's quoted original is the source's text; what follows the quote is ours
    expect(ownProse('20_项目/p/报告 v3.md', '---\ntype: report\n---\n[^2]: “MacBook Air，M5芯片”（B 级）\n', sources)).not.toMatch(/M5/);
    expect(ownProse('20_项目/p/报告 v3.md', '---\ntype: report\n---\n[^2]: “x”（M5 级）\n', sources)).toMatch(/M5/);
    // our own H1 outside 10_资料库
    expect(ownProse('20_项目/p/笔记.md', '---\ntype: report\n---\n# 交给 Claude 的笔记\n', sources)).toMatch(/Claude/);
    // a link to a note that is not a source
    expect(ownProse('20_项目/p/笔记.md', '---\ntype: report\n---\n见 [[Claude 工作记录]]\n', sources)).toMatch(/Claude/);
    // an alias we wrote on a source link
    expect(ownProse('20_项目/p/笔记.md', '---\ntype: report\n---\n[[3 Ways the Claude Mythos Delay Hurts Anthropic 2026|Claude 那篇]]\n', sources)).toMatch(/Claude/);
  });
});

describe('D10 browser code and explanation output', () => {
  it('product source contains no reference project name, including client sanitizers', () => {
    const hits: string[] = [];
    for (const dir of ['app', 'components', 'lib']) {
      for (const rel of fs.readdirSync(dir, { recursive: true }) as string[]) {
        if (!/\.tsx?$/.test(rel)) continue;
        const p = path.join(dir, rel);
        if (fs.readFileSync(p, 'utf8').toLowerCase().includes(REFERENCE_PROJECT.toLowerCase())) hits.push(p);
      }
    }
    expect(hits).toEqual([]);
  });
  it('recorded rule answers and cleaned display text do not introduce the reference project name', () => {
    const text = answerExplanation({ state: 'ready', identity: 'v2', reportName: '报告 v2', interviewProvenance: 'unknown', targets: [{ id: 'K3', token: 'K3', label: '跨设备', kind: 'key', verdict: '访谈支持', verdictLabel: '访谈支持', members: [], recordedGaps: ['缺留存数据'], recordedNextSteps: [] }] }, 'K3', 'verdict_limit');
    expect(text).not.toMatch(new RegExp(REFERENCE_PROJECT, 'i'));
    expect(explanationText('[[资料甲#^c1|资料甲]]')).not.toMatch(new RegExp(REFERENCE_PROJECT, 'i'));
  });
});
