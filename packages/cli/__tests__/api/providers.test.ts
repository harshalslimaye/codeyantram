import { afterEach, describe, expect, test } from 'bun:test';
import { ProvidersApiError, fetchConfiguredProviders } from '../../src/api/providers';
import { mockFetch } from '../support/sse';

const originalFetch = global.fetch;

afterEach(() => {
    global.fetch = originalFetch;
});

function jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('fetchConfiguredProviders', () => {
    test('returns the configured providers on success', async () => {
        mockFetch(async () => jsonResponse({ configuredProviders: ['anthropic', 'openrouter'] }));
        expect(await fetchConfiguredProviders()).toEqual(['anthropic', 'openrouter']);
    });

    test('returns an empty array', async () => {
        mockFetch(async () => jsonResponse({ configuredProviders: [] }));
        expect(await fetchConfiguredProviders()).toEqual([]);
    });

    test('throws ProvidersApiError with the status for a non-ok response', async () => {
        mockFetch(async () => jsonResponse({ error: 'unreachable' }, 502));
        await expect(fetchConfiguredProviders()).rejects.toThrow(ProvidersApiError);
        try {
            await fetchConfiguredProviders();
            throw new Error('should have thrown');
        } catch (error) {
            expect(error).toBeInstanceOf(ProvidersApiError);
            expect((error as ProvidersApiError).status).toBe(502);
        }
    });

    test('throws ProvidersApiError for a response that does not match the schema', async () => {
        mockFetch(async () => jsonResponse({ configuredProviders: ['not-a-real-provider'] }));
        await expect(fetchConfiguredProviders()).rejects.toThrow(ProvidersApiError);
    });

    test('throws ProvidersApiError with no status for a network-level failure', async () => {
        mockFetch(async () => {
            throw new Error('ECONNREFUSED');
        });
        try {
            await fetchConfiguredProviders();
            throw new Error('should have thrown');
        } catch (error) {
            expect(error).toBeInstanceOf(ProvidersApiError);
            expect((error as ProvidersApiError).status).toBeUndefined();
            expect((error as Error).message).toContain('ECONNREFUSED');
        }
    });
});
