import {createAnthropic, type AnthropicLanguageModelOptions} from '@ai-sdk/anthropic';
import type {ProviderModelResolver} from './types.js';

export const resolveAnthropicModel: ProviderModelResolver = ({modelId, effort, apiKey, fetch}) => {
  const anthropicOptions = {
    // Automatic caching advances the breakpoint as conversation history grows.
    cacheControl: {type: 'ephemeral'},
    ...(effort === undefined ? {} : {
      thinking: {type: 'adaptive'},
      // Catalog validation limits Anthropic effort to this SDK's values.
      effort: effort as AnthropicLanguageModelOptions['effort'],
    }),
  } satisfies AnthropicLanguageModelOptions;
  return {
    model: createAnthropic({apiKey, fetch})(modelId),
    providerOptions: {anthropic: anthropicOptions},
  };
};
