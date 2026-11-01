/**
 * frame_topic (OWNER: M1) — step 0 of the workplan harness (D-61): the decision contract.
 *
 * The model reports what the user said as six slots and marks every directive / decision / policy item of the pack
 * (一致 / 冲突 / 无关). The tool only stores it and says what is still missing: the decision "is it complete" is the
 * code's (lib/workplan/compose/frame.ts), and while it is not, the model is only given ask_user and frame_topic
 * (lib/workplan/compose/gate.ts). The first call also builds the pack (the notes the user's direction is checked
 * against and the decomposition is grounded in); later calls add reference notes that match the filled slots.
 */
import { z } from 'zod';
import { applyFrameUpdate, describeMissing, frameStatus, type FrameStage } from '@/lib/workplan/compose/frame';
import { buildPack, mergePack } from '@/lib/workplan/compose/pack';
import { updateState } from '@/lib/workplan/compose/state';
import { contractBlocksCompose, CONTRACT_UNCONFIRMED } from '@/lib/workplan/compose/gate';
import { SIZES, SLOT_KEYS, SLOT_LABELS, VERDICTS, type PackItem } from '@/lib/workplan/compose/types';
import type { ToolSpec } from '../types';

export const frameTopicParameters = z.object({
  topic: z.string().trim().optional().describe('The user\'s first message about the topic, word for word. Only needed on the first call.'),
  question: z.string().trim().optional().describe('要回答的问题：一句话，只问一件事。'),
  decision: z.string().trim().optional().describe('要支撑的决策：做完以后，谁要在哪几个选项里选一个。'),
  scope: z.string().trim().optional().describe('范围和时间：看哪些对象、哪一段时间。'),
  success: z.string().trim().optional().describe('成功的样子：看到什么，就算这件事做成了。'),
  known: z.string().trim().optional().describe('已知的事实和判断：用户或资料里已经有的结论（别再当不确定的事去查）。确实没有就写「资料里还没有现成结论」。'),
  bar: z.string().trim().optional().describe('证据要多强才能拍板：例如「内部资料加一个独立外部来源就够」「要有 A/B 级的外部数据」「方向对就行，不要精确」。'),
  resources: z.string().trim().optional().describe('研究资源：只在用户说了能用或不能用的手段时填（例如「可以约 3 位客户访谈」）；不说就不填，系统有默认值。'),
  marks: z
    .array(
      z.object({
        ref: z.string().describe('A pack item id, e.g. K2.'),
        verdict: z.enum(VERDICTS).describe('Does the user\'s direction agree with this item?'),
        note: z.string().describe('One sentence: why.'),
        resolution: z.enum(['按指示', '按用户的想法']).optional().describe('Only for a conflict, after the user chose.'),
      }),
    )
    .optional(),
  size: z.enum(SIZES).optional().describe('小题 = a concrete question the notes can answer ("能不能…" "有没有…" "是多少"), however big the reason for asking; 大题 = a bet or a choice between several ways. Unsure → 大题.'),
  confirmed: z.boolean().optional().describe('true only after the user picked "就按这个拆" on the confirm card.'),
});

export interface FrameTopicResult {
  stage: FrameStage;
  /** The slots still empty (their Chinese names). */
  empty: string[];
  /** Directive / decision / policy items that still need a mark. */
  to_mark: { id: string; kind: string; title: string; status?: string; gist: string; block?: string }[];
  /** Conflicts the user has not decided yet. */
  open_conflicts: { ref: string; title: string; note: string }[];
  /** Parts of the update that were refused, and why. */
  problems: string[];
  /** Said back so the model knows what to do next. */
  next: string;
}

const brief = (i: PackItem) => ({ id: i.id, kind: i.kind, title: i.title, ...(i.status ? { status: i.status } : {}), gist: i.gist, ...(i.block ? { block: i.block } : {}) });

export function nextStep(stage: FrameStage, missing: string, phase?: string): string {
  if (stage === 'framing') return `${missing || ''}先问用户最卡的那一项（ask_user，2–4 个互斥选项），用户已经说过的不再问。`;
  if (stage === 'confirm') return '6 项都填满了，也都标好了：用 ask_user 发一张确认卡，一句话复述这 6 项，选项「就按这个拆」「我要改」；用户选了「就按这个拆」，再调用 frame_topic（confirmed: true）。';
  // D-64 T33: a new project's framing ends in the contract and the issue tree, not a workplan
  if (phase === 'project_framing') return '用户已经确认。现在调用 draft_contract 写决策契约，再调用 draft_issue_tree 拆议题树，不要先写文字。';
  return '用户已经确认。现在就调用 compose_workplan 开始拆题，不要先写文字。';
}

export const frameTopicTool: ToolSpec<typeof frameTopicParameters, FrameTopicResult> = {
  name: 'frame_topic',
  description:
    'Record the user\'s answers as the six slots (question, decision, scope, success, known, bar) and mark each directive/decision/policy item as 一致/冲突/无关. Returns what is still missing. Call it every time the user tells you something that fills a slot or settles a conflict.',
  parameters: frameTopicParameters,
  owner: 'M1',
  implemented: true,
  async execute(args, ctx) {
    const { vault, workspacePath, projectPath } = ctx;
    let problems: string[] = [];
    let missingLine = '';
    let state = await updateState(
      vault,
      workspacePath,
      (s) => ({ ...s, topic: s.topic || args.topic || s.topic }),
      ctx.now(),
    );

    // The pack: everything markable on the first call; reference notes join as the slots fill in.
    const before = state.frame;
    const filled = SLOT_KEYS.some((k) => args[k]?.trim() && args[k]?.trim() !== before[k]);
    if (state.pack.length === 0 || filled) {
      const query = [state.topic, args.question, args.decision, args.scope, args.success, args.known, args.bar, ...SLOT_KEYS.map((k) => before[k])].filter(Boolean).join(' ');
      // only the notes the direction is checked against; the library is searched once the question is confirmed (compose.ts)
      const found = await buildPack({ vault, projectPath, query, maxReferences: 0 });
      state = await updateState(vault, workspacePath, (s) => ({ ...s, pack: mergePack(s.pack, found) }), ctx.now());
    }

    state = await updateState(
      vault,
      workspacePath,
      (s) => {
        const r = applyFrameUpdate(s, args);
        problems = r.problems;
        return r.state;
      },
      ctx.now(),
    );

    const status = frameStatus(state);
    missingLine = describeMissing(status, state.pack);
    const byId = new Map(state.pack.map((i) => [i.id, i]));
    return {
      stage: status.stage,
      empty: status.emptySlots.map((k) => SLOT_LABELS[k]),
      to_mark: status.unmarked.map(brief),
      open_conflicts: status.openConflicts.map((m) => ({ ref: m.ref, title: byId.get(m.ref)?.title ?? m.ref, note: m.note })),
      problems,
      // D-64 T21: confirmed, but the decision contract is not: no compose_workplan yet (gate.ts), and the model says why
      next: status.stage === 'ready' && ctx.phase !== 'project_framing' && (await contractBlocksCompose(ctx)) ? `${CONTRACT_UNCONFIRMED}。告诉用户：请 Senior 在项目页确认决策契约。` : nextStep(status.stage, missingLine ? `${missingLine} ` : '', ctx.phase),
    };
  },
  summarize: (_a, r) => (r ? `记下了；${r.stage === 'framing' ? `还缺 ${r.empty.length} 项、${r.to_mark.length} 条没标` : r.stage === 'confirm' ? '6 项齐了，等用户确认' : '用户已确认'}` : '记下了'),
};
