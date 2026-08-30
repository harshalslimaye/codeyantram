import { createAnthropic } from '@ai-sdk/anthropic';
import type { LanguageModel } from 'ai';

export function buildAnthropicModel(apiKey: string, modelId: string): LanguageModel {
    return createAnthropic({ apiKey })(modelId);
}
