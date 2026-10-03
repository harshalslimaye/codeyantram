import {createOpenAI, type OpenAIResponsesProviderOptions} from '@ai-sdk/openai';
import type {ProviderModelResolver} from './types.js';

export const resolveOpenAIModel: ProviderModelResolver = ({modelId, effort, apiKey, fetch}) => {
  const openaiOptions = {reasoningEffort: effort} satisfies OpenAIResponsesProviderOptions;
  return {
    model: createOpenAI({apiKey, fetch}).responses(modelId),
    providerOptions: effort === undefined ? undefined : {openai: openaiOptions},
  };
};
