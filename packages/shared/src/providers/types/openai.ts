import type {SupportedChatModelDefinition} from '../types.js';

export const OPENAI_PROVIDER = 'openai' as const;

export const openaiModels = [
  {
    id: 'gpt-5.6-sol',
    provider: OPENAI_PROVIDER,
    supportedEffortLevels: ['none', 'low', 'medium', 'high', 'xhigh', 'max'],
    defaultEffortLevel: 'medium',
    contextWindow: 1_050_000,
  },
  {
    id: 'gpt-5.6-terra',
    provider: OPENAI_PROVIDER,
    supportedEffortLevels: ['none', 'low', 'medium', 'high', 'xhigh', 'max'],
    defaultEffortLevel: 'medium',
    contextWindow: 1_050_000,
  },
  {
    id: 'gpt-5.6-luna',
    provider: OPENAI_PROVIDER,
    supportedEffortLevels: ['none', 'low', 'medium', 'high', 'xhigh', 'max'],
    defaultEffortLevel: 'medium',
    contextWindow: 1_050_000,
  },
  {
    id: 'gpt-6-astra',
    provider: OPENAI_PROVIDER,
    supportedEffortLevels: ['low', 'medium', 'high', 'xhigh', 'max'],
    contextWindow: 1_050_000,
  },
  {
    id: 'gpt-6.1-sol',
    provider: OPENAI_PROVIDER,
    supportedEffortLevels: ['low', 'medium', 'high', 'xhigh', 'max'],
    defaultEffortLevel: 'medium',
    contextWindow: 1_050_000,
  },
  {
    id: 'gpt-6-luna',
    provider: OPENAI_PROVIDER,
    supportedEffortLevels: ['none', 'low', 'medium', 'high', 'xhigh', 'max'],
    defaultEffortLevel: 'medium',
    contextWindow: 1_050_000,
  },
] as const satisfies readonly SupportedChatModelDefinition[];
