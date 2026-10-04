import type {SupportedChatModelDefinition} from '../types.js';

export const ANTHROPIC_PROVIDER = 'anthropic' as const;

export const anthropicModels = [
  {
    id: 'claude-fable-5-1',
    provider: ANTHROPIC_PROVIDER,
    supportedEffortLevels: ['low', 'medium', 'high', 'xhigh', 'max'],
    defaultEffortLevel: 'high',
    contextWindow: 1_000_000,
  },
  {
    id: 'claude-opus-5-5',
    provider: ANTHROPIC_PROVIDER,
    supportedEffortLevels: ['low', 'medium', 'high', 'xhigh', 'max'],
    defaultEffortLevel: 'medium',
    contextWindow: 1_000_000,
  },
  {
    id: 'claude-sonnet-5-5',
    provider: ANTHROPIC_PROVIDER,
    supportedEffortLevels: ['low', 'medium', 'high', 'xhigh', 'max'],
    defaultEffortLevel: 'high',
    contextWindow: 1_000_000,
  },
  {
    id: 'claude-haiku-4-5-20251001',
    provider: ANTHROPIC_PROVIDER,
    supportedEffortLevels: [],
    contextWindow: 200_000,
  },
] as const satisfies readonly SupportedChatModelDefinition[];
