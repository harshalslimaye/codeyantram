import type {SupportedChatModelDefinition} from './types.js';

export const GOOGLE_PROVIDER = 'google' as const;

export const googleModels = [
  {
    id: 'gemini-3.8-flash',
    provider: GOOGLE_PROVIDER,
    supportedEffortLevels: ['low', 'medium', 'high'],
    defaultEffortLevel: 'medium',
    contextWindow: 1_048_576,
  },
  {
    id: 'gemini-3.7-flash',
    provider: GOOGLE_PROVIDER,
    supportedEffortLevels: ['low', 'medium', 'high'],
    defaultEffortLevel: 'medium',
    contextWindow: 1_048_576,
  },
  {
    id: 'gemini-3.6-flash',
    provider: GOOGLE_PROVIDER,
    supportedEffortLevels: ['low', 'medium', 'high'],
    defaultEffortLevel: 'medium',
    contextWindow: 1_048_576,
  },
  {
    id: 'gemini-2.5-pro',
    provider: GOOGLE_PROVIDER,
    supportedEffortLevels: ['minimal', 'low', 'medium', 'high'],
    defaultEffortLevel: 'medium',
    contextWindow: 1_048_576,
  },
  {
    id: 'gemini-2.5-flash',
    provider: GOOGLE_PROVIDER,
    supportedEffortLevels: ['minimal', 'low', 'medium', 'high'],
    defaultEffortLevel: 'medium',
    contextWindow: 1_048_576,
  },
  {
    id: 'gemma-4-31b-it',
    provider: GOOGLE_PROVIDER,
    supportedEffortLevels: [],
    contextWindow: 262_144,
  },
  {
    id: 'gemma-4-26b-a4b-it',
    provider: GOOGLE_PROVIDER,
    supportedEffortLevels: [],
    contextWindow: 262_144,
  },
] as const satisfies readonly SupportedChatModelDefinition[];
