import { createOpenAI } from '@ai-sdk/openai';
import type { LanguageModel } from 'ai';

export function buildOpenAIModel(apiKey: string, modelId: string): LanguageModel {
    return createOpenAI({ apiKey })(modelId);
}
