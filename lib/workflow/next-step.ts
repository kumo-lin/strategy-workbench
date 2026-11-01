/** The sentence of the "next step" bar (UI/UX 方案 #15, #16): what is next, whose turn it is, and the one button, if any. Pure. */
import type { FlowFacts, FlowState } from './steps';

export interface NextStepInput {
  facts: FlowFacts;
  state: FlowState;
  actor: { name: string };
  unhandled: number;
  /** `/workspace/<项目>/<Workspace>`, URL-encoded. */
  base: string;
  /** The investigation the research steps are about (URL-encoded folder name). */
  investigation: string | null;
}

export type NextStepAction =
  | { kind: 'event'; event: 'cocreate' | 'interpret'; label: string; page: 'workplan' }
  | { kind: 'link'; label: string; href: string; page: 'review' | 'research' };

export interface NextStep {
  step: number;
  /** mine = it is your turn; waiting = someone else (or the AI) is up; done = nothing left. */
  turn: 'mine' | 'waiting' | 'done';
  text: string;
  action?: NextStepAction;
  /** A second, muted line: the G1 opinion, which never blocks the main step. */
  aside?: { text: string; action?: NextStepAction };
}

export function nextStepFor(i: NextStepInput): NextStep {
  const { facts: f, state: s, actor, base } = i;
  const mine = s.who === actor.name;
  const research = `${base}/research${i.investigation ? `/${i.investigation}` : ''}`;
  const n = s.current;
  const turn = (text: string, action?: NextStepAction): NextStep => ({ step: n, turn: mine ? 'mine' : 'waiting', text, action });
  const main = ((): NextStep => {
    switch (n) {
      case 1:
        if (mine && f.workplanWritten)
          return turn(`下一步：第 1 步 · 研究计划写好了：可以继续改，也可以请 ${f.reviewer} 提意见（不用等）；满意就往下做调查计划`, { kind: 'link', label: '研究计划定了，往下做调查计划', href: research, page: 'research' });
        return mine
          ? turn('下一步：第 1 步 · 和 AI 一起写研究计划：回答它的 3 个问题', { kind: 'event', event: 'cocreate', label: '开始共创', page: 'workplan' })
          : turn(`等待中：第 1 步 · ${f.owner} 正在和 AI 写研究计划`);
      case 2:
        if (f.research === 'approved')
          return mine
            ? turn('下一步：第 2 步 · 调查计划已批准，开始调查', { kind: 'link', label: '去执行', href: research, page: 'research' })
            : turn(`等待中：第 2 步 · ${f.owner} 的调查计划已批准，等 ${f.owner} 开始调查`);
        return mine
          ? turn('下一步：第 2 步 · 和 AI 定调查计划：每个关键问题 2 到 3 个竞争假设，定了就开始调查', { kind: 'link', label: '去调查', href: research, page: 'research' })
          : turn(`等待中：第 2 步 · ${f.owner} 在定调查计划`);
      case 3:
        if (s.who === 'AI') return turn('等待中：第 3 步 · AI 正在按计划调查，跑完会生成报告；可以走开，回来会接上', { kind: 'link', label: '看进度', href: research, page: 'research' });
        return mine
          ? turn(`轮到你：第 3 步 · 读一遍报告，满意就提交给 ${f.reviewer} 确认`, { kind: 'link', label: '去读报告', href: research, page: 'research' })
          : turn(`等待中：第 3 步 · 报告已交付，等 ${f.owner} 读完提交`);
      case 4:
        return mine
          ? turn('轮到你：第 4 步 · 报告里有公开资料证明不了的地方：看访谈建议，访谈做完回来追加分析', { kind: 'link', label: '看访谈建议', href: research, page: 'research' })
          : turn(`等待中：第 4 步 · ${f.owner} 在做访谈`);
      case 5:
        return mine
          ? turn(`轮到你：第 5 步 · 访谈已经追加分析，读报告新版本，满意就提交给 ${f.reviewer} 确认`, { kind: 'link', label: '去提交报告', href: research, page: 'research' })
          : turn(`等待中：第 5 步 · ${f.owner} 在看追加分析后的报告`);
      case 6:
        if (actor.name === f.reviewer) return turn(`轮到你：第 6 步 · ${f.owner} 提交了报告，等你确认决定、理由和适用边界`, { kind: 'link', label: '去确认', href: research, page: 'research' });
        return { step: n, turn: 'waiting', text: `已提交：第 6 步 · 报告在等 ${f.reviewer} 确认` };
      default:
        return f.decisionConfirmed
          ? { step: 7, turn: 'done', text: `第 7 步 · 决定已确认，存入项目文件${f.next ? `：${f.next.workspace}（${f.next.owner}）的下一次调查会检索到它` : ''}` }
          : { step: 7, turn: 'done', text: `第 7 步 · 报告已确认，存入项目文件${f.next ? `：${f.next.workspace}（${f.next.owner}）打开“文件管理”就能看到` : ''}` };
    }
  })();
  const aside = n === 7 ? undefined : asideFor(i);
  return aside ? { ...main, aside } : main;
}

function asideFor(i: NextStepInput): NextStep['aside'] {
  const { facts: f, actor, base } = i;
  const n = i.state.current;
  if (actor.name === f.owner) {
    if (f.g1 === 'pending') return { text: `已发给 ${f.reviewer} 征求意见，等回复；不挡你，可以先往下做。` };
    if ((f.g1 === 'approved' || f.g1 === 'rejected') && i.unhandled > 0)
      return { text: `${f.reviewer} 回复了 ${i.unhandled} 条意见，还没处理。`, action: { kind: 'event', event: 'interpret', label: '和 AI 一起解读', page: 'workplan' } };
    if (f.g1 === 'approved' && i.unhandled === 0 && n <= 2) return { text: `${f.reviewer} 看过了，没有要改的。` };
  }
  if (actor.name === f.reviewer && actor.name !== f.owner && f.g1 === 'pending')
    return { text: `${f.owner} 的研究计划来征求你的意见（给意见就行，不挡他往下做）。`, action: { kind: 'link', label: '去看', href: `${base}/review`, page: 'review' } };
  return undefined;
}
