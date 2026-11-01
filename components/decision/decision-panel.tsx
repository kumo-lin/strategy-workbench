'use client';

/**
 * 报告页上 Senior 专用的"起草决定"和决定卡片 (PRD §6.4, dev plan 3.2d). Rendered only for a Senior
 * on a delivered report. "起草决定" asks the AI (POST /api/decision/draft); the card shows the draft
 * as 推断, the Senior edits the text and confirms (POST /api/decision/confirm → `decision.confirm`).
 * There is no button that sends a conclusion for review (D-11).
 */
import { CheckCircle2, Loader2, Sparkles } from 'lucide-react';
import { useState, type JSX } from 'react';
import {
  Confirmation,
  ConfirmationAccepted,
  ConfirmationAction,
  ConfirmationActions,
  ConfirmationRequest,
  ConfirmationTitle,
} from '@/components/ai-elements/confirmation';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/ui/status-badge';
import { Textarea } from '@/components/ui/textarea';
import { Markdown } from '@/components/workspace/markdown';
import { decisionFields, type DecisionFields } from '@/lib/decisions/fields';
import {
  cancelEdit,
  cardFromResponse,
  cardKey,
  hasUpdate,
  initialState,
  isDirty,
  loadLatest,
  receiveServer,
  setEditField,
  storeCard,
  type DecisionCard as DecisionCardData,
  type EditState,
} from './decision-state';
import { citationsOf, displayWikiLinks, fromFieldText, toFieldText } from './format';

export type { DecisionCardData };

export interface DecisionPanelProps {
  workspacePath: string;
  researchDir: string;
  reportPath: string;
  decisions: DecisionCardData[];
  /** The Workspaces that run next to this one on the same branch of the issue tree, e.g. ["WS-B 用户（Junior B）"]. */
  nextUsers?: string[];
  /** D-64 T41: the open 结论 review of this report: 确认 also passes it, 退回 sends the report back with the reason. */
  reviewPath?: string | null;
}

const FIELD_LABELS: [keyof DecisionFields, string][] = [
  ['decision', '决定'],
  ['reason', '理由'],
  ['scope', '适用边界'],
];

async function post(url: string, body: unknown): Promise<{ ok: true; json: Record<string, unknown> } | { ok: false; error: string }> {
  try {
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) return { ok: false, error: String(json.message ?? json.error ?? `HTTP ${res.status}`) };
    return { ok: true, json };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

interface DecisionCardProps {
  d: DecisionCardData;
  /** Who works next on what this decision binds, e.g. "WS-B 用户（Junior B）"; empty when nobody does. */
  nextUsers: string;
  /** Editing state, owned by the panel (by path), so a server render can never reset it. */
  edit: EditState | undefined;
  onEdit: {
    /** D-64 T41: the Senior changed one of the three fields (the edit starts on the first change). */
    field: (key: keyof DecisionFields, value: string) => void;
    loadLatest: () => void;
  };
  /** A route returned this card; also ends the edit. */
  onStored: (card: DecisionCardData) => void;
  reviewPath: string | null;
}

function DecisionCard({ d, nextUsers, edit, onEdit, onStored, reviewPath }: DecisionCardProps): JSX.Element {
  const [busy, setBusy] = useState<'save' | 'confirm' | 'return' | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** 退回: the reason box is open; null = closed. */
  const [returnReason, setReturnReason] = useState<string | null>(null);
  // Long content is folded by default so two drafts fit on one screen; display only, the note is untouched.
  const [open, setOpen] = useState(false);
  const confirmed = d.status === '已确认';
  const editing = Boolean(edit?.editing) && !confirmed;
  const dirty = isDirty(edit);
  const updated = hasUpdate(edit, d);
  const fields = (edit?.editing && edit.fields) || decisionFields(d.body);

  const save = async () => {
    if (!edit) return;
    setBusy('save');
    setError(null);
    const r = await post('/api/decision/confirm', { decision: d.path, action: 'save', fields });
    setBusy(null);
    if (!r.ok) return setError(r.error);
    const card = cardFromResponse(r.json);
    if (card) onStored(card);
  };
  const confirm = async () => {
    setBusy('confirm');
    setError(null);
    const r = await post('/api/decision/confirm', { decision: d.path, action: 'confirm', ...(dirty ? { fields } : {}) });
    if (!r.ok) {
      setBusy(null);
      // A 409 repeats the problems the card already lists; show it only when it says something new.
      return setError(d.problems.length && !dirty && r.error.startsWith('这条决定还不能确认') ? null : r.error);
    }
    // 存入项目文件: the report's 结论 review passes with it
    const passed = reviewPath ? await post('/api/workspace/review/decision', { reviewPath, decision: 'approve' }) : null;
    setBusy(null);
    if (passed && !passed.ok) setError(`决定已确认；报告的确认没有成功：${passed.error}`);
    const card = cardFromResponse(r.json);
    if (card) onStored(card);
  };
  const sendBack = async () => {
    const reason = returnReason?.trim();
    if (!reason) return setError('退回要写明理由');
    setBusy('return');
    setError(null);
    const r = await post('/api/decision/confirm', { decision: d.path, action: 'return', reason });
    if (!r.ok) {
      setBusy(null);
      return setError(r.error);
    }
    // the report goes back to its author with the same reason (an open review is sent back only with a comment)
    if (reviewPath) {
      const said = await post('/api/workspace/review/comment', { reviewPath, text: reason });
      const back = said.ok ? await post('/api/workspace/review/decision', { reviewPath, decision: 'reject' }) : said;
      if (!back.ok) setError(`决定已退回；报告没有退回成功：${back.error}`);
    }
    setBusy(null);
    setReturnReason(null);
    const card = cardFromResponse(r.json);
    if (card) onStored(card);
  };

  return (
    <article className="min-w-0 space-y-3 rounded-lg border p-3" data-testid="decision-card" data-status={d.status} data-model={d.draftedByModel ?? ''}>
      <header className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold">{d.name}</h3>
        <StatusBadge status={d.status as never} />
        {confirmed && d.decidedBy && <span className="text-muted-foreground text-xs">{d.decidedBy} 确认</span>}
        {d.draftedByModel && (
          <span className="text-muted-foreground text-xs" data-testid="decision-drafted-by" title={d.draftedByModel}>
            起草模型：{d.draftedByModel.replace(/（[^（）]*）$/, '')}
          </span>
        )}
      </header>

      {editing && updated && (
        <div role="status" className="flex flex-wrap items-center gap-2 rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300" data-testid="decision-updated">
          <span>这条决定在你编辑的时候有了更新。编辑框里仍是你的文字；确认会以它为准。</span>
          <Button type="button" size="sm" variant="outline" onClick={onEdit.loadLatest} data-testid="decision-load-latest">
            载入最新版本（放弃我的修改）
          </Button>
        </div>
      )}

      {!confirmed && d.status === '推断' ? (
        <div className="space-y-2">
          <p className="text-muted-foreground text-xs">可以直接改</p>
          {FIELD_LABELS.map(([key, label]) => {
            const shown = toFieldText(fields[key], d.body);
            // 复核 P5: the sources of the marks in this field, named once under it (the quote on hover)
            const cites = citationsOf(d.body).filter((c) => shown.includes(`〔${c.n}〕`));
            return (
              <label key={key} className="block space-y-1">
                <span className="text-xs font-medium">{label}</span>
                <Textarea value={shown} onChange={(e) => onEdit.field(key, fromFieldText(e.target.value, d.body))} className={key === 'reason' ? 'max-h-40 text-sm' : 'max-h-20 text-sm'} data-testid="decision-field" data-field={key} />
                {cites.length ? (
                  <ul className="text-muted-foreground space-y-0.5 text-xs" data-testid="decision-citations">
                    {cites.map((c) => (
                      <li key={c.n} title={c.quote ?? undefined}>
                        〔{c.n}〕{c.name}
                        {c.grade ? `（${c.grade}）` : ''}
                      </li>
                    ))}
                    <li>〔n〕是报告引用过的原文，改文字时请保留；每条理由至少要留一个，否则不能确认。</li>
                  </ul>
                ) : null}
              </label>
            );
          })}
        </div>
      ) : (
        <div>
          <div className={open ? 'text-sm' : 'relative max-h-60 overflow-hidden text-sm'} data-testid="decision-body" data-collapsed={!open}>
            <Markdown source={displayWikiLinks(d.body.replace(/^\s*# .*\n+/, ''))} />
            {!open && <div className="from-background pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t to-transparent" aria-hidden />}
          </div>
          <Button type="button" size="sm" variant="ghost" className="mt-1 h-7 px-2 text-xs" aria-expanded={open} onClick={() => setOpen(!open)} data-testid="decision-expand">
            {open ? '收起' : '展开全文'}
          </Button>
        </div>
      )}

      {d.problems.length > 0 && !confirmed && (
        <div role="alert" className="border-destructive/40 bg-destructive/5 text-destructive rounded-md border p-2 text-xs" data-testid="decision-problems">
          <p className="font-medium">这条决定还不能确认：</p>
          <ul className="list-disc pl-4">{d.problems.map((p) => <li key={p}>{displayWikiLinks(p)}</li>)}</ul>
        </div>
      )}
      {error && <p className="text-destructive text-xs" role="alert" data-testid="decision-error">{error}</p>}

      {confirmed ? (
        <Confirmation approval={{ id: d.path, approved: true }} state="approval-responded">
          <ConfirmationAccepted>
            <p className="flex items-center gap-2 text-sm text-emerald-700 dark:text-emerald-300">
              <CheckCircle2 className="size-4" aria-hidden />
              已确认，写进了 决策/：之后关联到它的调查会按它走。
            </p>
            <p className="text-muted-foreground mt-1 text-xs" data-testid="decision-where-next">
              {nextUsers ? `${nextUsers}的下一次调查会检索到它，并用进推导。` : '团队里其他 Workspace 的下一次调查会检索到它，并用进推导。'}
            </p>
          </ConfirmationAccepted>
        </Confirmation>
      ) : (
        <Confirmation approval={{ id: d.path }} state="approval-requested">
          <ConfirmationTitle>AI 起草 · 待你确认</ConfirmationTitle>
          <ConfirmationRequest>
            {returnReason !== null && (
              <Textarea value={returnReason} onChange={(e) => setReturnReason(e.target.value)} rows={3} aria-label="退回的理由" placeholder="写明为什么退回、要怎么改" className="mb-2 text-sm" data-testid="return-reason" />
            )}
            <ConfirmationActions>
              <ConfirmationAction variant="outline" disabled={busy !== null} onClick={() => (returnReason === null ? setReturnReason('') : void sendBack())} data-testid="return-report">
                {busy === 'return' ? '退回中…' : returnReason === null ? '退回，写明理由' : '确认退回'}
              </ConfirmationAction>
              {dirty && (
                <ConfirmationAction variant="outline" disabled={busy !== null} onClick={() => void save()} data-testid="decision-save">
                  {busy === 'save' ? '保存中…' : '保存修改'}
                </ConfirmationAction>
              )}
              <ConfirmationAction disabled={busy !== null} onClick={() => void confirm()} data-testid="confirm-store">
                {busy === 'confirm' ? '确认中…' : '确认，存入项目文件'}
              </ConfirmationAction>
            </ConfirmationActions>
            <p className="text-muted-foreground mt-2 text-xs" data-testid="decision-confirm-effect">
              确认后：写进 决策/，状态变成“已确认”；之后团队里的调查{nextUsers ? `（比如 ${nextUsers}）` : ''}都会检索到它。
            </p>
          </ConfirmationRequest>
        </Confirmation>
      )}
    </article>
  );
}

export function DecisionPanel({ workspacePath, researchDir, reportPath, decisions, nextUsers = [], reviewPath = null }: DecisionPanelProps): JSX.Element {
  // The panel's own list: route responses go straight in; a later server render is merged, never awaited.
  const [state, setState] = useState(() => initialState(decisions));
  const [rendered, setRendered] = useState(decisions);
  if (rendered !== decisions) {
    // a newer server render (React's "adjust state when a prop changes", not an effect)
    setRendered(decisions);
    setState(receiveServer(state, decisions));
  }
  const cards = state.cards;
  const [drafting, setDrafting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // a route returned this card (save, confirm, draft): it replaces the card and ends the edit on it
  const store = (card: DecisionCardData) => setState((s) => storeCard(cancelEdit(s, card.path), card));

  const draft = async () => {
    setDrafting(true);
    setError(null);
    const r = await post('/api/decision/draft', { workspacePath, researchDir, reportPath });
    setDrafting(false);
    if (!r.ok) return setError(r.error);
    const card = cardFromResponse(r.json);
    if (card) store(card);
    else setError('起草完成，但返回里没有决定的内容：刷新页面查看');
  };

  // Two or more drafts of the same report (typically from different models) sit next to each other; each card acts on its own.
  const sideBySide = cards.filter((c) => c.status === '推断').length >= 2;

  return (
    <section className="@container space-y-3" aria-label="决定 + 理由" data-testid="decision-panel">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-semibold">决定 + 理由</h2>
        <Button type="button" size="sm" variant="outline" disabled={drafting} onClick={() => void draft()} data-testid="decision-draft">
          {drafting ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Sparkles className="size-3.5" aria-hidden />}
          {drafting ? 'AI 起草中…' : cards.length ? '重新起草决定' : '起草决定'}
        </Button>
        <span className="text-muted-foreground text-xs">只有 Senior 看得到。AI 根据这份报告起草，每条理由都带报告引用过的证据。</span>
      </div>
      {error && <p className="text-destructive text-xs" role="alert" data-testid="decision-draft-error">{error}</p>}
      <div className={sideBySide ? 'grid items-start gap-3 @xl:grid-cols-2' : 'space-y-3'} data-testid="decision-cards" data-layout={sideBySide ? 'side-by-side' : 'stacked'}>
      {cards.map((d) => (
        <DecisionCard
          key={cardKey(d)}
          d={d}
          nextUsers={nextUsers.join('、')}
          edit={state.edits[d.path]}
          onEdit={{
            field: (key, value) => setState((s) => setEditField(s, d.path, key, value)),
            loadLatest: () => setState((s) => loadLatest(s, d.path)),
          }}
          onStored={store}
          reviewPath={reviewPath}
        />
      ))}
      </div>
    </section>
  );
}
