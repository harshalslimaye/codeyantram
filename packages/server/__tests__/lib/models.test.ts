import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { PROVIDER_ENV_VARS, SUPPORTED_PROVIDERS } from '@codeyantram/shared';
import { MissingCredentialsError, UnknownModelError, resolveChatModel } from '../../src/lib/models';
import { __resetOpenRouterModelsCacheForTests } from '../../src/lib/openrouter-models';

const originalEnv: Record<string, string | undefined> = {};
const originalFetch = global.fetch;

function mockFetch(impl: (...args: Parameters<typeof fetch>) => ReturnType<typeof fetch>): void {
    global.fetch = impl as unknown as typeof fetch;
}

function jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

beforeEach(() => {
    for (const provider of SUPPORTED_PROVIDERS) {
        const envVar = PROVIDER_ENV_VARS[provider];
        originalEnv[envVar] = process.env[envVar];
        delete process.env[envVar];
    }
    __resetOpenRouterModelsCacheForTests();
});

afterEach(() => {
    for (const [envVar, value] of Object.entries(originalEnv)) {
        if (value === undefined) delete process.env[envVar];
        else process.env[envVar] = value;
    }
    global.fetch = originalFetch;
    __resetOpenRouterModelsCacheForTests();
});

// Every id used below is in the static catalog, so resolveChatModel's OpenRouter fallback
// (an await'd network fetch - see getOpenRouterModels in ../../src/lib/openrouter-models)
// is never reached here; that path gets its own mocked coverage separately.
describe('resolveChatModel', () => {
    test('throws MissingCredentialsError when the model\'s provider has no key', async () => {
        await expect(resolveChatModel('claude-sonnet-5', undefined)).rejects.toThrow(MissingCredentialsError);
    });

    test('the thrown error names the provider that is missing a key', async () => {
        expect.assertions(2);
        try {
            await resolveChatModel('gpt-5.4', undefined);
        } catch (error) {
            expect(error).toBeInstanceOf(MissingCredentialsError);
            expect((error as MissingCredentialsError).provider).toBe('openai');
        }
    });

    test('builds a language model once a key is available, with no providerOptions when effort is omitted', async () => {
        process.env[PROVIDER_ENV_VARS.anthropic] = 'sk-test-key';

        const resolved = await resolveChatModel('claude-sonnet-5', undefined);

        expect(resolved.model.id).toBe('claude-sonnet-5');
        expect(resolved.languageModel).toBeDefined();
        expect(resolved.providerOptions).toBeUndefined();
    });

    test('maps effort to providerOptions.anthropic.effort for an Anthropic model', async () => {
        process.env[PROVIDER_ENV_VARS.anthropic] = 'sk-test-key';

        const resolved = await resolveChatModel('claude-sonnet-5', 'high');

        expect(resolved.providerOptions).toEqual({ anthropic: { effort: 'high' } });
    });

    test('maps effort to providerOptions.openai.reasoningEffort for an OpenAI model', async () => {
        process.env[PROVIDER_ENV_VARS.openai] = 'sk-test-key';

        const resolved = await resolveChatModel('gpt-5.4', 'medium');

        expect(resolved.providerOptions).toEqual({ openai: { reasoningEffort: 'medium' } });
    });

    test('maps effort to providerOptions.google.thinkingLevel for a Google model', async () => {
        process.env[PROVIDER_ENV_VARS.google] = 'test-key';

        const resolved = await resolveChatModel('gemini-3.5-flash', 'low');

        expect(resolved.providerOptions).toEqual({ google: { thinkingLevel: 'low' } });
    });

    test('maps effort to providerOptions.deepseek.reasoningEffort for a DeepSeek model', async () => {
        process.env[PROVIDER_ENV_VARS.deepseek] = 'test-key';

        const resolved = await resolveChatModel('deepseek-v4-pro', 'max');

        expect(resolved.providerOptions).toEqual({ deepseek: { reasoningEffort: 'max' } });
    });

    test('maps "none" effort to providerOptions.deepseek.thinking.type "disabled", not reasoningEffort', async () => {
        process.env[PROVIDER_ENV_VARS.deepseek] = 'test-key';

        const resolved = await resolveChatModel('deepseek-v4-flash', 'none');

        expect(resolved.providerOptions).toEqual({ deepseek: { thinking: { type: 'disabled' } } });
    });
});

// Ids not in the static catalog fall back to OpenRouter's live cache (see
// getOpenRouterModels), so every test here mocks fetch rather than relying on the real
// network - the live-API behavior itself is covered separately in
// __tests__/lib/openrouter-models.test.ts.
describe('resolveChatModel - OpenRouter fallback', () => {
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

    test('falls back to a live-fetched OpenRouter model once the static catalog misses', async () => {
        mockFetch(async () => jsonResponse({ data: [nemotron] }));
        process.env[PROVIDER_ENV_VARS.openrouter] = 'sk-or-test-key';

        const resolved = await resolveChatModel('nvidia/nemotron-3.5-lightning:free', undefined);

        expect(resolved.model.provider).toBe('openrouter');
        expect(resolved.languageModel).toBeDefined();
    });

    test('throws MissingCredentialsError for an OpenRouter model when no key is set', async () => {
        mockFetch(async () => jsonResponse({ data: [nemotron] }));

        expect.assertions(2);
        try {
            await resolveChatModel('nvidia/nemotron-3.5-lightning:free', undefined);
        } catch (error) {
            expect(error).toBeInstanceOf(MissingCredentialsError);
            expect((error as MissingCredentialsError).provider).toBe('openrouter');
        }
    });

    test('throws UnknownModelError for an id in neither the static catalog nor OpenRouter\'s live one', async () => {
        mockFetch(async () => jsonResponse({ data: [nemotron] }));

        await expect(resolveChatModel('not-a-real-model', undefined)).rejects.toThrow(UnknownModelError);
    });

    test('maps a supported effort to providerOptions.openrouter.reasoning.effort', async () => {
        mockFetch(async () => jsonResponse({ data: [deepseekPro] }));
        process.env[PROVIDER_ENV_VARS.openrouter] = 'sk-or-test-key';

        const resolved = await resolveChatModel('~deepseek/deepseek-pro-latest', 'max');

        // Exercises the documented type-assertion in buildProviderOptions: the installed
        // SDK's own type excludes "max" from reasoning.effort, but OpenRouter's live data
        // reports it as real for some models (this one included) - see that function's
        // own comment in ../../src/lib/models.ts.
        expect(resolved.providerOptions).toEqual({ openrouter: { reasoning: { effort: 'max' } } });
    });

    test('drops an effort the resolved OpenRouter model does not support, rather than sending it', async () => {
        mockFetch(async () => jsonResponse({ data: [nemotron] })); // nemotron: supportedEffortLevels is []
        process.env[PROVIDER_ENV_VARS.openrouter] = 'sk-or-test-key';

        const resolved = await resolveChatModel('nvidia/nemotron-3.5-lightning:free', 'high');

        expect(resolved.providerOptions).toBeUndefined();
    });
});
