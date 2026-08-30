import { createGoogleGenerativeAI } from '@ai-sdk/google';
import type { LanguageModel } from 'ai';

export function buildGoogleModel(apiKey: string, modelId: string): LanguageModel {
    return createGoogleGenerativeAI({ apiKey })(modelId);
}
