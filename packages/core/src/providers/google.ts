import {createGoogle, type GoogleLanguageModelOptions} from '@ai-sdk/google';
import type {LanguageModelCallOptions} from 'ai';
import type {ProviderModelResolver} from './types.js';

export const resolveGoogleModel: ProviderModelResolver = ({modelId, effort, apiKey, fetch}) => {
  // AI SDK 7 maps named reasoning levels to budgets for Gemini 2.5.
  // For Gemini 3+, send the supported level directly as thinkingLevel.
  const googleOptions = {
    thinkingConfig: {thinkingLevel: effort as 'minimal' | 'low' | 'medium' | 'high'},
  } satisfies GoogleLanguageModelOptions;
  return {
    model: createGoogle({apiKey, fetch})(modelId),
    ...(modelId.startsWith('gemini-2.5-')
      ? {reasoning: effort as LanguageModelCallOptions['reasoning']}
      : {providerOptions: effort === undefined ? undefined : {google: googleOptions}}),
  };
};
