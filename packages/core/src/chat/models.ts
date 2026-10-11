import {
  findSupportedChatModel,
  isOpenAIModelSlug,
  modelSupportsEffort,
  type EffortLevel,
  type ProviderCredentials,
} from '@codeyantram/shared';
import {ChatError} from './errors.js';
import {providerModelResolvers, type ResolvedChatModel} from '../providers/index.js';
import {createChatGPTModel} from '@codeyantram/ai-sdk-provider-chatgpt';

export type {ResolvedChatModel} from '../providers/index.js';

export type {ProviderCredentials} from '@codeyantram/shared';

export interface ResolveChatModelOptions {
  modelId: string;
  effort?: EffortLevel;
  credentials: ProviderCredentials;
  fetch?: typeof globalThis.fetch;
  chatgpt?: {profileId: string; supportedEffortLevels?: string[];
    getAccessToken: (profileId: string, signal?: AbortSignal) => Promise<string>};
}

/** Resolves built-in models or a server-validated ChatGPT account model. */
// oxlint-disable-next-line eslint/complexity -- ChatGPT and API-key models share IDs but resolve through different credentials.
export function resolveChatModel(options: ResolveChatModelOptions): ResolvedChatModel {
  const definition = findSupportedChatModel(options.modelId);
  const chatgpt = options.chatgpt;
  if (chatgpt !== undefined && (definition?.provider === 'openai' || (definition === undefined && isOpenAIModelSlug(options.modelId)))) {
    if (options.effort !== undefined && chatgpt.supportedEffortLevels?.includes(options.effort) !== true) {
      throw new ChatError('invalid_request', 'This ChatGPT model does not support the selected reasoning effort.');
    }
    return {model: createChatGPTModel({modelSlug: options.modelId, reasoningEffort: options.effort,
      getAccessToken: signal => chatgpt.getAccessToken(chatgpt.profileId, signal), fetch: options.fetch})};
  }
  if (!definition) throw new ChatError('invalid_request', 'This model is not supported.');
  const {effort} = options;
  if (effort !== undefined && !modelSupportsEffort(definition, effort)) {
    throw new ChatError('invalid_request', 'This model does not support the requested effort level.');
  }

  const apiKey = options.credentials[definition.provider]?.trim();
  if (apiKey === undefined || apiKey === '') {
    throw new ChatError('missing_credentials', `No API key is configured for ${definition.provider}.`);
  }
  return providerModelResolvers[definition.provider]({
    modelId: definition.id,
    effort,
    apiKey,
    fetch: options.fetch,
  });
}
