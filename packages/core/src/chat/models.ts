import {
  findSupportedChatModel,
  modelSupportsEffort,
  type EffortLevel,
  type ProviderCredentials,
} from '@codeyantram/shared';
import {ChatError} from './errors.js';
import {providerModelResolvers, type ResolvedChatModel} from '../providers/index.js';

export type {ResolvedChatModel} from '../providers/index.js';

export type {ProviderCredentials} from '@codeyantram/shared';

export interface ResolveChatModelOptions {
  modelId: string;
  effort?: EffortLevel;
  credentials: ProviderCredentials;
  fetch?: typeof globalThis.fetch;
}

/** Resolves only catalog models, using credentials explicitly supplied by the caller. */
export function resolveChatModel(options: ResolveChatModelOptions): ResolvedChatModel {
  const definition = findSupportedChatModel(options.modelId);
  if (!definition) throw new ChatError('invalid_request', 'This model is not supported.');
  const {effort} = options;
  if (effort !== undefined && !modelSupportsEffort(definition, effort)) {
    throw new ChatError('invalid_request', 'This model does not support the requested effort level.');
  }

  const apiKey = options.credentials[definition.provider]?.trim();
  if (!apiKey) {
    throw new ChatError('missing_credentials', `No API key is configured for ${definition.provider}.`);
  }
  return providerModelResolvers[definition.provider]({
    modelId: definition.id,
    effort,
    apiKey,
    fetch: options.fetch,
  });
}
