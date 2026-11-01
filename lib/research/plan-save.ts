/**
 * The owner edits the plan in the UI and saves it as a NEW version (PRD §6.3 步骤 4). A human
 * write, not an AI one: author is the owner; approval fields stay null — only the
 * research_plan.approve event sets them, so any edit locks the research tools again.
 */
import type { Role } from '@/lib/config/roles';
import { researchPlanSchema, type ResearchPlanNote } from '@/lib/notes/schema';
import type { Vault } from '@/lib/vault';
import { latestVersion } from './folders';
import { describePlanCitationFailure } from './plan-checks';
import { cleanConditions } from './question-tree';
import { markExcerptsInPlan, renderPlanBody, type EditablePlan } from './plan-types';
import { localDate } from '@/lib/local-date';
import { PRE_G1_STAGES } from '@/lib/harness/phases';

export class PlanSaveDenied extends Error {
  name = 'PlanSaveDenied';
}

/** Sections the AI wrote that the structured editor does not show; carried into the next version. */
function carriedSections(body: string): string {
  return body
    .split(/^(?=## )/m)
    .filter((s) => /^## (要问专家的问题|模型知识|判断标准)/.test(s))
    .map((s) => s.trimEnd())
    .join('\n\n');
}

export async function savePlanVersion(opts: {
  vault: Vault;
  workspacePath: string;
  researchDir: string;
  role: Role;
  plan: EditablePlan;
  now?: Date;
}): Promise<{ path: string; name: string; version: number }> {
  const { vault, workspacePath, researchDir, role } = opts;
  // quotes shortened with an ellipsis are marked as excerpts, not passed on as verbatim quotes
  const plan = markExcerptsInPlan(opts.plan);
  const now = opts.now ?? new Date();
  const ws = await vault.readTyped(`${workspacePath}/workspace.md`, 'workspace');
  if (role.name !== ws.note.owner) throw new PlanSaveDenied(`只有 Workspace 的负责人（${ws.note.owner}）可以修改调查计划`);
  const latest = await latestVersion(vault, researchDir, '计划');
  if (!latest) throw new PlanSaveDenied('还没有计划，先和 AI 对话生成 计划 v1');
  const prev = await vault.readTyped(latest.path, 'research_plan');
  const prevNote: ResearchPlanNote = prev.note;

  const version = latest.n + 1;
  const name = `计划 v${version}`;
  const exploratory = PRE_G1_STAGES.includes(ws.note.stage);
  const today = now.toISOString();
  const frontmatter = {
    id: `${prevNote.id.replace(/-v\d+$/, '')}-v${version}`,
    type: 'research_plan',
    status: exploratory ? '探索性' : '进行中',
    created: localDate(now),
    updated: localDate(now),
    author: role.name,
    derived_from: [`[[${researchDir}/计划 v${latest.n}|计划 v${latest.n}]]`, ...prevNote.derived_from],
    relates_to: prevNote.relates_to,
    version,
    question: plan.question.trim(),
    purpose: plan.purpose.trim(),
    claims: plan.claims.map((c) => ({
      id: c.id,
      statement: c.statement.trim(),
      hypothesis: c.hypothesis,
      ...(c.question?.trim() ? { question: c.question.trim() } : {}),
      ...(c.parent ? { parent: c.parent } : {}),
      conditions: cleanConditions(c.conditions),
      sub_questions: c.sub_questions.map((q) => ({ id: q.id, question: q.question.trim(), methods: q.methods, ...(q.perspective?.length ? { perspective: q.perspective } : {}) })),
      counter_search: c.counter_search.trim(),
      ...(c.perspective?.length ? { perspective: c.perspective } : {}),
      ...(c.key ? { key: c.key } : {}),
      ...(c.if_bad?.trim() ? { if_bad: c.if_bad.trim() } : {}),
    })),
    ...(plan.perspectives_skipped?.length ? { perspectives_skipped: plan.perspectives_skipped } : {}),
    ...(plan.question_tree?.length ? { question_tree: plan.question_tree } : {}),
    ...(plan.mece_check?.trim() ? { mece_check: plan.mece_check.trim() } : {}),
    approved_by_owner: null,
    approved_at: null,
    exploratory,
  };
  researchPlanSchema.parse(frontmatter); // refuse a plan the harness could not read back
  const carried = carriedSections(prev.body);
  const body = `${renderPlanBody(plan, `${researchDir.split('/').pop()} 调查计划 v${version}`)}\n${carried ? `${carried}\n` : ''}`;
  // the re-rendered body is checked like any plan the model writes: every quote in front of a block link must be in that block
  const failed = (await vault.checkCitations(body)).filter((c) => !c.ok);
  if (failed.length) throw new PlanSaveDenied(`计划里有 ${failed.length} 处引用没通过检查，没有存成新版本：\n${failed.map((f, i) => `${i + 1}. ${describePlanCitationFailure(f)}`).join('\n')}`);
  const path = `${researchDir}/${name}.md`;
  await vault.write(path, { frontmatter, body });
  await vault.appendLog(`${workspacePath}/日志.md`, {
    time: today,
    actor: role.name,
    action: `write:${name}`,
    change: `${role.name} 修改调查计划，存为 ${name}（基于 计划 v${latest.n}）`,
    reason: '计划被修改后需要重新批准，批准之前调查工具保持锁定',
  });
  return { path, name, version };
}
