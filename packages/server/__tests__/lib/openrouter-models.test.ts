import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
    OPENROUTER_MODELS_CACHE_TTL_MS,
    __resetOpenRouterModelsCacheForTests,
    __seedOpenRouterModelsCacheForTests,
    getOpenRouterModels,
} from '../../src/lib/openrouter-models';

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

const deepseekPro = {
    id: '~deepseek/deepseek-pro-latest',
    context_length: 1_048_576,
    reasoning: { supported_efforts: ['max', 'high', 'low'], default_effort: 'high' },
};

beforeEach(() => {
    __resetOpenRouterModelsCacheForTests();
});

afterEach(() => {
    global.fetch = originalFetch;
    __resetOpenRouterModelsCacheForTests();
});

describe('getOpenRouterModels', () => {
    test('maps a fetched model into SupportedChatModelDefinition shape', async () => {
        mockFetch(async () => jsonResponse({ data: [nemotron] }));

        const models = await getOpenRouterModels();

        expect(models).toEqual([
            {
                id: 'nvidia/nemotron-3.5-lightning:free',
                provider: 'openrouter',
                supportedEffortLevels: [],
                defaultEffortLevel: undefined,
                contextWindow: 1_000_000,
            },
        ]);
    });

    test('keeps only reasoning efforts this app recognizes, and a default only when it is one of them', async () => {
        mockFetch(async () => jsonResponse({ data: [deepseekPro] }));

        const [model] = await getOpenRouterModels();

        expect(model?.supportedEffortLevels).toEqual(['max', 'high', 'low']);
        expect(model?.defaultEffortLevel).toBe('high');
    });

    test('drops an unrecognized reasoning effort word rather than keeping it', async () => {
        mockFetch(async () =>
            jsonResponse({
                data: [{ ...nemotron, reasoning: { supported_efforts: ['low', 'ultra-thinking'] } }],
            }),
        );

        const [model] = await getOpenRouterModels();

        expect(model?.supportedEffortLevels).toEqual(['low']);
    });

    test('drops a default_effort that is not itself in supported_efforts', async () => {
        mockFetch(async () =>
            jsonResponse({
                data: [{ ...nemotron, reasoning: { supported_efforts: ['low', 'high'], default_effort: 'medium' } }],
            }),
        );

        const [model] = await getOpenRouterModels();

        expect(model?.defaultEffortLevel).toBeUndefined();
    });

    // Documented as nullable by OpenRouter's own API reference even though nothing in the
    // live catalog hits it today - dropped individually rather than failing the whole
    // 445-model batch (see openrouter-models.ts's own comment on this).
    test('filters out a model with a null context_length, keeping the rest', async () => {
        mockFetch(async () =>
            jsonResponse({ data: [{ ...nemotron, id: 'no-context/model', context_length: null }, deepseekPro] }),
        );

        const models = await getOpenRouterModels();

        expect(models.map(m => m.id)).toEqual(['~deepseek/deepseek-pro-latest']);
    });

    test('caches the result - a second call within the TTL does not refetch', async () => {
        let fetchCount = 0;
        mockFetch(async () => {
            fetchCount++;
            return jsonResponse({ data: [nemotron] });
        });

        await getOpenRouterModels();
        await getOpenRouterModels();

        expect(fetchCount).toBe(1);
    });

    test('refetches once the cached entry is older than the TTL', async () => {
        __seedOpenRouterModelsCacheForTests([], Date.now() - OPENROUTER_MODELS_CACHE_TTL_MS - 1);
        let fetchCount = 0;
        mockFetch(async () => {
            fetchCount++;
            return jsonResponse({ data: [nemotron] });
        });

        const models = await getOpenRouterModels();

        expect(fetchCount).toBe(1);
        expect(models).toHaveLength(1);
    });

    test('serves a stale cache instead of throwing when a refetch fails outright', async () => {
        __seedOpenRouterModelsCacheForTests(
            [{ id: 'nvidia/nemotron-3.5-lightning:free', provider: 'openrouter', supportedEffortLevels: [], contextWindow: 1_000_000 }],
            Date.now() - OPENROUTER_MODELS_CACHE_TTL_MS - 1,
        );
        mockFetch(async () => {
            throw new Error('ECONNREFUSED');
        });

        const models = await getOpenRouterModels();

        expect(models).toHaveLength(1);
    });

    test('serves a stale cache instead of throwing on a non-ok status', async () => {
        __seedOpenRouterModelsCacheForTests(
            [{ id: 'nvidia/nemotron-3.5-lightning:free', provider: 'openrouter', supportedEffortLevels: [], contextWindow: 1_000_000 }],
            Date.now() - OPENROUTER_MODELS_CACHE_TTL_MS - 1,
        );
        mockFetch(async () => new Response('rate limited', { status: 429 }));

        const models = await getOpenRouterModels();

        expect(models).toHaveLength(1);
    });

    test('serves a stale cache instead of throwing on a response that fails schema validation', async () => {
        __seedOpenRouterModelsCacheForTests(
            [{ id: 'nvidia/nemotron-3.5-lightning:free', provider: 'openrouter', supportedEffortLevels: [], contextWindow: 1_000_000 }],
            Date.now() - OPENROUTER_MODELS_CACHE_TTL_MS - 1,
        );
        mockFetch(async () => jsonResponse({ notData: [] }));

        const models = await getOpenRouterModels();

        expect(models).toHaveLength(1);
    });

    test('throws on a network-level failure with no cache to fall back on', async () => {
        mockFetch(async () => {
            throw new Error('ECONNREFUSED');
        });

        await expect(getOpenRouterModels()).rejects.toThrow(/Failed to reach OpenRouter/);
    });

    test('throws on a non-ok status with no cache to fall back on', async () => {
        mockFetch(async () => new Response('rate limited', { status: 429 }));

        await expect(getOpenRouterModels()).rejects.toThrow(/status 429/);
    });

    test('throws on a response that fails schema validation with no cache to fall back on', async () => {
        mockFetch(async () => jsonResponse({ notData: [] }));

        await expect(getOpenRouterModels()).rejects.toThrow(/did not match the expected shape/);
    });

    test('throws on a response that is not valid JSON with no cache to fall back on', async () => {
        mockFetch(async () => new Response('not json', { status: 200 }));

        await expect(getOpenRouterModels()).rejects.toThrow(/did not match the expected shape/);
    });
});
