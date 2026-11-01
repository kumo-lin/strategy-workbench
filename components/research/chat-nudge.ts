/**
 * The research grill gets the same safety net as the workspace chat (M1, 5.0 finding 3.1): a model that ends
 * a turn with its question in the text instead of an ask_user card is asked, once per message, to resend it
 * as a card. Pure, so the decision is testable without React; ChatPanel calls it from an effect.
 */
import { unaskedQuestionMessageId } from '@/components/chat/chat-state';

type Status = 'submitted' | 'streaming' | 'ready' | 'error';
type Messages = Parameters<typeof unaskedQuestionMessageId>[0];

/**
 * Right after a turn finishes (busy → not busy; never for history loaded from storage), the id of the
 * message to nudge about, or null. Records the id in `nudged` so a message is nudged at most once.
 */
export function messageToNudge(state: { wasBusy: boolean; status: Status; messages: Messages; nudged: Set<string> }): string | null {
  const busyNow = state.status === 'submitted' || state.status === 'streaming';
  if (!state.wasBusy || busyNow || state.status === 'error') return null;
  const id = unaskedQuestionMessageId(state.messages);
  if (!id || state.nudged.has(id)) return null;
  state.nudged.add(id);
  return id;
}
