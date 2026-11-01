import { INTERVIEW_RULE, UNTOUCHED_AFTER } from './interview-advice';
import type { ExplanationContext, ExplanationIntent, ExplanationTarget } from './explanation-types';

export const EXPLANATION_QUESTION_LIMIT = 300;
export const EXPLANATION_QUESTIONS = ['能改成成立吗？', '还缺什么证据？', '下一步怎样验证？', '访谈改变了什么？'] as const;
export type ExplanationQuestion = { kind: 'supported'; intent: ExplanationIntent } | { kind: 'clarify'; message: string };

/** A deliberately finite vocabulary. Unknown text is not sent to an agent or treated as a command. */
export function classifyExplanationQuestion(question: string, target?: ExplanationTarget, context?: ExplanationContext): ExplanationQuestion {
  const clarify = (message: string): ExplanationQuestion => ({ kind: 'clarify', message });
  if (!question.trim() || question.length > EXPLANATION_QUESTION_LIMIT) return clarify(`请输入 1 到 ${EXPLANATION_QUESTION_LIMIT} 字的问题。`);
  const q = question.normalize('NFKC').trim();
  // This one asks about the whole version, not the selected judgment, so it is recognised before a target is required.
  if (GLOBAL_CHANGE_QUESTIONS.has(q.replace(/[\s，。！？?:：、“”‘’"'（）()]/g, ''))) return { kind: 'supported', intent: 'what_changed' };
  // real run: the analyst asked about K3, which this report does not have — say so, and what it does have (whether or
  // not a judgment is picked: a report with one judgment picks it by itself)
  const named = [...q.matchAll(/(?<![A-Za-z\d])[KH]\d+(?:-\d+)?(?![\dA-Za-z-])/gi)].map((m) => m[0].toUpperCase());
  const missing = named.filter((n) => !context?.targets.some((t) => t.token === n));
  if (missing.length && context?.targets.length) return clarify(`这份报告里没有 ${missing.join('、')}。可以问的判断有：${context.targets.map((t) => explanationText(t.label)).join('；')}。`);
  if (!target) return clarify('请先明确选择要解释的判断。');
  const mentions = [...q.matchAll(/[KH]\d+(?:-\d+)?(?![\dA-Za-z-])/gi)].map((m) => m[0].toUpperCase());
  if (mentions.length > 1 || mentions.some((m) => m !== target.token)) return clarify('问题对象与所选判断不一致，或包含多个对象；请明确选择一个判断。');
  const text = q.replace(/^[KH]\d+(?:-\d+)?/i, '').replace(/[\s，。！？?:：、“”‘’"'（）()]/g, '');
  if (/^(?:能(?:直接)?(?:改成|算作?|判为|判成|升级为)?成立吗|能否(?:直接)?(?:改成|算作?|判为)?成立|可以(?:直接)?(?:改成|算作?|判为)?成立吗|为什么不能(?:改成|算作?|判为)?成立)$/.test(text)) return { kind: 'supported', intent: 'verdict_limit' };
  if (/^(?:还缺什么证据|缺少哪些证据|还缺哪些证据|证据缺口是什么)$/.test(text)) return { kind: 'supported', intent: 'evidence_gap' };
  if (/^(?:下一步怎样验证|下一步怎么验证|怎么验证|如何验证|已有的验证建议是什么)$/.test(text)) return { kind: 'supported', intent: 'next_validation' };
  return clarify('这里只解释成立限制、已有证据缺口和已有验证建议。请使用下方提示问题；不会执行修改或调查。');
}

/** The whole-version questions 复核 #1 adds; they need no single selected judgment. */
const GLOBAL_CHANGE_QUESTIONS = new Set([
  '这些访谈能改哪些判断', '这些访谈能改哪些结论', '这些访谈能改变哪些判断', '这些访谈改变了什么',
  '访谈能改哪些判断', '访谈改变了什么', '访谈前后有什么变化', '哪些判断变了', '哪些判断有变化',
]);

/** Explain the saved result, never derive or change a verdict. Recorded gaps may have been carried from v1. */
export function answerExplanation(context: ExplanationContext, targetId: string, intent: ExplanationIntent): string {
  if (context.state !== 'ready') return '该版本的解释数据不可用，请回报告核对；本入口不修改报告。';
  if (intent === 'what_changed') return answerChanges(context);
  const t = context.targets.find((x) => x.id === targetId);
  if (!t) return '请明确选择该报告中的一个判断。';
  const gaps = t.recordedGaps.length ? t.recordedGaps.join('；') : '该版本未记录对应缺口，不能据此认定证据完整';
  const next = t.recordedNextSteps.length ? t.recordedNextSteps.join('；') : '该版本未记录对应验证建议，请回报告核对或由人安排后续验证';
  const members = t.kind === 'key' && t.members.length ? `（其中 ${t.members.map((m) => `${m.label} ${m.verdictLabel}`).join('，')}）` : '';
  const said = t.interviewSaid?.length ? `访谈里：${t.interviewSaid.join('；')}。` : '';
  // 复核 P3: the conclusion first, as the analyst asked it (v6 2.10: 「不能。……按事先约定，访谈只能升到“访谈支持”」)
  if (intent === 'verdict_limit') {
    const out = t.verdict === '成立'
      ? [`${t.label} 在${context.reportName} 里已经记录为“成立”${members}，不需要再改；这里也不会更改或降级它。`]
      : [`不能。${t.label} 在${context.reportName} 里已记录为“${t.verdictLabel}”${members}，不能仅凭本次访谈或这次提问改为“成立”。`, ...(said ? [said] : []), `事先约定：${INTERVIEW_RULE}`, t.verdict === '证据不足' || t.verdict === '访谈支持' ? `要改成“成立”，还缺：${gaps}（原报告的记录，可能沿用历史版本，未重新核验）。` : `原报告记录的证据缺口（可能沿用历史记录，未重新核验）：${gaps}。`];
    out.push('这里只解释已保存的记录，不修改报告或判断，也不新增证据。');
    return explanationText(out.join('\n\n'));
  }
  const out = [`${context.reportName} · ${t.label}：已记录为“${t.verdictLabel}”${members}。`];
  switch (intent) {
    case 'evidence_gap': out.push(`原报告记录的证据缺口（可能沿用历史记录，未重新核验）：${gaps}。`); break;
    case 'next_validation': out.push(`原报告已有的验证建议（本入口未执行）：${next}。`); break;
    default: return '这里只解释成立限制、已有证据缺口和已有验证建议。';
  }
  out.push('解释只读，不修改报告或判断，也不新增证据。');
  return explanationText(out.join('\n\n'));
}

/** 复核 #1: what the saved re-analysis recorded. It lists the rows, quotes the shared rule, and upgrades nothing. */
function answerChanges(context: ExplanationContext): string {
  const changes = context.changes ?? [];
  if (!changes.length) return explanationText(`${context.reportName}：这一版没有记录访谈带来的判断变化；本入口只解释已保存的记录，不推测。`);
  const touched = changes.filter((c) => c.after !== UNTOUCHED_AFTER);
  const changed = touched.filter((c) => c.after !== c.before);
  const kept = touched.filter((c) => c.after === c.before);
  const same = changes.filter((c) => c.after === UNTOUCHED_AFTER);
  const out: string[] = [];
  // a judgment the interviews touched without moving it reads 仍为 (it said 从“部分支持”变为“部分支持”)
  const parts = [...changed.map((c) => `${c.label} 从“${c.before}”变为“${c.after}”`), ...kept.map((c) => `${c.label} 仍为“${c.after}”（访谈涉及，判断不变）`)];
  out.push(changed.length || kept.length ? `${context.reportName} · 追加访谈后：${parts.join('；')}。` : `${context.reportName} · 追加访谈后没有判断改变。`);
  if (same.length) out.push(`没有变的：${same.map((c) => `${c.label} 仍为“${c.before}”`).join('、')}（访谈没有涉及）。`);
  out.push(`事先约定：${INTERVIEW_RULE}`);
  out.push('解释只读，不修改报告或判断，也不新增证据；以上是报告已保存的记录。');
  return explanationText(out.join('\n\n'));
}

/** Plain display text only; neither stored evidence nor an instruction to an agent. */
export function explanationText(text: string): string {
  return text.replace(/\[\[([^\]]+)\]\]/g, (_m, inner: string) => (inner.split('|')[1] ?? inner.split('|')[0].replace(/#.*$/, '').split('/').pop() ?? '资料').replace(/\.md$/i, ''))
    .replace(/(?:[A-Za-z]:[\\/]|(?:00_团队知识|10_资料库|20_项目|90_配置)[\\/])[^\s，。；、）)\]]*/g, '资料')
    .replace(/项目\.md/gi, '项目资料').replace(/\[\[|\]\]|#\^[\w-]*/g, '')
    .replace(/\[\^\d+[!~]*\]|\[E\d+(?:[,，、]\s*E?\d+)*\]/g, '')
    .replace(/<[^>]*>/g, '').trim();
}
