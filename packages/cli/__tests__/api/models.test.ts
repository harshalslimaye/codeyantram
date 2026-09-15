import { afterEach, describe, expect, test } from 'bun:test';
import { ModelsApiError, fetchOpenRouterModels } from '../../src/api/models';
import { mockFetch } from '../support/sse';

const originalFetch = global.fetch;

afterEach(() => {
    global.fetch = originalFetch;
});

function jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

const nemotron = {
    id: 'nvidia/nemotron-3.5-lightning:free',
    provider: 'openrouter' as const,
    supportedEffortLevels: [],
    contextWindow: 1_000_000,
};

describe('fetchOpenRouterModels', () => {
    test('returns the fetched models on success', async () => {
        mockFetch(async () => jsonResponse({ models: [nemotron] }));
        expect(await fetchOpenRouterModels()).toEqual([nemotron]);
    });

    test('returns an empty array', async () => {
        mockFetch(async () => jsonResponse({ models: [] }));
        expect(await fetchOpenRouterModels()).toEqual([]);
    });

    test('throws ModelsApiError with the status for a non-ok response', async () => {
        mockFetch(async () => jsonResponse({ error: 'upstream unreachable' }, 502));
        await expect(fetchOpenRouterModels()).rejects.toThrow(ModelsApiError);
        try {
            await fetchOpenRouterModels();
            throw new Error('should have thrown');
        } catch (error) {
            expect(error).toBeInstanceOf(ModelsApiError);
            expect((error as ModelsApiError).status).toBe(502);
        }
    });

    test('throws ModelsApiError for a response that does not match the schema', async () => {
        mockFetch(async () => jsonResponse({ notModels: true }));
        await expect(fetchOpenRouterModels()).rejects.toThrow(ModelsApiError);
    });

    test('throws ModelsApiError with no status for a network-level failure', async () => {
        mockFetch(async () => {
            throw new Error('ECONNREFUSED');
        });
        try {
            await fetchOpenRouterModels();
            throw new Error('should have thrown');
        } catch (error) {
            expect(error).toBeInstanceOf(ModelsApiError);
            expect((error as ModelsApiError).status).toBeUndefined();
            expect((error as Error).message).toContain('ECONNREFUSED');
        }
    });
});
