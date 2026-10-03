import type {EffortLevel} from '@codeyantram/shared';
import type {LanguageModel, LanguageModelCallOptions, streamText} from 'ai';

export interface ProviderModelOptions {
  modelId: string;
  effort?: EffortLevel;
  apiKey: string;
  fetch?: typeof globalThis.fetch;
}

export interface ResolvedChatModel {
  model: LanguageModel;
  providerOptions?: Parameters<typeof streamText>[0]['providerOptions'];
  reasoning?: LanguageModelCallOptions['reasoning'];
}

// The chat resolver validates the model, effort, and credentials before dispatch.
export type ProviderModelResolver = (options: ProviderModelOptions) => ResolvedChatModel;
