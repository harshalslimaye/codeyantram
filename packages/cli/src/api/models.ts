import { modelsResponseSchema, type SupportedChatModelDefinition } from '@codeyantram/shared';
import { getApiClient } from './client';

/** Thrown by fetchOpenRouterModels on any failure - network-level, HTTP-level, or a
 * response that doesn't match modelsResponseSchema. One error type regardless of which,
 * the same reasoning api/sessions.ts's own SessionApiError follows. */
export class ModelsApiError extends Error {
    constructor(
        message: string,
        public readonly status?: number,
    ) {
        super(message);
        this.name = 'ModelsApiError';
    }
}

/** OpenRouter's live-fetched catalog, via the server's own GET /models (see
 * packages/server/src/routers/models.ts). The static four-provider catalog is already
 * known at build time (SUPPORTED_CHAT_MODELS), so this only ever returns what the CLI
 * can't otherwise know. */
export async function fetchOpenRouterModels(): Promise<SupportedChatModelDefinition[]> {
    let res: Awaited<ReturnType<ReturnType<typeof getApiClient>['models']['$get']>>;
    try {
        res = await getApiClient().models.$get();
    } catch (error) {
        throw new ModelsApiError(`Failed to fetch models: ${error instanceof Error ? error.message : 'network error'}`);
    }

    if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new ModelsApiError(
            `Failed to fetch models: request failed with status ${res.status}${body ? `: ${body}` : ''}`,
            res.status,
        );
    }

    let json: unknown;
    try {
        json = await res.json();
    } catch (error) {
        throw new ModelsApiError(
            `Failed to fetch models: response was not valid JSON (${error instanceof Error ? error.message : String(error)})`,
            res.status,
        );
    }

    const result = modelsResponseSchema.safeParse(json);
    if (!result.success) {
        throw new ModelsApiError(
            `Failed to fetch models: response did not match the expected shape (${result.error.message})`,
            res.status,
        );
    }
    return result.data.models;
}
