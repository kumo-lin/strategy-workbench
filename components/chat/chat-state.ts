/**
 * 聊天时间线的纯函数：把 AI SDK 的 message.parts 变成卡片需要的展示数据。
 * 没有 React、没有副作用、没有 Node API —— 全部可以直接单测。
 */
import type { AskUserOutput } from '@/lib/harness/tools/ask-user';

// ── parts ────────────────────────────────────────────────────────────────────

/** 结构化的最小形状：AI SDK 的 tool part 满足它。 */
export interface PartLike {
  type: string;
  toolName?: string;
  state?: string;
}

const TOOL_TYPE_PREFIX = 'tool-';

/** 'tool-ask_user' → 'ask_user'；'dynamic-tool' → part.toolName；其他 → null。 */
export function toolNameOf(part: { type: string; toolName?: string }): string | null {
  if (part.type === 'dynamic-tool') {
    const dynamicName = part.toolName;
    return typeof dynamicName === 'string' && dynamicName.length > 0 ? dynamicName : null;
  }
  if (!part.type.startsWith(TOOL_TYPE_PREFIX)) return null;
  const name = part.type.slice(TOOL_TYPE_PREFIX.length);
  return name.length > 0 ? name : null;
}

export type ToolStatus = 'running' | 'done' | 'error';

/**
 * input-streaming / input-available / approval-* → running；
 * output-available → done；output-error / output-denied → error。
 */
export function toolStatusOf(part: { state?: string }): ToolStatus {
  if (part.state === 'output-available') return 'done';
  if (part.state === 'output-error' || part.state === 'output-denied') return 'error';
  return 'running';
}

// ── labels & summaries ───────────────────────────────────────────────────────

const TOOL_LABELS: Record<string, string> = {
  ask_user: '向你提问',
  vault_list: '浏览资料',
  vault_read: '读取笔记',
  vault_search: '搜索资料',
  write_draft: '写草稿',
  web_search: '联网搜索',
  web_fetch: '抓取网页',
  ingest_source: '资料入库',
  check_citations: '检查引用',
  submit_for_review: '准备送审',
  frame_topic: '记下题目',
  compose_workplan: '拆题',
  propose_decision: '提议决定',
  propose_knowledge: '提议沉淀',
  // D-64
  read_task_context: '读取任务背景',
  set_selection: '调整资料选择',
  draft_contract: '起草决策契约',
  draft_issue_tree: '起草议题树',
};

/** 工具的中文名；未知工具返回原名。 */
export function toolLabel(name: string): string {
  return TOOL_LABELS[name] ?? name;
}

/** 每个工具最能说明问题的那一个入参。 */
const SUMMARY_KEY: Record<string, string> = {
  ask_user: 'question',
  vault_read: 'path',
  vault_search: 'query',
  vault_list: 'dir',
  write_draft: 'note_type',
  web_search: 'query',
  web_fetch: 'url',
  submit_for_review: 'gate',
};

const SUMMARY_MAX_LENGTH = 80;

function truncateSummary(text: string): string {
  return text.length > SUMMARY_MAX_LENGTH ? `${text.slice(0, SUMMARY_MAX_LENGTH)}…` : text;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * 卡片折叠状态下显示的一行摘要。找不到可显示的字符串时返回 ''，永远不抛错。
 */
export function toolSummary(name: string, input: unknown): string {
  if (!isRecord(input)) return '';

  const key = SUMMARY_KEY[name];
  if (key) {
    const value = input[key];
    if (typeof value !== 'string') return '';
    if (name === 'vault_list' && value.length === 0) return '/';
    return truncateSummary(value);
  }

  for (const value of Object.values(input)) {
    if (typeof value === 'string') return truncateSummary(value);
  }
  return '';
}

/** The reason a tool card gives for the call (`input.why`, written by the run), if any. */
export function toolWhy(input: unknown): string {
  return isRecord(input) && typeof input.why === 'string' ? input.why : '';
}

/** Whether a tool call read or looked for a decision the team has confirmed (found along relates_to). */
export function isDecisionRead(name: string, input: unknown): boolean {
  if (!isRecord(input) || name !== 'vault_read') return false;
  return (typeof input.path === 'string' && input.path.includes('/决策/')) || toolWhy(input).includes('已确认的决定');
}

/** What kind of thing a card is about, for the label next to it: 已确认的决定 / 高层指示 / 团队知识. */
export function toolTags(name: string, input: unknown): string[] {
  if (!isRecord(input)) return [];
  if (isDecisionRead(name, input)) return ['已确认的决定'];
  const where = [input.path, input.dir].filter((v): v is string => typeof v === 'string').join(' ');
  if (name === 'vault_read' || name === 'vault_search' || name === 'vault_list') {
    if (where.includes('/会议')) return ['高层指示'];
    if (where.includes('00_团队知识')) return ['团队知识'];
  }
  return [];
}

/** The card header's sentence: the reason when the run gave one, else the main argument (the label is shown next to it). */
export function toolSentence(name: string, input: unknown): string {
  return toolWhy(input) || toolSummary(name, input);
}

// ── json ─────────────────────────────────────────────────────────────────────

function stringifyFallback(value: unknown): string {
  try {
    return String(value);
  } catch {
    return '[无法显示]';
  }
}

/**
 * JSON.stringify(v, null, 2)；字符串原样返回；undefined → ''；
 * 序列化失败（循环引用、toString 抛错等）时退回到 String(v)。超过 max 个字符截断再追加 '…'。
 */
export function formatJson(v: unknown, max = 4000): string {
  let text: string;

  if (typeof v === 'string') {
    text = v;
  } else if (v === undefined) {
    return '';
  } else {
    let serialized: string | undefined;
    try {
      serialized = JSON.stringify(v, null, 2);
    } catch {
      serialized = undefined;
    }
    text = typeof serialized === 'string' ? serialized : stringifyFallback(v);
  }

  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max))}…`;
}

// ── ask_user ─────────────────────────────────────────────────────────────────

export interface AskUserInputView {
  question: string;
  options: { id: string; label: string }[];
  multiSelect: boolean;
}

/**
 * 解析 ask_user 的 input（流式输出时可能不完整）。没有 question 返回 null；
 * options 缺省为 []，丢掉没有 id 或 label 的项；multiSelect 缺省 false。
 */
export function askUserInputOf(input: unknown): AskUserInputView | null {
  if (!isRecord(input)) return null;

  const question = typeof input.question === 'string' ? input.question.trim() : '';
  if (question.length === 0) return null;

  const options: { id: string; label: string }[] = [];
  if (Array.isArray(input.options)) {
    for (const raw of input.options) {
      if (!isRecord(raw)) continue;
      const id = typeof raw.id === 'string' ? raw.id.trim() : '';
      const label = typeof raw.label === 'string' ? raw.label.trim() : '';
      if (id.length === 0 || label.length === 0) continue;
      options.push({ id, label });
    }
  }

  return { question, options, multiSelect: input.multiSelect === true };
}

/** 单选：选新的替换旧的，再点已选中的取消；多选：切换，保持点击顺序。不修改入参。 */
export function toggleSelection(selected: string[], id: string, multi: boolean): string[] {
  if (multi) {
    return selected.includes(id) ? selected.filter((item) => item !== id) : [...selected, id];
  }
  return selected.length === 1 && selected[0] === id ? [] : [id];
}

/**
 * 选项和文字都为空（文字 trim 后）返回 null；
 * 否则 { selected } 或 { selected, text }（text 已 trim，有内容才带上）。
 */
export function buildAskUserAnswer(input: { selected: string[]; text: string }): AskUserOutput | null {
  const text = input.text.trim();
  const selected = [...input.selected];
  if (selected.length === 0 && text.length === 0) return null;
  return text.length > 0 ? { selected, text } : { selected };
}

/**
 * 回答显示成一句话：选中的 label 用「、」连接，再接「；」和文字；
 * 找不到 label 的 id 原样显示；只有文字就只显示文字。
 */
export function describeAnswer(
  options: { id: string; label: string }[],
  output: AskUserOutput,
): string {
  const selected = Array.isArray(output.selected) ? output.selected : [];
  const labels = selected.map(
    (id) => options.find((option) => option.id === id)?.label ?? id,
  );
  const text = typeof output.text === 'string' ? output.text.trim() : '';

  const parts: string[] = [];
  if (labels.length > 0) parts.push(labels.join('、'));
  if (text.length > 0) parts.push(text);
  return parts.join('；');
}

// ── 问题写在正文里、没有走 ask_user ────────────────────────────────────────

const QUESTION_ENDING = /[?？]\s*[」』）)"”'’]*\s*$/;
const QUESTION_ANNOUNCED = /第[一二三四五六七八九十\d]+个?问|下一个?问|我的推荐是/;

/** 发给模型的提示：把正文里的问题改成提问卡片。 */
export const ASK_USER_NUDGE =
  '你上一条回复把问题写在了正文里，没有用提问卡片（ask_user）。只要是在等我回答的问题，都要用 ask_user 发出来，并给出选项；不要在正文里提问之后就停下。请把刚才那个问题用 ask_user 重发一遍。';

interface MessageLike {
  id: string;
  role: string;
  parts: ReadonlyArray<{ type: string; text?: string; toolName?: string; state?: string }>;
}

/**
 * 最后一条助手消息的最后一个有内容的 part 是一段正文，而且这段正文是在向用户提问
 * （以问号结尾，或者写着"第 N 问""我的推荐是"），说明模型把问题写进了正文就结束了这一轮，
 * 用户看不到可点的选项。返回那条消息的 id；不是这种情况返回 null。
 * 最后一个 part 是工具（包括正在等回答的 ask_user）时不算。
 */
export function unaskedQuestionMessageId(messages: ReadonlyArray<MessageLike>): string | null {
  const last = messages[messages.length - 1];
  if (!last || last.role !== 'assistant') return null;
  for (let i = last.parts.length - 1; i >= 0; i--) {
    const part = last.parts[i];
    if (part.type === 'step-start' || part.type === 'reasoning') continue;
    if (part.type !== 'text') return null;
    const text = (part.text ?? '').trim();
    if (!text) continue;
    return QUESTION_ENDING.test(text) || QUESTION_ANNOUNCED.test(text) ? last.id : null;
  }
  return null;
}

// ── 选项写进了问题正文（options 为空）────────────────────────────────────────

/** 发给模型的错误信息：这张卡被退回，要求把选项放进 options 重发。 */
export const OPTIONS_IN_BODY_ERROR =
  '这张提问卡被退回：你把选项（a) b) c) 之类的列表）写在了 question 正文里，options 参数是空的，界面上没有可点的按钮。请重发这个问题：选项放进 options（每项 { id, label }），question 里只写问题、你的推荐和理由，不要再写选项列表。';

const LIST_MARKER = /(?:^|\n)[ \t]*(?:[-*][ \t]+)?[（(]?([A-Za-z]\d?)(?:[)）]|[.．、][ \t])/g;

/**
 * ask_user 的 options 为空，而问题正文里有两条以上以 a) / b） / i1） 开头的行：
 * 模型把选项写进了正文，卡片上只有输入框、没有按钮。
 */
export function optionsWrittenInBody(input: unknown): boolean {
  const view = askUserInputOf(input);
  if (!view || view.options.length > 0) return false;
  const markers = new Set<string>();
  for (const m of view.question.matchAll(LIST_MARKER)) markers.add(m[1].toLowerCase());
  return markers.size >= 2;
}
