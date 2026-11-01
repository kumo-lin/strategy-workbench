/**
 * compose_workplan (D-61, steps 1–3 and 6): a free-form holistic judgment, a strategic evaluation by a fresh call, one
 * revision, then the revised judgment is compiled into the tree as JSON, rendered into the workplan note and its
 * hypothesis notes, and written through the same guards as write_draft. The model decides content at four points
 * (the judgment, the evaluation, the revision, the compile); everything else here is code, inside a token/time budget.
 */
import { createHash } from 'node:crypto';
import { loadPerspectives } from '@/lib/config/perspectives';
import { writeDraftNote } from '@/lib/harness/tools/write-draft';
import type { ToolContext } from '@/lib/harness/types';
import { gatherWorkplanContext } from '../context';
import { Meter } from './budget';
import { describeMissing, frameStatus } from './frame';
import { isCocreateRequest } from './gate';
import { groundTree, modelJudge, vaultExcerpts } from './ground';
import { searchPhrases } from './keywords';
import { buildPack, mergePack } from './pack';
import { hasEllipsis, renderWorkplan } from './render';
import { holisticJudgment } from './judgment';
import { composeModel, attachMeter } from './llm';
import { scrubTree, modelRewrite } from './scrub';
import { readState, updateState, writeTreeSidecar } from './state';
import { draftTree } from './tree';
import { SLOT_KEYS } from './types';

export type ComposeResult =
  | {
      status: 'done';
      version: number;
      path: string;
      hypotheses: number;
      /** The three or four things the Senior should look at: the tree's risks and anything the evaluation left open. */
      risks: string[];
      warnings: string[];
      open_issues: string[];
      /** The closing message, written by the code (short, no evaluation detail); the model passes it on word for word. */
      say: string;
      next: string;
    }
  | { status: 'failed'; next: string };

const sha = (text: string) => createHash('sha256').update(text).digest('hex');

/** The risk for the closing message: a whole phrase, or the fixed sentence when there is none (never a cut-off one or a placeholder). */
export function leadRisk(risks: string[]): string {
  for (const r of risks) {
    const brief = riskBrief(r);
    if (!hasEllipsis(brief) && brief.replace(/[^\p{L}\p{N}]/gu, '').length >= 6) return brief;
  }
  return '主要风险待你补充';
}

export function riskBrief(text: string, max = 30): string {
  const sentence = text.trim().split(/[。；;\n]/)[0].trim();
  let out = sentence;
  if (Array.from(sentence).length > max) {
    const clause = sentence.split(/[，,]/)[0].trim();
    out = Array.from(clause).length >= 8 && Array.from(clause).length <= max ? clause : `${Array.from(sentence).slice(0, max).join('')}…`;
  }
  const open = out.lastIndexOf('《');
  if (open > out.lastIndexOf('》')) out = `${out.slice(0, open).replace(/[…，、：:\s]+$/, '')}…`;
  return out;
}

export async function composeWorkplan(ctx: ToolContext): Promise<ComposeResult> {
  const { vault, workspacePath, projectPath } = ctx;
  let state = await readState(vault, workspacePath);

  const status = frameStatus(state);
  if (status.stage !== 'ready') throw new Error(describeMissing(status, state.pack) || '用户还没有确认「就按这个拆」：先用 ask_user 确认，再调用 frame_topic（confirmed: true）。');
  if (!(await isCocreateRequest(ctx))) throw new Error('现在不是共创一版新 workplan 的阶段（已经有 workplan，或者在等审批）。要改已有的 workplan，直接和用户确认改哪里。');

  // The pack is final now: reference notes are searched again with every slot filled.
  if (!state.pack_frozen) {
    const query = [state.topic, ...SLOT_KEYS.map((k) => state.frame[k])].filter(Boolean).join(' ');
    const queries = await searchPhrases(ctx, state).catch(() => [] as string[]);
    const found = await buildPack({ vault, projectPath, query, queries });
    state = await updateState(vault, workspacePath, (s) => ({ ...s, pack: mergePack(s.pack, found), pack_frozen: true }), ctx.now());
  }

  const meter = new Meter();
  attachMeter(ctx, meter);
  const timing: string[] = [];
  let mark = Date.now();
  const lap = (what: string) => {
    const now = Date.now();
    timing.push(`${what} ${Math.round((now - mark) / 1000)} 秒`);
    mark = now;
  };

  // 1–3 the holistic judgment, its evaluation, one revision
  const judged = await holisticJudgment(state, { model: await composeModel(ctx), meter, perspectives: await loadPerspectives(vault), signal: ctx.abortSignal });
  lap('整体判断、评估、修订');
  const fail = async (why: string) => {
    // The reason is for the log: told to the model it comes out in the chat ("the draft took the policy for a fact").
    await vault.appendLog(ctx.logPath, { time: ctx.now().toISOString(), actor: 'AI', action: 'compose:failed', change: why.slice(0, 600), reason: '拆题没有拆出合格的树 · 阶段=workplan' });
    const tried = (await vault.readLog(ctx.logPath)).filter((r) => r.action === 'compose:failed').length;
    return {
      status: 'failed' as const,
      next: tried <= 1
        ? '对用户只说一句"我换一种拆法再试一次。"，然后马上再调用 compose_workplan（只再试这一次）。不要说原因，不要问用户，不要调用 ask_user。'
        : '对用户只说一句"这次没拆成，稍后再试一次。"。不要说原因，不要问用户。',
    };
  };
  if (!judged) return fail('整体判断没有写出可用的草案');
  const { judgment } = judged;
  if (judged.log.length) {
    await vault.appendLog(ctx.logPath, { time: ctx.now().toISOString(), actor: 'AI', action: 'compose:judgment', change: judged.log.join('；'), reason: '整体判断的评估与修订 · 阶段=workplan' });
  }

  // 6 compile the revised judgment into the tree
  const drafted = await draftTree(ctx, state, judgment.revised, judgment.open);
  lap('编成问题树');
  if ('error' in drafted) return fail(drafted.error);
  let tree = drafted.tree;
  const open = judgment.open;

  // the sources the model attached are checked against the notes' own text; the ones that do not bear on the claim come off
  const grounded = await groundTree(tree, state.pack, vaultExcerpts(vault), modelJudge(ctx));
  tree = grounded.tree;
  lap('核对依据');
  if (grounded.dropped.length) {
    await vault.appendLog(ctx.logPath, {
      time: ctx.now().toISOString(),
      actor: 'AI',
      action: 'compose:ground',
      change: `摘掉 ${grounded.dropped.length} 处挂靠：${grounded.dropped.map((p) => `${p.label}${p.how === 'known' ? '已知' : '待查'}《${p.source.title}》`).join('、')}`.slice(0, 600),
      reason: '依据核对 · 阶段=workplan',
    });
  }

  // ⑥ the text the user reads holds no internal names: the code fixes pack ids, the model rewrites the rest once
  const scrubbed = await scrubTree(tree, state.pack, modelRewrite(ctx));
  tree = scrubbed.tree;
  const scrubWarnings = scrubbed.left.map((l) => `${l.path} 里还有内部名称没去掉：${l.hits.join('、')}`);

  lap('清理内部名称');

  // render and write
  const c = await gatherWorkplanContext(ctx);
  const version = c.writeTarget.version;
  const rendered = renderWorkplan({ tree, state, wsCode: c.wsCode, firstHypothesisNumber: c.nextHypothesisNumber, openIssues: open });

  const workplanName = `workplan v${version}`;
  const derived = [c.links.project, ...(c.skills.cocreate ? [c.skills.cocreate.link] : []), ...(c.writeTarget.previousLink ? [c.writeTarget.previousLink] : [])];
  const workplanLink = `[[${workspacePath}/${workplanName}|${workplanName}]]`;
  // Every note is checked by the write_draft rules before any is written: a refusal then leaves nothing half done.
  const notes: Parameters<typeof writeDraftNote>[0][] = [
    {
      note_type: 'workplan',
      name: workplanName,
      status: '进行中',
      frontmatter: { id: `${c.workspace.id}-workplan-v${version}`, version, derived_from: derived, relates_to: [c.links.workspace], changes: [] },
      body: rendered.body,
    },
    ...rendered.hypotheses.map((h) => ({
      note_type: 'hypothesis' as const,
      name: h.name,
      status: '进行中',
      frontmatter: {
        id: `${c.wsCode.toLowerCase()}-h${h.name.match(/-H(\d+)/)?.[1] ?? ''}`,
        workspace: c.links.workspace,
        statement: h.leaf.hypothesis.statement,
        verdict_proposed: null,
        verdict: null,
        evidence: [],
        counter_evidence: [],
        derived_from: [workplanLink],
        relates_to: [c.links.workspace],
      },
      body: `# ${h.label} ${h.leaf.hypothesis.statement}\n\n看到什么就算它错了：${h.leaf.hypothesis.falsifier}\n`,
    })),
  ];
  for (const n of notes) await writeDraftNote(n, ctx, { dryRun: true });
  const written = await writeDraftNote(notes[0], ctx);
  for (const n of notes.slice(1)) await writeDraftNote(n, ctx);

  await vault.appendLog(ctx.logPath, { time: ctx.now().toISOString(), actor: 'AI', action: 'compose:timing', change: timing.join('；'), reason: '拆题各步用时 · 阶段=workplan' });
  await writeTreeSidecar(vault, workspacePath, version, tree, state.pack, sha(rendered.body));
  await updateState(vault, workspacePath, (s) => ({ ...s, tree, judgment: { ...judgment, open, tokens: meter.tokens } }), ctx.now());
  await vault.appendLog(ctx.logPath, { time: ctx.now().toISOString(), actor: 'AI', action: 'compose:budget', change: `模型用了 ${meter.tokens} tokens，共 ${Math.round(meter.elapsedMs / 1000)} 秒`, reason: '拆题的预算使用 · 阶段=workplan' });

  return {
    status: 'done',
    version,
    path: written.path,
    hypotheses: rendered.hypotheses.length,
    risks: tree.risks.slice(0, 3),
    warnings: [...drafted.warnings, ...scrubWarnings].slice(0, 5),
    open_issues: open,
    say: `v${version} 拆好了：${tree.subquestions.length} 个一级子问题、${rendered.hypotheses.length} 个假设。最大风险：${leadRisk(tree.risks)}。右边是研究计划 v${version}：可以接着改，也可以请 Senior 提意见。`,
    next: '把 say 里的话原样告诉用户，一个字也不要加，不要再发卡片，不要讲评审的细节。',
  };
}
