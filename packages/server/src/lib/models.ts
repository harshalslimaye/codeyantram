import type { LanguageModel } from 'ai';
import type { ProviderOptions } from '@ai-sdk/provider-utils';
import {
    findSupportedChatModel,
    modelSupportsEffort,
    type EffortLevel,
    type SupportedChatModelDefinition,
    type SupportedProvider,
} from '@codeyantram/shared';
import { buildAnthropicModel } from '../providers/anthropic';
import { buildGoogleModel } from '../providers/google';
import { buildOpenAIModel } from '../providers/openai';
import { buildDeepSeekModel } from '../providers/deepseek';
import { buildOpenRouterModel } from '../providers/openrouter';
import { resolveApiKey } from '../providers';
import { getOpenRouterModels } from './openrouter-models';

export class MissingCredentialsError extends Error {
    constructor(public readonly provider: SupportedProvider) {
        super(`No API key configured for ${provider}`);
    }
}

export class UnknownModelError extends Error {
    constructor(public readonly modelId: string) {
        super(`Unknown model: ${modelId}`);
    }
}

const MODEL_BUILDERS = {
    anthropic: buildAnthropicModel,
    openai: buildOpenAIModel,
    google: buildGoogleModel,
    deepseek: buildDeepSeekModel,
    openrouter: buildOpenRouterModel,
} satisfies Record<SupportedProvider, (apiKey: string, modelId: string) => LanguageModel>;

/**
 * Each provider's AI SDK client exposes reasoning effort under its own key
 * and, for Google, a narrower set of levels - but chatRequestSchema already
 * rejects an effort the selected model doesn't support, so this only ever
 * runs with a level the provider accepts.
 */
function buildProviderOptions(model: SupportedChatModelDefinition, effort: EffortLevel): ProviderOptions {
    switch (model.provider) {
        case 'anthropic':
            return { anthropic: { effort } };
        case 'openai':
            return { openai: { reasoningEffort: effort } };
        case 'google':
            return { google: { thinkingLevel: effort } };
        case 'deepseek':
            // "none" disables thinking outright; the SDK's reasoningEffort
            // field takes low/high/max directly (see EFFORT_LEVELS in models.ts
            // for why "minimal"/"medium"/"xhigh" are never offered for this provider).
            return effort === 'none'
                ? { deepseek: { thinking: { type: 'disabled' } } }
                : { deepseek: { reasoningEffort: effort } };
        case 'openrouter':
            // The installed @openrouter/ai-sdk-provider's own OpenRouterProviderOptions
            // type omits "max" from reasoning.effort's union (xhigh/high/medium/low/
            // minimal/none only), but OpenRouter's live /models response reports "max"
            // as a real supported_effort for some models (see openrouter-models.ts's own
            // toEffortLevels) - trusting the API's own reported capability over what
            // looks like a gap in the npm package's types, rather than silently
            // downgrading a model that genuinely offers it.
            return { openrouter: { reasoning: { effort: effort as Exclude<EffortLevel, 'max'> } } };
    }
}

export type ResolvedChatModel = {
    model: SupportedChatModelDefinition;
    languageModel: LanguageModel;
    providerOptions: ProviderOptions | undefined;
};

/**
 * Resolves everything streamText needs for one chat turn: the model definition (the
 * static catalog first - synchronous, no network - falling back to OpenRouter's
 * live-fetched catalog only when the id isn't found there), a client built from whichever
 * key /connect or the provider's env var supplies, and the effort-level provider options
 * (if any).
 */
export async function resolveChatModel(
    modelId: string,
    effort: EffortLevel | undefined,
): Promise<ResolvedChatModel> {
    const model: SupportedChatModelDefinition | undefined =
        findSupportedChatModel(modelId) ?? (await getOpenRouterModels()).find(m => m.id === modelId);
    if (model === undefined) throw new UnknownModelError(modelId);

    const apiKey = resolveApiKey(model.provider);
    if (apiKey === undefined) throw new MissingCredentialsError(model.provider);

    // The static catalog's four providers are already guaranteed a supported effort by
    // chatRequestSchema's own check before a request ever reaches here; an OpenRouter
    // model isn't (see chatModelIdSchema's comment in @codeyantram/shared) - so an
    // unsupported effort is quietly dropped rather than sent, degrading the turn
    // gracefully instead of failing it over a mismatched reasoning setting.
    const effectiveEffort = effort !== undefined && modelSupportsEffort(model, effort) ? effort : undefined;

    return {
        model,
        languageModel: MODEL_BUILDERS[model.provider](apiKey, model.id),
        providerOptions: effectiveEffort === undefined ? undefined : buildProviderOptions(model, effectiveEffort),
    };
}
