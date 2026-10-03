import {z} from 'zod';
import {EFFORT_LEVELS, SUPPORTED_PROVIDERS} from './types.js';

export const supportedProviderSchema = z.enum(SUPPORTED_PROVIDERS);
export const effortLevelSchema = z.enum(EFFORT_LEVELS);

export const modelDefinitionSchema = z.object({
  id: z.string().min(1),
  provider: supportedProviderSchema,
  supportedEffortLevels: z.array(effortLevelSchema),
  defaultEffortLevel: effortLevelSchema.optional(),
  contextWindow: z.number().int().positive(),
});

export const configuredProvidersResponseSchema = z.object({
  configuredProviders: z.array(supportedProviderSchema),
});

export const modelsResponseSchema = z.object({
  models: z.array(modelDefinitionSchema),
});

export type ConfiguredProvidersResponse = z.infer<
  typeof configuredProvidersResponseSchema
>;
export type ModelDefinition = z.infer<typeof modelDefinitionSchema>;
export type ModelsResponse = z.infer<typeof modelsResponseSchema>;
