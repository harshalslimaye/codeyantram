import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { __resetOpenRouterModelsCacheForTests } from '../../src/lib/openrouter-models';
import { app } from '../../src/index';

const originalFetch = global.fetch;

function mockFetch(impl: (...args: Parameters<typeof fetch>) => ReturnType<typeof fetch>): void {
    global.fetch = impl as unknown as typeof fetch;
}

function jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

const nemotron = {
    id: 'nvidia/nemotron-3.5-lightning:free',
    context_length: 1_000_000,
    reasoning: { mandatory: false },
};

beforeEach(() => {
    __resetOpenRouterModelsCacheForTests();
});

afterEach(() => {
    global.fetch = originalFetch;
    __resetOpenRouterModelsCacheForTests();
});

describe('GET /models', () => {
    test('returns the live-fetched OpenRouter catalog, in this app\'s own vocabulary', async () => {
        mockFetch(async () => jsonResponse({ data: [nemotron] }));

        const res = await app.request('/models');

        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({
            models: [
                {
                    id: 'nvidia/nemotron-3.5-lightning:free',
                    provider: 'openrouter',
                    supportedEffortLevels: [],
                    contextWindow: 1_000_000,
                },
            ],
        });
    });

    test('returns 502 with a message when OpenRouter is unreachable and there is no cache to fall back on', async () => {
        mockFetch(async () => {
            throw new Error('ECONNREFUSED');
        });

        const res = await app.request('/models');

        expect(res.status).toBe(502);
        const body = (await res.json()) as { error: string };
        expect(body.error).toContain('Failed to reach OpenRouter');
    });
});
