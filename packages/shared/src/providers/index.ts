import {anthropicModels} from './anthropic.js';
import {googleModels} from './google.js';
import {openaiModels} from './openai.js';
import {SUPPORTED_PROVIDERS} from './types.js';
import type {EffortLevel, SupportedChatModelDefinition, SupportedProvider} from './types.js';

export * from './types.js';
export {
  configuredProvidersResponseSchema,
  effortLevelSchema,
  modelDefinitionSchema,
  modelsResponseSchema,
  supportedProviderSchema,
} from './schemas.js';
export type {
  ConfiguredProvidersResponse,
  ModelDefinition,
  ModelsResponse,
} from './schemas.js';

export const SUPPORTED_CHAT_MODELS = [
  ...anthropicModels,
  ...openaiModels,
  ...googleModels,
] as const satisfies readonly SupportedChatModelDefinition[];

export type SupportedChatModel = (typeof SUPPORTED_CHAT_MODELS)[number];
export type SupportedChatModelId = SupportedChatModel['id'];

export const SUPPORTED_CHAT_MODEL_IDS: SupportedChatModelId[] =
  SUPPORTED_CHAT_MODELS.map(model => model.id);

export function findSupportedChatModel(
  modelId: string,
): SupportedChatModel | undefined {
  return SUPPORTED_CHAT_MODELS.find(model => model.id === modelId);
}

export function modelHasEffortControl(
  model: SupportedChatModelDefinition,
): boolean {
  return model.supportedEffortLevels.length > 0;
}

export function modelSupportsEffort(
  model: SupportedChatModelDefinition,
  effort: EffortLevel,
): boolean {
  return model.supportedEffortLevels.includes(effort);
}

export function isModelAvailable(
  model: SupportedChatModel,
  configuredProviders: readonly SupportedProvider[],
): boolean {
  return configuredProviders.includes(model.provider);
}

export const DEFAULT_CHAT_MODEL_ID: SupportedChatModelId = 'gemma-4-31b-it';
export const DEFAULT_WORKER_MODEL_ID: SupportedChatModelId = 'claude-haiku-4-5-20251001';
