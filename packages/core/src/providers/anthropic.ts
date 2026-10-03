import {createAnthropic, type AnthropicLanguageModelOptions} from '@ai-sdk/anthropic';
import type {ProviderModelResolver} from './types.js';

export const resolveAnthropicModel: ProviderModelResolver = ({modelId, effort, apiKey, fetch}) => {
  const anthropicOptions = {
    thinking: {type: 'adaptive'},
    // Catalog validation limits Anthropic effort to this SDK's values.
    effort: effort as AnthropicLanguageModelOptions['effort'],
  } satisfies AnthropicLanguageModelOptions;
  return {
    model: createAnthropic({apiKey, fetch})(modelId),
    providerOptions: effort === undefined ? undefined : {anthropic: anthropicOptions},
  };
};
