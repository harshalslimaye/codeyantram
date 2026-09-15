import { z } from 'zod';
import { EFFORT_LEVELS, type EffortLevel, type SupportedChatModelDefinition } from '@codeyantram/shared';

const OPENROUTER_MODELS_URL = 'https://openrouter.ai/api/v1/models';
const FETCH_TIMEOUT_MS = 10_000;
export const OPENROUTER_MODELS_CACHE_TTL_MS = 5 * 60 * 1000;

// Only the fields this app actually reads from OpenRouter's real response - id,
// name, pricing, architecture, supported_parameters and more all exist on the live
// payload too, but this stays narrow on purpose: OpenRouter can add, remove, or rename a
// field this app never asked for without breaking parsing, since safeParse only ever
// looks at the keys named here.
const openRouterModelSchema = z.object({
    id: z.string().min(1),
    // Nullable per OpenRouter's own docs, even though nothing in the live catalog hits
    // it today - a model with none reported is filtered out in toChatModelDefinition
    // rather than assigned a made-up number, since contextWindow feeds the context-usage
    // percentage shown to the user.
    context_length: z.number().int().positive().nullable(),
    reasoning: z
        .object({
            supported_efforts: z.array(z.string()).optional(),
            default_effort: z.string().optional(),
        })
        .optional(),
});

const openRouterModelsApiResponseSchema = z.object({
    data: z.array(openRouterModelSchema),
});

// OpenRouter's own reasoning vocabulary for a given model isn't guaranteed to be a
// subset of this app's EffortLevel union (see EFFORT_LEVELS in @codeyantram/shared) - an
// unrecognized word is dropped rather than kept, so a model can only ever be offered an
// effort level this app actually knows how to send.
function toEffortLevels(supported: string[] | undefined): EffortLevel[] {
    if (supported === undefined) return [];
    const known = new Set<string>(EFFORT_LEVELS);
    return supported.filter((level): level is EffortLevel => known.has(level));
}

// Null only for context_length - every other field this app reads is required on
// OpenRouter's own schema - so this is the one case where a model is dropped from the
// catalog entirely rather than mapped with a placeholder.
function toChatModelDefinition(model: z.infer<typeof openRouterModelSchema>): SupportedChatModelDefinition | null {
    if (model.context_length === null) return null;

    const supportedEffortLevels = toEffortLevels(model.reasoning?.supported_efforts);
    // Only kept if it's actually one of the levels this same model just declared -
    // default_effort and supported_efforts are independent fields on OpenRouter's own
    // response, so nothing guarantees the former is a member of the latter.
    const defaultEffortLevel = supportedEffortLevels.find(level => level === model.reasoning?.default_effort);

    return {
        id: model.id,
        provider: 'openrouter',
        supportedEffortLevels,
        defaultEffortLevel,
        contextWindow: model.context_length,
    };
}

// Module-level, in-memory, dies with the server process - same shape as web-cache.ts's
// own cache for web_fetch. One entry for the whole catalog, not one per model: every
// caller wants the same list, so there's nothing to key on.
let cache: { models: SupportedChatModelDefinition[]; fetchedAt: number } | null = null;

/**
 * The static catalog's four providers ship a known lineup at build time; OpenRouter's
 * hundreds of models don't, so this fetches and caches OpenRouter's own live catalog
 * instead (see chatModelIdSchema's comment in @codeyantram/shared for why the request
 * schema can't validate these ids itself - this is where that validation actually
 * happens, via resolveChatModel). A stale cache is served instead of thrown on a failed
 * refetch - "keep showing what we already know" beats "the model picker breaks" over a
 * transient network blip.
 */
export async function getOpenRouterModels(): Promise<SupportedChatModelDefinition[]> {
    if (cache !== null && Date.now() - cache.fetchedAt < OPENROUTER_MODELS_CACHE_TTL_MS) {
        return cache.models;
    }

    let response: Response;
    try {
        response = await fetch(OPENROUTER_MODELS_URL, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    } catch (error) {
        if (cache !== null) return cache.models;
        throw new Error(
            `Failed to reach OpenRouter's model list: ${error instanceof Error ? error.message : String(error)}`,
        );
    }

    if (!response.ok) {
        if (cache !== null) return cache.models;
        throw new Error(`OpenRouter's model list request failed with status ${response.status}`);
    }

    const json: unknown = await response.json().catch(() => undefined);
    const parsed = openRouterModelsApiResponseSchema.safeParse(json);
    if (!parsed.success) {
        if (cache !== null) return cache.models;
        throw new Error(`OpenRouter's model list response did not match the expected shape: ${parsed.error.message}`);
    }

    const models = parsed.data.data
        .map(toChatModelDefinition)
        .filter((model): model is SupportedChatModelDefinition => model !== null);
    cache = { models, fetchedAt: Date.now() };
    return models;
}

/** Test-only: clears the cached catalog between test cases. Never called from
 * production code. */
export function __resetOpenRouterModelsCacheForTests(): void {
    cache = null;
}

/** Test-only: seeds the cache directly, bypassing a real fetch - lets a test set up a
 * stale-but-present entry to exercise the "serve stale on a failed refetch" path without
 * waiting out OPENROUTER_MODELS_CACHE_TTL_MS for real. Never called from production
 * code. */
export function __seedOpenRouterModelsCacheForTests(models: SupportedChatModelDefinition[], fetchedAt: number): void {
    cache = { models, fetchedAt };
}
