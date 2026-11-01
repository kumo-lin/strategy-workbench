/**
 * Approval events — the ONLY way workspace `stage`, research-plan approval,
 * decision status and hypothesis verdicts change (PRD §10.2 关卡, §7 rules 10–11).
 *
 * Every event carries a human actor (a Role from 90_配置/角色.md). There is
 * no AI actor in this type, and no tool emits these events: they come from
 * buttons the human clicks (API routes owned by M1 / M2).
 *
 *   planApprovalEvent(event, state)  → pure: the patches to apply, or why not
 *   applyApprovalEvent(vault, event) → reads state, writes patches, logs
 *
 * CONTRACT (frozen after M0). M1/M2/M3 add side effects (e.g. creating the
 * review note) in their own route handlers around applyApprovalEvent.
 */
import type { Role } from '@/lib/config/roles';
import type { Gate, NoteFrontmatter, Verdict, WorkspaceNote, WorkspaceStage } from '@/lib/notes/schema';
import type { Vault } from '@/lib/vault';

export type ApprovalEvent =
  /** Owner asks for review at a gate (结论: report, G2/G3 full form). For G1 it asks the Senior for an opinion; the stage does not move. */
  | { type: 'review.request'; actor: Role; workspace: string; gate: Gate; subject: string }
  /** Reviewer passes the gate. For G1, only `subject` (the workplan) gets approved_by/at; stage and flags stay. */
  | { type: 'review.approve'; actor: Role; workspace: string; gate: Gate; subject: string }
  /** Reviewer sends it back: stage steps back, flag 返工中 (G1: an opinion; stage and flags unchanged). */
  | { type: 'review.reject'; actor: Role; workspace: string; gate: Gate; subject: string }
  /** Workspace owner approves their own research plan → research tools unlock; 拆题中 / workplan待审 also start 执行中. */
  | { type: 'research_plan.approve'; actor: Role; workspace: string; plan: string }
  /** Senior confirms / rejects an AI-drafted 决定 + 理由. */
  | { type: 'decision.confirm'; actor: Role; decision: string }
  | { type: 'decision.reject'; actor: Role; decision: string }
  /** A human sets the verdict on a hypothesis (AI only proposes). */
  | { type: 'verdict.set'; actor: Role; hypothesis: string; verdict: Verdict };

export type ApprovalEventType = ApprovalEvent['type'];

/** Stage transitions per gate (§6.6). */
export const GATE_TRANSITIONS: Record<Gate, { from: WorkspaceStage; pending: WorkspaceStage; approved: WorkspaceStage }> = {
  G1: { from: '拆题中', pending: 'workplan待审', approved: '执行中' },
  结论: { from: '执行中', pending: '结论待审', approved: '撰写中' },
  G2: { from: '撰写中', pending: '骨架待审', approved: '撰写中' },
  G3: { from: '撰写中', pending: '终稿待审', approved: '完成' },
};

export interface NotePatch {
  path: string;
  /** Frontmatter keys to set. */
  set: Record<string, unknown>;
}

export type EventPlan =
  | { ok: true; patches: NotePatch[]; summary: string }
  | { ok: false; reason: string };

/** The notes an event reads, keyed by vault path. */
export type EventState = Record<string, NoteFrontmatter | undefined>;

function deny(reason: string): EventPlan {
  return { ok: false, reason };
}

function requireType<T extends NoteFrontmatter['type']>(state: EventState, path: string, type: T) {
  const n = state[path];
  return n && n.type === type ? (n as Extract<NoteFrontmatter, { type: T }>) : null;
}

/** Pure: decide what an event changes. `now` is an ISO datetime. */
export function planApprovalEvent(event: ApprovalEvent, state: EventState, now: string): EventPlan {
  const actor = event.actor;
  // Defence in depth: the type has no AI actor, but data can come from anywhere.
  if (!actor || (actor.name as string) === 'AI') return deny('approval events need a human actor');

  switch (event.type) {
    case 'review.request':
    case 'review.approve':
    case 'review.reject': {
      const ws = requireType(state, event.workspace, 'workspace');
      if (!ws) return deny(`${event.workspace} is not a workspace`);
      const wsPatch = (set: Partial<WorkspaceNote>): NotePatch => ({ path: event.workspace, set: { ...set, updated: now } });

      // G1 is not a stage gate: it asks the Senior for an opinion and never
      // changes the workspace stage or flags.
      if (event.gate === 'G1') {
        if (event.type === 'review.request') {
          if (actor.name !== ws.owner) return deny(`only the owner (${ws.owner}) can request ${event.gate} review`);
          return { ok: true, patches: [], summary: `${actor.name} 发给 ${ws.reviewer} 征求意见` };
        }
        if (actor.kind !== 'senior' || actor.name !== ws.reviewer) {
          return deny(`only the reviewer (${ws.reviewer}) can decide ${event.gate}`);
        }
        if (event.type === 'review.reject') {
          return { ok: true, patches: [], summary: `${actor.name} 对 workplan 有意见，请修改` };
        }
        if (!requireType(state, event.subject, 'workplan')) return deny(`${event.subject} is not a workplan`);
        return {
          ok: true,
          patches: [{ path: event.subject, set: { status: '已确认', approved_by: actor.name, approved_at: now, updated: now } }],
          summary: `${actor.name} 看过了 workplan，没有要改的`,
        };
      }

      const t = GATE_TRANSITIONS[event.gate];

      if (event.type === 'review.request') {
        if (actor.name !== ws.owner) return deny(`only the owner (${ws.owner}) can request ${event.gate} review`);
        if (ws.stage !== t.from) return deny(`${event.gate} review needs stage ${t.from}, workspace is ${ws.stage}`);
        return { ok: true, patches: [wsPatch({ stage: t.pending })], summary: `${actor.name} 提交 ${event.gate} 审批` };
      }
      if (actor.kind !== 'senior' || actor.name !== ws.reviewer) {
        return deny(`only the reviewer (${ws.reviewer}) can decide ${event.gate}`);
      }
      if (ws.stage !== t.pending) return deny(`${event.gate} is not pending (stage ${ws.stage})`);

      if (event.type === 'review.reject') {
        const flags = ws.flags.includes('返工中') ? ws.flags : [...ws.flags, '返工中' as const];
        return { ok: true, patches: [wsPatch({ stage: t.from, flags })], summary: `${actor.name} 打回 ${event.gate}` };
      }
      const patches = [wsPatch({ stage: t.approved, flags: ws.flags.filter((f) => f !== '返工中') })];
      return { ok: true, patches, summary: `${actor.name} 通过 ${event.gate}` };
    }

    case 'research_plan.approve': {
      const ws = requireType(state, event.workspace, 'workspace');
      if (!ws) return deny(`${event.workspace} is not a workspace`);
      if (actor.name !== ws.owner) return deny(`only the workspace owner (${ws.owner}) approves its research plans`);
      const plan = requireType(state, event.plan, 'research_plan');
      if (!plan) return deny(`${event.plan} is not a research plan`);
      if (plan.approved_at) return deny('plan already approved');
      // A plan approved = the work has started (§6.6; G1 no longer moves the stage, D-56 ⑤a).
      const starts = ws.stage === '拆题中' || ws.stage === 'workplan待审';
      const patches: NotePatch[] = [
        { path: event.plan, set: { status: '已确认', approved_by_owner: actor.name, approved_at: now, updated: now } },
      ];
      if (starts) patches.push({ path: event.workspace, set: { stage: '执行中', updated: now } });
      return {
        ok: true,
        patches,
        summary: `${actor.name} 批准调查计划 v${plan.version}${starts ? '，开始执行' : ''}`,
      };
    }

    case 'decision.confirm':
    case 'decision.reject': {
      if (actor.kind !== 'senior') return deny('only a Senior confirms decisions');
      const d = requireType(state, event.decision, 'decision');
      if (!d) return deny(`${event.decision} is not a decision`);
      if (d.status !== '推断') return deny(`decision is ${d.status}, not 推断`);
      const confirm = event.type === 'decision.confirm';
      return {
        ok: true,
        patches: [{ path: event.decision, set: { status: confirm ? '已确认' : '已否决', decided_by: actor.name, updated: now } }],
        summary: `${actor.name} ${confirm ? '确认' : '否决'}决定`,
      };
    }

    case 'verdict.set': {
      const h = requireType(state, event.hypothesis, 'hypothesis');
      if (!h) return deny(`${event.hypothesis} is not a hypothesis`);
      return {
        ok: true,
        patches: [{ path: event.hypothesis, set: { verdict: event.verdict, updated: now } }],
        summary: `${actor.name} 判定 ${h.id} → ${event.verdict}`,
      };
    }
  }
}

/** Paths an event needs to read. */
export function eventReads(event: ApprovalEvent): string[] {
  switch (event.type) {
    case 'review.request':
    case 'review.approve':
    case 'review.reject':
      return [event.workspace, event.subject];
    case 'research_plan.approve':
      return [event.workspace, event.plan];
    case 'decision.confirm':
    case 'decision.reject':
      return [event.decision];
    case 'verdict.set':
      return [event.hypothesis];
  }
}

export class ApprovalDenied extends Error {
  name = 'ApprovalDenied';
}

/**
 * Apply an event to the vault: read → plan → write patches (atomic per note)
 * → append to `logPath` (if given). Throws ApprovalDenied when not allowed.
 */
export async function applyApprovalEvent(
  vault: Vault,
  event: ApprovalEvent,
  opts: { now?: Date; logPath?: string; reason?: string } = {},
): Promise<{ summary: string; patches: NotePatch[] }> {
  const now = (opts.now ?? new Date()).toISOString();
  const state: EventState = {};
  for (const p of eventReads(event)) {
    if (await vault.exists(p)) state[p] = (await vault.read(p)).note ?? undefined;
  }
  const plan = planApprovalEvent(event, state, now);
  if (!plan.ok) throw new ApprovalDenied(plan.reason);
  for (const patch of plan.patches) {
    const n = await vault.read(patch.path);
    await vault.write(patch.path, { frontmatter: { ...n.data, ...patch.set }, body: n.body }, { overwrite: true });
  }
  if (opts.logPath) {
    await vault.appendLog(opts.logPath, {
      time: now,
      actor: event.actor.name,
      action: `event:${event.type}`,
      change: plan.summary,
      reason: opts.reason ?? '人的审批事件',
    });
  }
  return { summary: plan.summary, patches: plan.patches };
}
