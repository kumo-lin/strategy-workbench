import type { LanguageModel } from 'ai';
import { getModel, type ResolvedModel } from '@/lib/models/provider';
import type { Vault } from '@/lib/vault';

export interface RunModels {
  model: LanguageModel;
  judgmentModel: LanguageModel;
  modelInfo: { providerId: string; label: string; model: string };
  judgmentInfo: { providerId: string; label: string; model: string } | null;
}

const infoOf = (resolved: ResolvedModel) => ({ providerId: resolved.providerId, label: resolved.provider.label, model: resolved.provider.model });

export async function resolveRunModels(
  vault: Vault,
  injected?: { model?: LanguageModel; modelInfo?: { providerId: string; label: string; model: string } },
): Promise<RunModels> {
  if (injected?.model) {
    return {
      model: injected.model,
      judgmentModel: injected.model,
      modelInfo: injected.modelInfo ?? { providerId: 'custom', label: 'custom', model: 'custom' },
      judgmentInfo: null,
    };
  }
  const execution = await getModel({ vault, role: 'execution' });
  const judgment = await getModel({ vault, role: 'judgment' });
  const same = execution.providerId === judgment.providerId;
  return {
    model: execution.model,
    judgmentModel: same ? execution.model : judgment.model,
    modelInfo: infoOf(execution),
    judgmentInfo: same ? null : infoOf(judgment),
  };
}
