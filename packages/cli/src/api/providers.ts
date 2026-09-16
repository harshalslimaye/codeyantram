import { providersResponseSchema, type SupportedProvider } from '@codeyantram/shared';
import { getApiClient } from './client';

/** Thrown by fetchConfiguredProviders on any failure - network-level, HTTP-level, or a
 * response that doesn't match providersResponseSchema. One error type regardless of
 * which, the same reasoning ModelsApiError (api/models.ts) and SessionApiError
 * (api/sessions.ts) follow. */
export class ProvidersApiError extends Error {
    constructor(
        message: string,
        public readonly status?: number,
    ) {
        super(message);
        this.name = 'ProvidersApiError';
    }
}

/** Which providers the server can actually call right now, via the server's own GET
 * /providers (see packages/server/src/routers/providers.ts) - checks both the
 * /connect-managed auth store and env vars, so it's the only way the CLI can know
 * whether e.g. OpenRouter is usable without duplicating that lookup itself. */
export async function fetchConfiguredProviders(): Promise<SupportedProvider[]> {
    let res: Awaited<ReturnType<ReturnType<typeof getApiClient>['providers']['$get']>>;
    try {
        res = await getApiClient().providers.$get();
    } catch (error) {
        throw new ProvidersApiError(
            `Failed to fetch configured providers: ${error instanceof Error ? error.message : 'network error'}`,
        );
    }

    if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new ProvidersApiError(
            `Failed to fetch configured providers: request failed with status ${res.status}${body ? `: ${body}` : ''}`,
            res.status,
        );
    }

    let json: unknown;
    try {
        json = await res.json();
    } catch (error) {
        throw new ProvidersApiError(
            `Failed to fetch configured providers: response was not valid JSON (${error instanceof Error ? error.message : String(error)})`,
            res.status,
        );
    }

    const result = providersResponseSchema.safeParse(json);
    if (!result.success) {
        throw new ProvidersApiError(
            `Failed to fetch configured providers: response did not match the expected shape (${result.error.message})`,
            res.status,
        );
    }
    return result.data.configuredProviders;
}
