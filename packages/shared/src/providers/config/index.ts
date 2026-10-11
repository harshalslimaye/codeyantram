import {anthropicModels} from './anthropic.js';
import {googleModels} from './google.js';
import {openaiModels} from './openai.js';
import {EFFORT_LEVELS, type EffortLevel, type SupportedChatModelDefinition, type SupportedProvider} from '../types.js';

export * from '../types.js';
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

/** Recognizes model IDs saved by the earlier prefixed ChatGPT integration. */
export function isChatGPTModelId(modelId: string): boolean {
  return /^chatgpt:[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(modelId);
}

/** Model IDs are shared by OpenAI API-key and ChatGPT plan connections. */
export function isOpenAIModelSlug(modelId: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(modelId);
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

/** The account catalog may omit effort metadata; use known OpenAI model capabilities then. */
export function chatGPTSupportedEfforts(modelId: string, catalogEfforts?: readonly string[]): readonly EffortLevel[] {
  if (catalogEfforts !== undefined) {
    return catalogEfforts.filter((effort): effort is EffortLevel => EFFORT_LEVELS.some(level => level === effort));
  }
  const known = findSupportedChatModel(modelId);
  return known?.provider === 'openai' ? known.supportedEffortLevels : [];
}

export function isModelAvailable(
  model: SupportedChatModel,
  configuredProviders: readonly SupportedProvider[],
): boolean {
  return configuredProviders.includes(model.provider);
}

export const DEFAULT_CHAT_MODEL_ID: SupportedChatModelId = 'gemma-4-31b-it';
export const DEFAULT_WORKER_MODEL_ID: SupportedChatModelId = 'claude-haiku-4-5-20251001';
