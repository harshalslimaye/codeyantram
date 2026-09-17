import type { LanguageModel } from 'ai';
import type { ProviderOptions } from '@ai-sdk/provider-utils';
import {
    DEFAULT_WORKER_MODEL_ID,
    EFFORT_LEVELS,
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

/**
 * Which model a turn's subagent workers should run on, as the request describes it.
 *
 * `orchestratorModelId` is not a preference but a fallback of last resort: the worker
 * model is chosen independently of the orchestrator's and may sit on an entirely different
 * provider, so a user with (say) only an OpenRouter key configured would otherwise hit
 * MissingCredentialsError on the default worker - mid-turn, inside a tool call, where
 * there is no approval prompt and no good error path. Falling back to a model we already
 * know resolves keeps the turn alive at the cost of a more expensive worker.
 */
export type WorkerModelChoice = {
    /** What the user picked (ChatRequest.workerModel). Absent means "use the default". */
    requested?: string;
    /** Its effort level, if that model takes one (ChatRequest.workerEffort). */
    effort?: EffortLevel;
    /** The model this turn's orchestrator is running on, used only if the above fails. */
    orchestratorModelId: string;
};

/**
 * Resolves the model one worker runs on: what the user picked, else
 * DEFAULT_WORKER_MODEL_ID, else the orchestrator's own model.
 *
 * Deliberately built on resolveChatModel rather than beside it. The OpenRouter
 * live-catalog lookup, the API-key check and the unsupported-effort guard all apply
 * identically to a worker, so going through the same path is what makes "a worker can be
 * any model the orchestrator can be" true rather than merely intended - a second
 * implementation would drift, and would quietly become "any model from the static
 * catalog".
 *
 * The fallback drops `effort` rather than carrying it over: it belongs to the model the
 * user picked, and the orchestrator's model may not accept it at all.
 */
/**
 * The cheapest effort level a model will accept, or undefined if it takes none at all.
 *
 * EFFORT_LEVELS is ordered from least to most, so the first supported entry is the
 * shallowest thinking the model offers.
 */
function lowestEffort(modelId: string): EffortLevel | undefined {
    const model = findSupportedChatModel(modelId);
    if (model === undefined) return undefined;

    return EFFORT_LEVELS.find(level => modelSupportsEffort(model, level));
}

export async function resolveWorkerModel({
    requested,
    effort,
    orchestratorModelId,
}: WorkerModelChoice): Promise<ResolvedChatModel> {
    const preferred = requested ?? DEFAULT_WORKER_MODEL_ID;

    // A worker that isn't told an effort level gets the model's *lowest*, not the
    // provider's default - which is not the same thing and is often much more. DeepSeek's
    // catalog default is "high", so an unconfigured worker would sit and reason at high
    // effort before emitting its first grep, on every spawn, several times a turn.
    //
    // Deliberate for this role rather than a general cost saving: a worker greps, looks,
    // and cites. That is mechanical work where latency is the whole cost and deep
    // reasoning buys nothing - the judgment lives in the orchestrator, which keeps its own
    // effort setting untouched. A user who wants a thinking worker can still pick one
    // explicitly (/effort -> Worker Effort); this only changes what "unset" means.
    const effectiveEffort = effort ?? lowestEffort(preferred);

    try {
        return await resolveChatModel(preferred, effectiveEffort);
    } catch (error) {
        // Only these two are worth a second attempt: no key for that provider, or an id
        // the catalogs no longer know. Anything else (a provider client failing to
        // construct, say) would fail identically on the fallback, so let it through.
        const recoverable = error instanceof MissingCredentialsError || error instanceof UnknownModelError;
        if (!recoverable || preferred === orchestratorModelId) throw error;

        return await resolveChatModel(orchestratorModelId, undefined);
    }
}
