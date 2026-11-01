/**
 * Rule judges for the workplan chat eval (D-56 3c). Pure functions over the assistant's chat text and the first
 * turn's tool trace — no model, no IO — so they are unit-tested (tests/evals/workplan-judges.test.ts) and give the
 * same verdict every time. The runner that uses them is a separate spec (m1_3d).
 */
import { lengthOf } from '@/lib/research/length-check';
import type { Check } from './judges';

const hit = (hits: string[]): string => (hits.length ? [...new Set(hits)].slice(0, 5).join('、') : '无');

const rule = (name: string, pass: boolean, detail: string): Check => ({ name, kind: 'rule', pass, detail });

// ── ① the chat names notes by title, never by file, path or tool ─────────────────────────────────

const INTERNAL: RegExp[] = [
  /\.md/g,
  /\[\[/g,
  /#\^/g,
  /\b(?:00|10|20|90)_[^\s/]+\//g,
  /\bvault\w*/gi,
  /\b(?:ask_user|write_draft|submit_for_review|frame_topic|compose_workplan|web_search|web_fetch|ingest_source|check_citations)\b/g,
];

export function internalNames(text: string): Check {
  const hits: string[] = [];
  for (const re of INTERNAL) for (const m of text.matchAll(re)) hits.push(m[0]);
  return rule('对话里没有内部文件名、路径、工具名', hits.length === 0, hit(hits));
}

// ── ② chat text is plain sentences, not markdown ─────────────────────────────────────────────────

export function noMarkdown(text: string): Check {
  const lines = text.split('\n');
  const kinds: [string, boolean][] = [
    ['标题行', lines.some((l) => /^#{1,6} /.test(l))],
    ['列表行', lines.some((l) => /^\s*(?:[-*•]\s|\d+[.、)]\s)/.test(l))],
    ['加粗星号', text.includes('**')],
    ['代码块', text.includes('```')],
    ['表格分隔行', lines.some((l) => l.includes('|') && /^\s*\|?[\s:|-]*-{3,}[\s:|-]*\|?\s*$/.test(l))],
  ];
  const found = kinds.filter(([, on]) => on).map(([kind]) => kind);
  return rule('对话里没有 markdown', found.length === 0, found.length ? found.join('、') : '无');
}

// ── ③④⑤⑥⑦ one-line style checks ─────────────────────────────────────────────────────────────────

export function shortEnough(text: string, limit = 80): Check {
  const n = lengthOf(text);
  return rule('正文不超过 80 字', n <= limit, `${n} 字`);
}

export function atMostOneQuestion(text: string): Check {
  const n = text.split('').filter((c) => c === '？' || c === '?').length;
  return rule('正文里最多一个问句', n <= 1, `${n} 个`);
}

const FLATTERY = ['好问题', '很有道理', '你说得对', '说得好', '非常好', '太棒了', '这是个好问题', '你提的很好'];

export function noFlatteryOpening(text: string): Check {
  const t = text.trim();
  const found = FLATTERY.find((f) => t.startsWith(f));
  return rule('不以夸奖开头', !found, found ?? '无');
}

const CAPABILITY = ['我可以帮你', '我可以帮您', '我能帮你', '我的能力'];

export function noCapabilityList(text: string): Check {
  const found = CAPABILITY.find((c) => text.includes(c));
  return rule('不列能力清单', !found, found ?? '无');
}

const FALSE_DONE = ['已提交', '已经提交', '已批准', '已经批准', '已为你提交'];

export function noFalseDone(text: string): Check {
  const found = FALSE_DONE.find((f) => text.includes(f));
  return rule('不替用户宣布提交或批准', !found, found ?? '无');
}

// ── ⑧ the first turn looked something up before it asked ────────────────────────────────────────

// frame_topic builds the material list, so the code does the lookup there.
const LOOKUP = new Set(['vault_read', 'vault_search', 'vault_list', 'frame_topic']);
const ASKS = new Set(['ask_user', 'write_draft', 'compose_workplan']);

export function looksUpBeforeAsking(trace: { tool: string }[]): Check {
  const firstAsk = trace.findIndex((t) => ASKS.has(t.tool));
  const pass = firstAsk < 0 ? trace.some((t) => LOOKUP.has(t.tool)) : trace.slice(0, firstAsk).some((t) => LOOKUP.has(t.tool));
  const names = trace.slice(0, 5).map((t) => t.tool).join(' → ');
  return rule('提问之前先查了资料', pass, names || '无');
}

// ── ⑨⑩ the answer names the directive, or names the doubt ───────────────────────────────────────

export function referencesTitle(text: string, titleFragment: string | string[]): Check {
  const fragments = Array.isArray(titleFragment) ? titleFragment : [titleFragment];
  const found = fragments.find((f) => text.includes(f));
  const pass = found !== undefined && text.includes('《');
  return rule('提到了《…》这份资料的标题', pass, found ?? 'missing');
}

const DOUBT = [
  '没把握', '没有证据', '没有资料', '未必', '不一定', '这个前提', '先别假设', '只是假设', '是假设', '不一样', '对不上', '有出入', '不同',
  '已经定了', '已确认', '撞车', '冲突', '出入', '没有数据', '凭感觉', '没人回答', '空档',
];

export function doubtMarker(text: string): Check {
  const found = DOUBT.find((d) => text.includes(d));
  return rule('点出了一个疑点', Boolean(found), found ?? '无');
}

// ── a sentence the reader gets is whole: titles closed, no made-up codes, ends like a sentence ─────────────────

/** 《 and 》 come in pairs. */
export function balancedTitles(text: string): Check {
  const open = (text.match(/《/g) ?? []).length;
  const close = (text.match(/》/g) ?? []).length;
  return rule('书名号成对', open === close, `《${open} 》${close}`);
}

/** A letter-and-digit code the reader cannot look up (A1, B2); Q, H, K, W and C are names they meet or that are replaced. */
export function noCodes(text: string): Check {
  const hits = text.match(/\b(?![HQKWCG])[A-Z]\d+\b/g) ?? [];
  return rule('不出现 A1 这类代号', hits.length === 0, hit(hits));
}

/** A piece of assistant text does not stop in the middle of a sentence. */
export function endsWhole(text: string): Check {
  const t = text.trim();
  return rule('句子完整（不停在半句上）', t === '' || /[。！？!?…」”）)》\]]$/.test(t), t.slice(-8));
}

// ── the whole chat-text set, and a run's summary ─────────────────────────────────────────────────

/** The per-piece style checks. Length is scored per run, not here (see workplan-lib's runChecks). */
export function allChatChecks(text: string, _opts?: { limit?: number }): Check[] {
  return [internalNames(text), noMarkdown(text), atMostOneQuestion(text), noFlatteryOpening(text), noCapabilityList(text), noFalseDone(text)];
}

export function summarizeRun(checks: Check[]): { pass: boolean; failed: string[] } {
  const failed = checks.filter((c) => !c.pass).map((c) => c.name);
  return { pass: failed.length === 0, failed };
}
