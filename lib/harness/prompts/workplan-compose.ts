/**
 * Prompt text for the first co-creation of a workplan, the one the compose pipeline drafts (D-61).
 *
 * The model's job here is only to pin the topic down (frame_topic) and to call compose_workplan; the code decides
 * what is missing (lib/workplan/compose/frame.ts) and which tools exist (gate.ts). Pure: renders the context.
 */
import { taskLine } from '@/lib/testing/mock-contract';
import { describeMissing, frameLines, frameStatus, type FrameStage } from '@/lib/workplan/compose/frame';
import { isMarkable, type ComposeState, type PackItem } from '@/lib/workplan/compose/types';
import type { WorkplanContext } from '@/lib/workplan/context';

/** The tools the model is told it has, by stage (the same sets as gate.ts). */
export function composeToolsText(stage: FrameStage): string {
  return stage === 'ready'
    ? 'ask_user、frame_topic、compose_workplan。没有 write_draft：workplan 和假设笔记由 compose_workplan 写。'
    : 'ask_user、frame_topic。没有 write_draft：workplan 和假设笔记由系统在你调用 compose_workplan 时写，而这个工具要等用户确认了题目才有。';
}

export function composeProtocolText(c: WorkplanContext): string {
  const redo =
    c.redoPending && c.latest
      ? `\n\n**Junior 要求重新做一版。** 旧的 workplan v${c.latest.version} 保留，不动它，也不照抄。第一问先问旧版哪里不对、这一版要怎么不一样；他的回答用 frame_topic 记进 6 项（不一样的地方写进「成功的样子」）。`
      : '';
  return `${taskLine('workplan_cocreate')}

这一次 workplan 不是你写的。你的工作分两段：先把题目问清楚（定下决策契约），再叫系统去做（compose_workplan：整体判断、独立评估、修订，再编成 workplan）。

### 第一段：定题（决策契约）

用 frame_topic 记下 6 件事，填满为止：**要回答的问题**（一句话，只问一件事）、**要支撑的决策**（做完以后谁要在哪几个选项里选）、**范围和时间**、**成功的样子**、**已知的事实和判断**（用户或资料里已经有的结论，后面不会再当成不确定的事去查）、**证据要多强才能拍板**（例如"内部资料加一个独立外部来源就够""要有 A/B 级的外部数据""方向对就行"）。再把下面"定题进度"里资料包的每一条高层指示、已确认的决定、公司方针标成：一致、冲突，或者无关（用户的方向和它比）。

1. 用户一开口就先调用 frame_topic（topic 填他的原话）：他说清的项先填上，资料包里的条目先标好。范围和时间、成功的样子、已知的事实和判断，用户没明说但能合理推出来（已知的事实可以从资料包里读出来；确实没有就填"资料里还没有现成结论"），就先替他填上，确认卡上让他改。**要支撑的决策、证据要多强才能拍板，不要替他推**：他没说拿这个答案去做什么决定，就问（给 2–3 个你推测的选项），这一项最影响后面怎么判断；证据门槛他没提，也问一次（给 2–3 个选项，你推荐的放前面）。他说了决策和选项，就用他说的；**用户没说地区，就不要问**，也不要把方针里的地区优先顺序标成冲突：按方针的默认写进范围，确认卡里带一句让他改。不要再问"要不要把……也列进去""范围按哪边"这类细节，先替他定下，让确认卡去改。问过、说过的不再问。
2. 标记自己判断，不问用户。**一致**：用户的方向在资料的意思之内；**无关**：资料说的是别的事；**冲突**：用户要做的事和资料明说的相反。用户只是在问"选哪个""要不要"，把某件事当成几个选项之一来比较，不算和"别只看它""先别纠结它"这类指示冲突，题目本身就是在比较；只有用户明确要做那件事、而资料明说不做，才是冲突。另外，资料里写了一条边界（"不和别人抢某个入口""不做某类产品"），而用户的方向会碰到它——哪怕用的是"取代""顶替""替换""补位"这类词，说的是平台或别人已经占着的位置——也标冲突，让用户判断是不是抢。**只有冲突才问用户**：用 ask_user，先说"《标题》里说……，你这个方向和它不一样"（标题一定要写，带《》），选项是「按指示」「按你的想法（这处出入写进风险，让 Senior 在 G1 判断）」，用户也可以自己写。**默认推荐「按指示」或"先判断要不要做"**，不要推荐顺着用户走，除非用户已经拿出了资料里没有的证据；问句里要说出资料怎么写、以及用户这个前提目前有没有证据（"资料里还没有这方面的证据"）；他选了以后，在 frame_topic 的 marks 里带上 resolution。
3. 用户把一个没有证据的说法当前提（"肯定愿意""一定会""大家都"）：不要照着往下拆"怎么做"。要回答的问题改成"是不是真的 / 要不要做"，用半句话在问冲突或发确认卡时点出来（"这点还没有证据，我会把它拆成要先检验的一支"）。
4. 一次只问一件事，先问最卡判断的那一项；题目含糊，就先问最模糊的。每张卡 2–4 个互斥选项，你推荐的放前面。
5. 第一次调用 frame_topic 时就填 size：用户问的是一个能用资料直接查证的具体问题（"能不能……""有没有……""是多少"），不管他拿答案去干什么，都填「小题」；要在几条路里选、要押注的填「大题」；拿不准填「大题」。代码按它限制树的大小，用户看不到这一项。
6. 6 项都填满、都标好、冲突都有结论后，frame_topic 会返回 stage = confirm。这时发一张确认卡：一句话复述这 6 项，并带半句研究资源（"定题进度"里那一行，用户说能多做什么就用 frame_topic 的 resources 记下），选项「就按这个拆」「我要改」。用户选了「就按这个拆」，立刻调用 frame_topic（confirmed: true），然后马上调用 compose_workplan，**中间不再问任何问题**。用户之后改了任何一项，要重新确认。

### 第二段：交给系统

记下确认（frame_topic，confirmed: true）之后，你多一个工具 compose_workplan，同一轮里马上调用，不要再发卡片问"要不要现在拆"。调用之前可以先用一句话告诉他"我现在去做，大概几分钟"。它会先整体判断、再请一个独立的评估员挑刺、修订一轮，最后编成 workplan，要几分钟。它返回：
- done：把返回里的 say 原样告诉用户，一个字也不要加；不要再发卡片，也不要讲评审的细节。
- failed：只按返回里 next 说的做（一句固定的话，通常是马上再试一次）。不要说原因，不要问用户，不要编造一个结果。

不要自己写 workplan，也不要在聊天里贴问题树。${redo}`;
}

const kindLabel: Record<PackItem['kind'], string> = {
  directive: '高层指示',
  decision: '已确认的决定',
  policy: '公司方针',
  method: '方法库',
  reference: '参考资料',
};

function packLine(i: PackItem, state: ComposeState): string {
  const mark = state.marks.find((m) => m.ref === i.id);
  const tag = !isMarkable(i)
    ? ''
    : mark
      ? `｜已标：${mark.verdict}${mark.verdict === '冲突' ? (mark.resolution ? `（用户选了${mark.resolution}）` : '（还没问用户）') : ''}`
      : '｜还没标';
  return `- ${i.id}｜${kindLabel[i.kind]}｜《${i.title}》${i.block ? ` ${i.block}` : ''}｜${i.gist}${tag}`;
}

/** The "定题进度" block: what the state file holds right now, written by code so the model does not have to remember it. */
export function composeProgressText(state: ComposeState): string {
  const status = frameStatus(state);
  const stageText: Record<FrameStage, string> = {
    framing: '还在定题',
    confirm: '6 项齐了，下一步发确认卡',
    ready: '用户已确认，可以调用 compose_workplan',
  };
  const missing = describeMissing(status, state.pack);
  const lines = [
    `阶段：${stageText[status.stage]}`,
    ...frameLines(state.frame).map((l) => `- ${l}`),
    `- 研究资源：${state.resources}`,
    ...(missing ? [missing] : []),
    '',
    '资料包（编号只给 frame_topic 用；对用户说话时只用《标题》）：',
    ...(state.pack.length ? state.pack.map((i) => packLine(i, state)) : ['（还没建：第一次调用 frame_topic 时系统会建）']),
  ];
  return lines.join('\n');
}
