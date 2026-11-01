'use client';

import { ListTree, Plus, Save, ShieldCheck, Trash2, X } from 'lucide-react';
import { useMemo, useState, type JSX } from 'react';

import {
  Plan,
  PlanAction,
  PlanContent,
  PlanDescription,
  PlanHeader,
  PlanTitle,
  PlanTrigger,
} from '@/components/ai-elements/plan';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { ReadOnlyNotice } from '@/components/shell/readonly-notice';
import { WindowLink } from '@/components/shell/window-link';
import { InvestigationPlanView } from './investigation-plan';
import { RunDialog } from './run-dialog';
import type { ResearchMode } from '@/lib/research/constants';
import { perspectiveGaps } from '@/lib/research/perspectives';
import { conditionText, hypothesisLabel, isTreePlan, subQuestionLabel, treeChecks, treeOrder, withConditionText, type PlanCondition, type TreeLeaf } from '@/lib/research/question-tree';
import { RESEARCH_METHOD_LIST } from '@/lib/research/plan-types';
import type { EditableClaim, EditablePlan, ResearchMethodName } from '@/lib/research/plan-types';
import { cn } from '@/lib/utils';
import {
  addChildQuestion,
  addClaim,
  addSubQuestion,
  addTopQuestion,
  editorTree,
  emptyCondition,
  planEquals,
  removeClaim,
  removeQuestion,
  removeSubQuestion,
  removeTreeNode,
  splitQuestion,
  togglePerspective,
  updateClaimQuestion,
  updateCondition,
  updateSubQuestion,
  updateTreeNode,
  validatePlan,
} from './plan-edit-utils';

export interface PlanEditorProps {
  /** 当前版本的内容（初始值） */
  plan: EditablePlan;
  /** 例如 "计划 v2" */
  planName: string;
  /** 已批准的版本不能再改，只能"另存为新版本"。 */
  approved: boolean;
  /** 只有 Workspace 的 owner 能改和批准。 */
  canEdit: boolean;
  /** 存成新版本；成功返回 { ok: true, name: '计划 v3' }。 */
  onSave: (plan: EditablePlan) => Promise<{ ok: true; name: string } | { ok: false; error: string }>;
  /** 这个 Workspace 的负责人（只读说明里写出来）。 */
  ownerName?: string;
  /** 刚存好的版本：保存后页面刷新、编辑器换成新版本的那一个，提示由它接着显示。 */
  savedNotice?: string;
  /** 批准当前版本。 */
  onApprove: (mode: ResearchMode) => Promise<{ ok: true } | { ok: false; error: string }>;
  /** 团队要求覆盖的视角（90_配置/团队.md）；漏掉的会在计划上方醒目提示，但不拦批准。 */
  perspectives?: string[];
}

type ClaimPatch = Partial<Pick<EditableClaim, 'statement' | 'counter_search' | 'conditions' | 'perspective'>>;

const CLAIM_SUMMARY_LIMIT = 40;

/** The Plan card's description line: the first 40 characters of the claim statement. */
function claimSummary(statement: string): string {
  const text = statement.trim();
  if (!text) return '（还没有写论点陈述）';
  const chars = Array.from(text);
  return chars.length <= CLAIM_SUMMARY_LIMIT
    ? text
    : chars.slice(0, CLAIM_SUMMARY_LIMIT).join('');
}

function patchClaim(plan: EditablePlan, claimId: string, patch: ClaimPatch): EditablePlan {
  return {
    ...plan,
    claims: plan.claims.map((claim) => {
      if (claim.id !== claimId) return claim;
      const next = { ...claim, ...patch };
      if ('perspective' in patch && !patch.perspective?.length) delete next.perspective;
      return next;
    }),
  };
}

/** The team's perspectives as toggles (several or none); the gap banner follows every click. */
function PerspectivePicker(props: { owner: string; value: string[] | undefined; options: string[]; disabled: boolean; onToggle: (perspective: string) => void }): JSX.Element | null {
  const options = [...props.options, ...(props.value ?? []).filter((p) => !props.options.includes(p))];
  if (!options.length) return null;
  return (
    <div className="flex flex-wrap items-center gap-1" role="group" aria-label={`${props.owner} 的视角`}>
      <span className="text-xs text-muted-foreground">视角：</span>
      {options.map((p) => {
        const selected = props.value?.includes(p) ?? false;
        return (
          <Button key={p} type="button" size="xs" variant={selected ? 'default' : 'outline'} aria-pressed={selected} aria-label={`${props.owner} 视角：${p}`} disabled={props.disabled} onClick={() => props.onToggle(p)}>
            {p}
          </Button>
        );
      })}
    </div>
  );
}

function toggleMethod(
  methods: ResearchMethodName[],
  method: ResearchMethodName,
): ResearchMethodName[] {
  return methods.includes(method) ? methods.filter((m) => m !== method) : [...methods, method];
}

interface ClaimsProps {
  draft: EditablePlan;
  apply: (updater: (plan: EditablePlan) => EditablePlan) => void;
  editable: boolean;
  perspectives: string[];
}

/** An older-format plan (论点 → 子问题), shown as it always was. */
function LegacyClaims({ draft, apply, editable, perspectives }: ClaimsProps): JSX.Element {
  return (
    <>
  <div className="flex flex-col gap-3">
    {draft.claims.map((claim) => (
      <Plan key={claim.id} defaultOpen>
        <PlanHeader>
          <div className="flex min-w-0 flex-col gap-1">
            <PlanTitle>{`论点 ${claim.id}`}</PlanTitle>
            <PlanDescription className="line-clamp-2">
              {claimSummary(claim.statement)}
            </PlanDescription>
            {claim.perspective?.length ? <span className="text-xs text-muted-foreground">视角：{claim.perspective.join('、')}</span> : null}
          </div>
          <PlanAction className="flex items-center gap-1">
            <PlanTrigger />
            {editable ? (
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={`删除论点 ${claim.id}`}
                disabled={draft.claims.length <= 1}
                onClick={() => apply((plan) => removeClaim(plan, claim.id))}
              >
                <Trash2 />
              </Button>
            ) : null}
          </PlanAction>
        </PlanHeader>

        <PlanContent className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`claim-statement-${claim.id}`}>论点陈述</Label>
            <Textarea
              id={`claim-statement-${claim.id}`}
              rows={2}
              value={claim.statement}
              disabled={!editable}
              placeholder="一句话说清这个论点主张什么"
              onChange={(event) => {
                const value = event.target.value;
                apply((plan) => patchClaim(plan, claim.id, { statement: value }));
              }}
            />
            <PerspectivePicker
              owner={`论点 ${claim.id}`}
              value={claim.perspective}
              options={perspectives}
              disabled={!editable}
              onToggle={(p) => apply((plan) => patchClaim(plan, claim.id, { perspective: togglePerspective(plan.claims.find((c) => c.id === claim.id)?.perspective, p) }))}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>成立的条件</Label>
            <div className="flex flex-col gap-2">
              {claim.conditions.map((condition, index) => (
                <div key={`${claim.id}-condition-${index}`} className="flex items-center gap-2">
                  <Input
                    aria-label={`论点 ${claim.id} 的第 ${index + 1} 条成立条件`}
                    value={conditionText(condition)}
                    disabled={!editable}
                    placeholder="什么情况下这个论点才成立？"
                    onChange={(event) => {
                      const value = event.target.value;
                      apply((plan) =>
                        patchClaim(plan, claim.id, {
                          conditions: claim.conditions.map((item, i) =>
                            i === index ? withConditionText(item, value) : item,
                          ),
                        }),
                      );
                    }}
                  />
                  {editable ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`删除论点 ${claim.id} 的第 ${index + 1} 条成立条件`}
                      disabled={claim.conditions.length <= 1}
                      onClick={() =>
                        apply((plan) =>
                          patchClaim(plan, claim.id, {
                            conditions: claim.conditions.filter((_, i) => i !== index),
                          }),
                        )
                      }
                    >
                      <X />
                    </Button>
                  ) : null}
                </div>
              ))}
            </div>
            {editable ? (
              <div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-label={`为论点 ${claim.id} 添加成立条件`}
                  onClick={() =>
                    apply((plan) =>
                      patchClaim(plan, claim.id, { conditions: [...claim.conditions, ''] }),
                    )
                  }
                >
                  <Plus />
                  添加成立条件
                </Button>
              </div>
            ) : null}
          </div>

          <div className="flex flex-col gap-2">
            <Label>子问题</Label>
            {claim.sub_questions.map((sub) => (
              <div key={sub.id} className="flex flex-col gap-2 rounded-md border border-border/60 bg-muted/30 p-2">
                <div className={cn('flex flex-col gap-2', 'sm:flex-row sm:items-center')}>
                  <span className="font-mono text-xs text-muted-foreground sm:w-16 sm:shrink-0">
                    {sub.id}
                  </span>
                  <Input
                    aria-label={`子问题 ${sub.id} 的问法`}
                    className="flex-1"
                    value={sub.question}
                    disabled={!editable}
                    placeholder="这个子问题具体要找什么？"
                    onChange={(event) => {
                      const value = event.target.value;
                      apply((plan) => updateSubQuestion(plan, sub.id, { question: value }));
                    }}
                  />
                  <div
                    className="flex flex-wrap items-center gap-1"
                    role="group"
                    aria-label={`子问题 ${sub.id} 的查法`}
                  >
                    {RESEARCH_METHOD_LIST.map((method) => {
                      const selected = sub.methods.includes(method);
                      return (
                        <Button
                          key={method}
                          type="button"
                          size="xs"
                          variant={selected ? 'default' : 'outline'}
                          aria-pressed={selected}
                          aria-label={`${sub.id} 查法：${method}`}
                          disabled={!editable}
                          onClick={() =>
                            apply((plan) =>
                              updateSubQuestion(plan, sub.id, {
                                methods: toggleMethod(sub.methods, method),
                              }),
                            )
                          }
                        >
                          {method}
                        </Button>
                      );
                    })}
                  </div>
                  {editable ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`删除子问题 ${sub.id}`}
                      disabled={claim.sub_questions.length <= 1}
                      onClick={() => apply((plan) => removeSubQuestion(plan, claim.id, sub.id))}
                    >
                      <X />
                    </Button>
                  ) : null}
                </div>
                <PerspectivePicker
                  owner={`子问题 ${sub.id}`}
                  value={sub.perspective}
                  options={perspectives}
                  disabled={!editable}
                  onToggle={(p) => apply((plan) => updateSubQuestion(plan, sub.id, { perspective: togglePerspective(plan.claims.flatMap((c) => c.sub_questions).find((q) => q.id === sub.id)?.perspective, p) }))}
                />
              </div>
            ))}
            {editable ? (
              <div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-label={`为论点 ${claim.id} 添加子问题`}
                  onClick={() => apply((plan) => addSubQuestion(plan, claim.id))}
                >
                  <Plus />
                  添加子问题
                </Button>
              </div>
            ) : null}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`claim-counter-${claim.id}`}>怎么找反证</Label>
            <Textarea
              id={`claim-counter-${claim.id}`}
              rows={2}
              value={claim.counter_search}
              disabled={!editable}
              placeholder="去哪里找能推翻这个论点的证据？"
              onChange={(event) => {
                const value = event.target.value;
                apply((plan) => patchClaim(plan, claim.id, { counter_search: value }));
              }}
            />
          </div>
        </PlanContent>
      </Plan>
    ))}
  </div>

  {editable ? (
    <div>
      <Button type="button" variant="outline" size="sm" onClick={() => apply(addClaim)}>
        <Plus />
        添加论点
      </Button>
    </div>
  ) : null}
    </>
  );
}

const CONDITION_COLUMNS = [
  { field: 'text', title: '必须成立的条件', placeholder: '这个假设要成立，什么必须为真？' },
  { field: 'evidence_needed', title: '要什么证据', placeholder: '什么样的证据算数？' },
  { field: 'where', title: '去哪里查', placeholder: '哪类资料、哪里能找到？' },
] as const;

const conditionCell = (c: PlanCondition, field: (typeof CONDITION_COLUMNS)[number]['field']): string => (field === 'text' ? conditionText(c) : typeof c === 'string' ? '' : (c[field] ?? ''));

/** The perspectives of a split sub-question's parts, summed up (display only: perspectives are tagged on hypotheses). */
function nodePerspectives(plan: EditablePlan, claimIds: string[]): string[] {
  const claims = plan.claims.filter((c) => claimIds.includes(c.id));
  return [...new Set(claims.flatMap((c) => [...(c.perspective ?? []), ...c.sub_questions.flatMap((q) => q.perspective ?? [])]))];
}

/** A lowest-level sub-question and its hypothesis card: the hypothesis, its conditions as a three-column table, 要查的问题 (folded), how to find counter-evidence. */
function HypothesisCard({ draft, apply, editable, perspectives, leaf, nested }: ClaimsProps & { leaf: TreeLeaf; nested: boolean }): JSX.Element | null {
  const claim = draft.claims.find((c) => c.id === leaf.claimId);
  if (!claim) return null;
  const label = leaf.label;
  return (
    <Plan defaultOpen data-testid="plan-leaf" className={nested ? 'ml-4 sm:ml-6' : undefined}>
      <PlanHeader>
        <div className="flex min-w-0 flex-col gap-1">
          <PlanTitle>{`${leaf.qid} ${claim.question?.trim() || '（还没有写子问题）'}`}</PlanTitle>
          <PlanDescription className="line-clamp-2">{`假设 ${label}：${claimSummary(claim.statement)}`}</PlanDescription>
          {claim.perspective?.length ? <span className="text-xs text-muted-foreground">视角：{claim.perspective.join('、')}</span> : null}
        </div>
        <PlanAction className="flex items-center gap-1">
          <PlanTrigger />
          {editable && !nested ? (
            <Button type="button" variant="ghost" size="sm" aria-label={`把 ${leaf.qid} 往下拆`} onClick={() => apply((plan) => splitQuestion(plan, claim.id))}>
              <ListTree />
              往下拆
            </Button>
          ) : null}
          {editable ? (
            <Button type="button" variant="ghost" size="icon-sm" aria-label={`删除子问题 ${leaf.qid}`} disabled={draft.claims.length <= 1} onClick={() => apply((plan) => removeQuestion(plan, claim.id))}>
              <Trash2 />
            </Button>
          ) : null}
        </PlanAction>
      </PlanHeader>

      <PlanContent className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`leaf-question-${claim.id}`}>子问题 {leaf.qid}（问句）</Label>
          <Input id={`leaf-question-${claim.id}`} value={claim.question ?? ''} disabled={!editable} placeholder="写成一个问句" onChange={(event) => {
            const value = event.target.value;
            apply((plan) => updateClaimQuestion(plan, claim.id, value));
          }} />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`claim-statement-${claim.id}`}>假设 {label}</Label>
          <Textarea id={`claim-statement-${claim.id}`} rows={2} value={claim.statement} disabled={!editable} placeholder="对这个子问题的一句回答，可以被证实或证伪" onChange={(event) => {
            const value = event.target.value;
            apply((plan) => patchClaim(plan, claim.id, { statement: value }));
          }} />
          <PerspectivePicker
            owner={`假设 ${label}`}
            value={claim.perspective}
            options={perspectives}
            disabled={!editable}
            onToggle={(p) => apply((plan) => patchClaim(plan, claim.id, { perspective: togglePerspective(plan.claims.find((c) => c.id === claim.id)?.perspective, p) }))}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label>验证计划</Label>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[36rem] border-collapse text-sm" data-testid="plan-conditions">
              <thead>
                <tr className="text-left text-xs text-muted-foreground">
                  {CONDITION_COLUMNS.map((col) => (
                    <th key={col.field} className="border-b border-border px-1 py-1 font-medium">{col.title}</th>
                  ))}
                  {editable ? <th className="w-8 border-b border-border" aria-label="操作" /> : null}
                </tr>
              </thead>
              <tbody>
                {claim.conditions.map((condition, index) => (
                  <tr key={`${claim.id}-condition-${index}`} className="align-top">
                    {CONDITION_COLUMNS.map((col) => (
                      <td key={col.field} className="px-1 py-1">
                        <Textarea
                          rows={2}
                          aria-label={`假设 ${label} 的第 ${index + 1} 条条件：${col.title}`}
                          value={conditionCell(condition, col.field)}
                          disabled={!editable}
                          placeholder={col.placeholder}
                          className="min-h-0"
                          onChange={(event) => {
                            const value = event.target.value;
                            apply((plan) => patchClaim(plan, claim.id, { conditions: (plan.claims.find((c) => c.id === claim.id)?.conditions ?? []).map((item, i) => (i === index ? updateCondition(item, col.field, value) : item)) }));
                          }}
                        />
                      </td>
                    ))}
                    {editable ? (
                      <td className="px-1 py-1">
                        <Button type="button" variant="ghost" size="icon-sm" aria-label={`删除假设 ${label} 的第 ${index + 1} 条条件`} disabled={claim.conditions.length <= 1} onClick={() => apply((plan) => patchClaim(plan, claim.id, { conditions: claim.conditions.filter((_, i) => i !== index) }))}>
                          <X />
                        </Button>
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {editable ? (
            <div>
              <Button type="button" variant="ghost" size="sm" aria-label={`为假设 ${label} 添加条件`} onClick={() => apply((plan) => patchClaim(plan, claim.id, { conditions: [...claim.conditions, emptyCondition()] }))}>
                <Plus />
                添加条件
              </Button>
            </div>
          ) : null}
        </div>

        <details className="group rounded-md border border-border/60" data-testid="plan-sub-questions">
          <summary className="cursor-pointer px-2 py-1.5 text-sm text-muted-foreground">要查的问题 {claim.sub_questions.length} 条（检索时具体查的问句）</summary>
          <div className="flex flex-col gap-2 p-2">
            {claim.sub_questions.map((sub) => {
              const sl = subQuestionLabel(draft, claim.id, sub.id);
              return (
                <div key={sub.id} className="flex flex-col gap-2 rounded-md border border-border/60 bg-muted/30 p-2">
                  <div className={cn('flex flex-col gap-2', 'sm:flex-row sm:items-center')}>
                    <span className="font-mono text-xs text-muted-foreground sm:w-16 sm:shrink-0">{sl}</span>
                    <Input aria-label={`要查的问题 ${sl} 的问法`} className="flex-1" value={sub.question} disabled={!editable} placeholder="具体要查什么？" onChange={(event) => {
                      const value = event.target.value;
                      apply((plan) => updateSubQuestion(plan, sub.id, { question: value }));
                    }} />
                    <div className="flex flex-wrap items-center gap-1" role="group" aria-label={`要查的问题 ${sl} 的查法`}>
                      {RESEARCH_METHOD_LIST.map((method) => {
                        const selected = sub.methods.includes(method);
                        return (
                          <Button key={method} type="button" size="xs" variant={selected ? 'default' : 'outline'} aria-pressed={selected} aria-label={`${sl} 查法：${method}`} disabled={!editable} onClick={() => apply((plan) => updateSubQuestion(plan, sub.id, { methods: toggleMethod(sub.methods, method) }))}>
                            {method}
                          </Button>
                        );
                      })}
                    </div>
                    {editable ? (
                      <Button type="button" variant="ghost" size="icon-sm" aria-label={`删除要查的问题 ${sl}`} disabled={claim.sub_questions.length <= 1} onClick={() => apply((plan) => removeSubQuestion(plan, claim.id, sub.id))}>
                        <X />
                      </Button>
                    ) : null}
                  </div>
                  <PerspectivePicker
                    owner={`要查的问题 ${sl}`}
                    value={sub.perspective}
                    options={perspectives}
                    disabled={!editable}
                    onToggle={(p) => apply((plan) => updateSubQuestion(plan, sub.id, { perspective: togglePerspective(plan.claims.flatMap((c) => c.sub_questions).find((q) => q.id === sub.id)?.perspective, p) }))}
                  />
                </div>
              );
            })}
            {editable ? (
              <div>
                <Button type="button" variant="ghost" size="sm" aria-label={`为假设 ${label} 添加要查的问题`} onClick={() => apply((plan) => addSubQuestion(plan, claim.id))}>
                  <Plus />
                  添加要查的问题
                </Button>
              </div>
            ) : null}
          </div>
        </details>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`claim-counter-${claim.id}`}>怎么找反证</Label>
          <Textarea id={`claim-counter-${claim.id}`} rows={2} value={claim.counter_search} disabled={!editable} placeholder="去哪里找能推翻这个假设的证据？" onChange={(event) => {
            const value = event.target.value;
            apply((plan) => patchClaim(plan, claim.id, { counter_search: value }));
          }} />
        </div>
      </PlanContent>
    </Plan>
  );
}

/**
 * A question-tree plan (D-39): grouped by top-level sub-question; a split one shows its question (editable), the
 * perspectives of its parts summed up, and its parts indented; every lowest-level sub-question carries its hypothesis
 * card. Below the tree: the AI's MECE check.
 */
function TreeClaims(props: ClaimsProps): JSX.Element {
  const { draft, apply, editable } = props;
  const tree = editorTree(draft);
  return (
    <>
      <div className="flex flex-col gap-3" data-testid="plan-tree">
        {tree.roots.map((root) =>
          root.leaf ? (
            <HypothesisCard key={root.leaf.claimId} {...props} leaf={root.leaf} nested={false} />
          ) : (
            <section key={root.node ?? root.qid} data-testid="plan-tree-node" className="flex flex-col gap-2 rounded-lg border border-border p-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-sm font-medium">{root.qid}</span>
                <Input
                  aria-label={`子问题 ${root.qid} 的问句`}
                  className="min-w-0 flex-1"
                  value={draft.question_tree?.find((n) => n.id === root.node)?.question ?? ''}
                  disabled={!editable}
                  placeholder="写成一个问句"
                  onChange={(event) => {
                    const value = event.target.value;
                    apply((plan) => updateTreeNode(plan, root.node ?? '', value));
                  }}
                />
                {editable ? (
                  <Button type="button" variant="ghost" size="icon-sm" aria-label={`删除子问题 ${root.qid}（连同下一级）`} disabled={draft.claims.every((c) => c.parent === root.node)} onClick={() => apply((plan) => removeTreeNode(plan, root.node ?? ''))}>
                    <Trash2 />
                  </Button>
                ) : null}
              </div>
              <p className="text-xs text-muted-foreground">
                拆成：{root.children.map((c) => c.qid).join('、')}
                {(() => {
                  const ps = nodePerspectives(draft, root.children.map((c) => c.claimId));
                  return ps.length ? <span data-testid="plan-node-perspectives">　视角：{ps.join('、')}</span> : null;
                })()}
              </p>
              {root.children.map((leaf) => (
                <HypothesisCard key={leaf.claimId} {...props} leaf={leaf} nested />
              ))}
              {editable ? (
                <div className="ml-4 sm:ml-6">
                  <Button type="button" variant="ghost" size="sm" aria-label={`在 ${root.qid} 下面添加子问题`} onClick={() => apply((plan) => addChildQuestion(plan, root.node ?? ''))}>
                    <Plus />
                    添加下一级子问题
                  </Button>
                </div>
              ) : null}
            </section>
          ),
        )}
      </div>
      {editable ? (
        <div>
          <Button type="button" variant="outline" size="sm" onClick={() => apply(addTopQuestion)}>
            <Plus />
            添加子问题
          </Button>
        </div>
      ) : null}
      <div className="flex flex-col gap-1.5" data-testid="plan-mece-check">
        <Label htmlFor="plan-mece-check">MECE 和充分必要的自检（AI 提议）</Label>
        <p className="text-xs text-muted-foreground">子问题为什么不重叠、合起来为什么没有漏，为什么都答了就足以回答核心问题、少了哪一个就答不了。批准之前读一遍。</p>
        <Textarea id="plan-mece-check" rows={6} value={draft.mece_check ?? ''} disabled={!editable} placeholder="还没有写 MECE 自检" onChange={(event) => {
          const value = event.target.value;
          apply((plan) => ({ ...plan, mece_check: value }));
        }} />
      </div>
    </>
  );
}

export function PlanEditor(props: PlanEditorProps): JSX.Element {
  const { canEdit, onSave, onApprove } = props;

  const [draft, setDraft] = useState<EditablePlan>(props.plan);
  const [baseline, setBaseline] = useState<EditablePlan>(props.plan);
  const [displayName, setDisplayName] = useState(props.planName);
  /** `null` = follow the prop; set once the user forks an approved version. */
  const [approvedOverride, setApprovedOverride] = useState<boolean | null>(null);
  const [notice, setNotice] = useState<string | null>(props.savedNotice ?? null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [approving, setApproving] = useState(false);
  const [approveOpen, setApproveOpen] = useState(false);
  /**
   * A save makes a new version and the page refreshes: the editor of the new version replaces this one (key = path), and a
   * dialog opened in between would go away with it. Until that happens (or 10 s, if the refresh never comes) approving waits.
   */
  const [awaitingNewVersion, setAwaitingNewVersion] = useState(false);
  /** 试水调查 is the default; the choice is made in the approve dialog and goes with the approval. */
  const [runMode, setRunMode] = useState<ResearchMode>('small');

  const approved = approvedOverride ?? props.approved;
  const editable = canEdit && !approved;
  const dirty = !planEquals(draft, baseline);
  /** D-39: the format is the loaded plan's (an older-format plan stays one; a tree stays a tree while its questions are retyped). */
  const [tree] = useState(() => isTreePlan(props.plan));
  const errors = useMemo(() => validatePlan(draft, tree), [draft, tree]);
  /** The question tree's checks: a draft may be saved with them, not approved (the approve route asks the same). */
  const treeProblems = useMemo(() => (tree ? treeChecks(draft).map((t) => t.message) : []), [draft, tree]);
  const valid = errors.length === 0;

  const apply = (updater: (plan: EditablePlan) => EditablePlan) => {
    setDraft((prev) => updater(prev));
    setNotice(null);
    setError(null);
  };

  const handleSave = async () => {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      const result = await onSave(draft);
      if (result.ok) {
        setBaseline(draft);
        setDisplayName(result.name);
        setNotice(`已保存为 ${result.name}`);
        setAwaitingNewVersion(true);
        setTimeout(() => setAwaitingNewVersion(false), 10_000);
      } else {
        setError(result.error);
      }
    } catch {
      setError('保存失败，请重试');
    } finally {
      setSaving(false);
    }
  };

  const handleApprove = async () => {
    if (approving) return;
    setApproving(true);
    setError(null);
    try {
      const result = await onApprove(runMode);
      if (result.ok) {
        setBaseline(draft);
        setNotice(null);
        setApprovedOverride(true);
      } else {
        setError(result.error);
      }
    } catch {
      setError('批准失败，请重试');
    } finally {
      setApproving(false);
    }
  };

  const canSave = editable && dirty && valid && !saving;
  const perspectives = useMemo(() => props.perspectives ?? [], [props.perspectives]);
  const gaps = useMemo(() => perspectiveGaps(draft, perspectives), [draft, perspectives]);
  const canApprove = editable && !dirty && valid && treeProblems.length === 0 && !approving && !awaitingNewVersion;
  /** 试水调查只查问题树里的第一个假设：弹框里写出它的编号。 */
  const firstHypothesis = draft.claims.length ? hypothesisLabel(draft, treeOrder(draft)[0] ?? draft.claims[0].id) : 'H1';
  /** Why "批准并开始调查" cannot be clicked, each reason on its own line (D-39). */
  const blockers = [...(dirty ? ['有未保存的修改：先保存为新版本，再批准'] : []), ...(valid ? [] : ['上面的内容还没填完整']), ...treeProblems];

  return (
    <div className="flex flex-col gap-4">
      {/* 动作条在计划最上面：版本、状态、保存、批准都在这一行，批准不了的原因写在下面（UI/UX 方案 #5） */}
      <div className="sticky top-0 z-10 -mx-1 flex flex-col gap-2 border-b border-border bg-background/95 px-1 py-2 backdrop-blur" data-testid="plan-action-bar">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-base font-medium text-foreground">{displayName}</h2>
          <Badge variant={approved ? 'default' : 'secondary'}>{approved ? '已批准' : '草稿'}</Badge>
          {dirty ? (
            <Badge variant="outline" className="text-muted-foreground">
              有未保存的修改
            </Badge>
          ) : null}
          {approved && canEdit ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="ml-auto"
              onClick={() => {
                setApprovedOverride(false);
                setNotice(null);
                setError(null);
              }}
            >
              基于此版本修改
            </Button>
          ) : null}
          {editable ? (
            <div className="ml-auto flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={!canSave}
                onClick={() => {
                  void handleSave();
                }}
              >
                <Save />
                {saving ? '保存中…' : '保存为新版本'}
              </Button>
              <Button type="button" data-testid="start-run" disabled={!canApprove} onClick={() => setApproveOpen(true)}>
                <ShieldCheck />
                {approving ? '批准中…' : '计划定了，开始调查 →'}
              </Button>
            </div>
          ) : null}
        </div>
        {errors.length || error || notice || (editable && tree && blockers.length) ? (
          <div className="flex flex-col gap-1 text-sm">
            {errors.map((message) => (
              <p key={message} className="text-destructive">
                {message}
              </p>
            ))}
            {error ? <p className="text-destructive">{error}</p> : null}
            {notice ? <p className="text-muted-foreground">{notice}</p> : null}
            {editable && tree && blockers.length ? (
              <div data-testid="approve-blockers" className="text-xs text-amber-800 dark:text-amber-300">
                <p className="font-medium">现在还不能批准：</p>
                <ul className="list-disc pl-5">
                  {blockers.map((b) => (
                    <li key={b}>{b}</li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      {approved ? (
        <p className="text-sm text-muted-foreground">
          已批准的计划不能修改；要改请另存为新版本。
        </p>
      ) : null}
      {!canEdit ? (
        <ReadOnlyNotice
          cannot={`只读：这份调查计划（${displayName}）你不能修改，也不能批准。`}
          who={`${props.ownerName ?? 'Workspace 的负责人'}（负责人）才能修改、批准计划并开始调查。`}
          can={`看计划的每一个问题和假设；意见留在审批页里，由 ${props.ownerName ?? '负责人'} 决定改不改。`}
          where={props.ownerName ? <WindowLink roleName={props.ownerName} /> : '负责人的窗口'}
        />
      ) : null}

      {gaps.length ? (
        <div
          data-testid="plan-perspective-gaps"
          role="status"
          className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200"
        >
          <p className="font-medium">漏了：{gaps.join('、')}</p>
          <p className="mt-0.5 text-xs">
            团队要求每份计划覆盖这几个视角：{perspectives.join('、')}。给{tree ? '假设' : '论点'}标上漏掉的视角，或者在计划里写一句这次为什么不查。这只是提醒，不影响批准。
          </p>
        </div>
      ) : null}
      {draft.perspectives_skipped?.length ? (
        <p className="text-xs text-muted-foreground" data-testid="plan-perspectives-skipped">
          这次不查的视角：{draft.perspectives_skipped.map((x) => `${x.perspective}（${x.reason}）`).join('；')}
        </p>
      ) : null}

      <InvestigationPlanView plan={draft} />

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="plan-question">{tree ? '核心问题' : '调查问题'}</Label>
        <Textarea
          id="plan-question"
          rows={2}
          value={draft.question}
          disabled={!editable}
          placeholder="这次要回答什么问题？"
          onChange={(event) => {
            const value = event.target.value;
            apply((plan) => ({ ...plan, question: value }));
          }}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="plan-purpose">调查目的</Label>
        <Textarea
          id="plan-purpose"
          rows={2}
          value={draft.purpose}
          disabled={!editable}
          placeholder="查清楚之后要拿它做什么决定？"
          onChange={(event) => {
            const value = event.target.value;
            apply((plan) => ({ ...plan, purpose: value }));
          }}
        />
      </div>

      {tree ? <TreeClaims draft={draft} apply={apply} editable={editable} perspectives={perspectives} /> : <LegacyClaims draft={draft} apply={apply} editable={editable} perspectives={perspectives} />}

      <RunDialog
        open={approveOpen}
        onOpenChange={setApproveOpen}
        title={`批准 ${displayName}，并开始调查？`}
        description="批准就是开始：点了确认，调查马上开跑，不会再问第二次。"
        mode={runMode}
        onModeChange={setRunMode}
        firstHypothesis={firstHypothesis}
        happensTitle="批准后会发生："
        happens={(usual) => [
          `${displayName} 被锁定，不能再改（要改就另存为新版本）。`,
          '系统放开联网搜索和读网页（批准前 AI 拿不到）。',
          `调查立即开始（${usual}），页面停在“执行”，每一步都看得到；你可以走开，关掉页面也不会停。`,
          '跑完生成报告，旧报告保留，可以切版本对照。',
        ]}
        confirmLabel={(name) => `确认批准，开始${name}`}
        busy={approving}
        onConfirm={() => {
          void handleApprove();
        }}
      />
    </div>
  );
}
