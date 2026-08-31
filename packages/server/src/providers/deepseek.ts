import { createDeepSeek } from '@ai-sdk/deepseek';
import type { LanguageModel } from 'ai';

export function buildDeepSeekModel(apiKey: string, modelId: string): LanguageModel {
    return createDeepSeek({ apiKey })(modelId);
}
