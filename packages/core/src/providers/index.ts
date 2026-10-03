import type {SupportedProvider} from '@codeyantram/shared';
import {resolveAnthropicModel} from './anthropic.js';
import {resolveGoogleModel} from './google.js';
import {resolveOpenAIModel} from './openai.js';
import type {ProviderModelResolver} from './types.js';

export const providerModelResolvers = {
  anthropic: resolveAnthropicModel,
  google: resolveGoogleModel,
  openai: resolveOpenAIModel,
} satisfies Record<SupportedProvider, ProviderModelResolver>;

export type {ResolvedChatModel} from './types.js';
