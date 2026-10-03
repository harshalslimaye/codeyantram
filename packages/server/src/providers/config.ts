import type {ProviderCredentials} from '@codeyantram/core';
import {findSupportedChatModel, readConfig} from '@codeyantram/shared';

function asObject(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

/** Reads only the selected model's provider key saved by the CLI. */
export async function readProviderCredentials(
  modelId: string,
  readConfiguration: typeof readConfig = readConfig,
): Promise<ProviderCredentials> {
  const model = findSupportedChatModel(modelId);
  if (!model) return {};

  const config = await readConfiguration();
  const providers = asObject(config.providers);
  const {apiKey} = asObject(providers[model.provider]);
  if (typeof apiKey !== 'string' || !apiKey.trim()) return {};

  return {[model.provider]: apiKey.trim()};
}
