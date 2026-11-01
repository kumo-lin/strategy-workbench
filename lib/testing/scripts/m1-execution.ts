/**
 * T55: the M1 investigation's model answers, one row per hypothesis (claim id). Each step prompt names its sub-question
 * (`C1-Q1`), so the row is picked by id, never by words that also appear in the workplan background. A row says what
 * to search, which source sentences are direct evidence for or against THIS hypothesis (everything else is irrelevant),
 * and what is still missing. Verdicts are not written here: the proposal follows the evidence the prompt lists, and the
 * engine checks it (enforceVerdict, the stop rule).
 */
import { M1_SO_WHAT_V1, m1PageQuotes } from './m1';

interface Row {
  kb: string[];
  /** The query of each web round; a focus left out searches with a query that finds nothing. */
  web: { support?: string; gap?: string; counter?: string };
  supports: RegExp[];
  /** Refutes that narrow the hypothesis (partial): it holds only for fewer users or fewer permissions. */
  refutes: RegExp[];
  /** The hypothesis as the evidence leaves it, when something refutes it, and the plan condition the refutes decide (不成立). */
  revised?: string;
  narrows?: number;
  gap: string;
  /** The hypothesis in a few words (the summary table's 假设 column). */
  short: string;
  /** Whom to ask what (v6 2.9), for a hypothesis the evidence left open. */
  ask?: string;
}

const ROWS: Record<string, Row> = {
  // K3 H1: the 80 configurations show supply only; the two cross-device rounds find no retention comparison
  C1: { kb: ['Qira', 'supported PC', 'cross-device'], web: { support: 'cross-device continuity retention study', gap: 'cross-device single-device user retention comparison' }, supports: [/more than 80 supported PC configurations/], refutes: [], gap: '没有跨设备与单设备用户的留存对比', short: '跨设备有持续增量', ask: '问Qira 产品分析负责人：跨设备用户与单设备用户的留存差多少？' },
  // K3 H2: Recon (S10) shows that most users already use more than one tool
  C2: { kb: ['Qira', 'single intelligence'], web: { support: 'AI users switching primary AI tool' }, supports: [/already use more than one tool/], refutes: [], gap: '没有控制模型和任务后的对照', short: '跨设备价值来自新鲜感', ask: '问Qira 产品分析负责人：控制重度用户后，跨设备和单设备用户的差距还在吗？' },
  // K3 H3: Ping shows how far users go on permissions, not whether they value cross-device
  C3: { kb: ['33%', 'inbox', 'Ping Identity'], web: {}, supports: [/only 33% indicating willingness/], refutes: [], gap: '没有用户认可跨设备价值的数据', short: '授权成本抵消价值', ask: '问隐私与信任团队负责人：用户授权邮箱、日历时，哪一步放弃最多？' },
  // K1: half have tried, a quarter use it daily — habit holds for fewer users than the hypothesis says
  C4: { kb: ['49%', '24%', 'one-in-four'], web: {}, supports: [], refutes: [/Ever use Do not ever use U\.S\. adults total 49%/, /NET Daily U\.S\. adults 51%/], revised: '只有少数用户形成了每天使用的习惯，高频任务不是普遍存在的', narrows: 2, gap: '没有可核对的高频任务留存数据', short: '高频任务形成习惯', ask: '问多设备重度用户：最近一周，哪些事在电脑上开始、在手机上接着做？' },
  C5: { kb: ['Not interested', 'never use'], web: {}, supports: [], refutes: [], gap: '没有长期任务频率与使用动机的对照', short: '使用来自短期尝试' },
  // K2: nothing public compares the same task with and without personal context
  C6: { kb: ['personal context', 'same task'], web: {}, supports: [], refutes: [], gap: '没有同任务对比', short: '个人上下文有增量' },
  C7: { kb: ['general assistant', 'same task'], web: {}, supports: [], refutes: [], gap: '没有控制用户和任务后的比较', short: '通用助手已经足够' },
  // K4: only a third grant read access to email, and at most 11% let AI decide a purchase (S12)
  C8: { kb: ['33%', 'inbox', 'Ping Identity'], web: { support: 'consumers let AI make purchase decisions survey' }, supports: [], refutes: [/only 33% indicating willingness/, /topped out at 11%/], revised: '用户只接受分层、看得见、能撤回的授权，不会普遍开放所需权限', narrows: 1, gap: '不知道哪一步授权放弃最多', short: '用户普遍愿意授权', ask: '问隐私与信任团队负责人：只读和代为执行的授权率差多少？' },
  C9: { kb: ['分层授权', 'permission tiers'], web: {}, supports: [], refutes: [], gap: '没有收益与权限层级的同任务对照', short: '看清收益后接受分层授权' },
};

/** The claim of a step prompt, from its sub-question id (`子问题 C1-Q1：`, `当前子问题 C1-Q1：`, `- C1-Q1 …`). */
function rowOf(text: string): [string, Row] | null {
  const id = /^(?:当前)?子问题 (C\d+)-Q\d+：/m.exec(text)?.[1] ?? /^- (C\d+)-Q\d+ /m.exec(text)?.[1];
  return id && ROWS[id] ? [id, ROWS[id]] : null;
}

export function m1ExecutionAnswer(text: string): unknown {
  if (text.includes('页面文本开始')) {
    const quotes = m1PageQuotes(/^资料：(.+)（/m.exec(text)?.[1] ?? '');
    return quotes ? { claims: quotes } : undefined;
  }
  if (text.includes('请给出两组查询')) {
    const row = rowOf(text);
    if (!row) return undefined;
    const focus = text.includes('专门找**反证**') ? 'counter' : text.includes('目标：补缺') ? 'gap' : 'support';
    return { kb_queries: row[1].kb, web_queries: [row[1].web[focus] ?? `${row[0]} ${focus} no further sources`] };
  }
  if (text.includes('论断列表：')) {
    const row = rowOf(text);
    if (!row) return undefined;
    const r = row[1];
    return {
      items: [...text.matchAll(/^\[(\d+)\] （[^）]*）(.*)$/gm)].map((m) => {
        const q = m[2];
        const refutes = r.refutes.some((p) => p.test(q));
        const supports = !refutes && r.supports.some((p) => p.test(q));
        return { id: Number(m[1]), stance: refutes ? 'refutes' : supports ? 'supports' : 'irrelevant', reason: refutes ? '说明假设只在更少的用户或权限上成立' : supports ? '直接回答这个假设的一个成立条件' : '和这个假设无关', core: false, partial: refutes };
      }),
    };
  }
  if (text.includes('请提出判断')) {
    const row = rowOf(text);
    if (!row) return undefined;
    const r = row[1];
    const evidence = [...text.matchAll(/^\[(E\d+)\] (支持|反驳)/gm)];
    const refutes = evidence.filter((m) => m[2] === '反驳').map((m) => m[1]);
    const supports = evidence.filter((m) => m[2] === '支持').map((m) => m[1]);
    const narrowed = refutes.length > 0 && !!r.revised;
    const ns = [...(/逐条判上面"必须成立的条件"里的这几条：([^；。]*)/.exec(text)?.[1].matchAll(/\((\d+)\)/g) ?? [])].map((m) => Number(m[1]));
    return {
      verdict: narrowed ? '需要修改' : '证据不足',
      rebutted: [],
      revised_statement: narrowed ? r.revised : null,
      support_lines: supports.slice(0, 2).map((k) => `公开资料只回答了其中一个条件 [${k}]`),
      counter_lines: refutes.slice(0, 2).map((k) => `公开资料显示适用的用户更少 [${k}]`),
      reasoning: narrowed ? '反面证据说明这个假设只在更少的用户或权限上成立，需要收窄' : '已有资料没有提供这个假设需要的对照，不能下结论',
      challenge_responses: refutes.map((key) => ({ key, challenge: '公开资料说明适用范围更窄', response: '承认限制，按更窄的范围改写假设', effect: '假设要改' })),
      model_knowledge: [],
      so_what: ['先按具体任务和用户验证，不作普遍推广'],
      gaps: [r.gap],
      expert_questions: r.ask ? [r.ask] : [],
      conditions: ns.map((n) => ({ n, status: narrowed && n === r.narrows ? '不成立' : '证据不足', keys: narrowed && n === r.narrows ? refutes : [], note: '只判断本次公开证据能证明的范围' })),
      answer: narrowed ? '只在更少的用户或权限上成立' : '公开资料不足以回答',
      reasons: ['已列明具体证据缺口'],
      short_statement: r.short,
    };
  }
  if (text.includes('请逐条回应这几条反驳')) {
    const keys = [...(/这一次只回应这几条"反驳"：([^（]*)（/.exec(text)?.[1].matchAll(/E\d+/g) ?? [])].map((m) => m[0]);
    return { challenge_responses: keys.map((key) => ({ key, challenge: '公开证据说明适用范围更窄', response: '承认限制，按更窄的范围改写假设', effect: '假设要改' })) };
  }
  if (text.includes('下面是各子问题已经定稿的回答')) return { so_what: `${M1_SO_WHAT_V1}[Q1]`, decision_answer: '提议：跨设备先按用户和场景验证，拿到留存数据后复审[Q1]' };
  if (text.includes('写"AI 的推荐判断（提议，待人拍板）"')) return {
    decision_answer: '提议：跨设备先按用户和场景验证，不作普遍卖点',
    action: '个人 AI 产品团队与应用伙伴合作，把电脑准备、手机跟进的连续任务作为细分产品卖点', action_kind: '合作',
    scale: '先用小团队面向少量高频任务用户验证', scale_inferred: true, scale_basis: '按小范围验证估算，缺少可核对的投入数据',
    metrics: ['跨设备与单设备用户的留存差异', '分层授权中的放弃位置'],
    alternatives: [
      { dimension: 'layer', option: '把跨设备作为普遍卖点', kind: '其他', why_not: '公开资料没有证明普遍持续价值' },
      { dimension: 'acquire', option: '全部自研上下文能力', kind: '自研', why_not: '缺少同任务对照，尚不足以支持全面自研' },
      { dimension: 'acquire', option: '收购个人助手团队', kind: '收购', why_not: '不适用：留存证据不足，不支持收购投入' },
    ], change_if: ['拿到可核对的留存数据或同任务实验结果'],
  };
  return undefined;
}
