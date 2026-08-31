import type { LanguageModel } from 'ai';
import type { ProviderOptions } from '@ai-sdk/provider-utils';
import {
    findSupportedChatModel,
    type EffortLevel,
    type SupportedChatModel,
    type SupportedChatModelId,
    type SupportedProvider,
} from '@codeyantram/shared';
import { buildAnthropicModel } from '../providers/anthropic';
import { buildGoogleModel } from '../providers/google';
import { buildOpenAIModel } from '../providers/openai';
import { buildDeepSeekModel } from '../providers/deepseek';
import { resolveApiKey } from '../providers';

export class MissingCredentialsError extends Error {
    constructor(public readonly provider: SupportedProvider) {
        super(`No API key configured for ${provider}`);
    }
}

const MODEL_BUILDERS = {
    anthropic: buildAnthropicModel,
    openai: buildOpenAIModel,
    google: buildGoogleModel,
    deepseek: buildDeepSeekModel,
} satisfies Record<SupportedProvider, (apiKey: string, modelId: string) => LanguageModel>;

/**
 * Each provider's AI SDK client exposes reasoning effort under its own key
 * and, for Google, a narrower set of levels - but chatRequestSchema already
 * rejects an effort the selected model doesn't support, so this only ever
 * runs with a level the provider accepts.
 */
function buildProviderOptions(model: SupportedChatModel, effort: EffortLevel): ProviderOptions {
    switch (model.provider) {
        case 'anthropic':
            return { anthropic: { effort } };
        case 'openai':
            return { openai: { reasoningEffort: effort } };
        case 'google':
            return { google: { thinkingLevel: effort } };
        case 'deepseek':
            return {};
    }
}

export type ResolvedChatModel = {
    model: SupportedChatModel;
    languageModel: LanguageModel;
    providerOptions: ProviderOptions | undefined;
};

/**
 * Resolves everything streamText needs for one chat turn: the model
 * definition, a client built from whichever key /connect or the provider's
 * env var supplies, and the effort-level provider options (if any).
 */
export function resolveChatModel(modelId: SupportedChatModelId, effort: EffortLevel | undefined): ResolvedChatModel {
    const model = findSupportedChatModel(modelId) as SupportedChatModel;

    const apiKey = resolveApiKey(model.provider);
    if (apiKey === undefined) throw new MissingCredentialsError(model.provider);

    return {
        model,
        languageModel: MODEL_BUILDERS[model.provider](apiKey, model.id),
        providerOptions: effort === undefined ? undefined : buildProviderOptions(model, effort),
    };
}
