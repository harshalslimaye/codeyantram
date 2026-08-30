import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { PROVIDER_ENV_VARS, SUPPORTED_PROVIDERS } from '@codeyantram/shared';
import { MissingCredentialsError, resolveChatModel } from '../../src/lib/models';

const originalEnv: Record<string, string | undefined> = {};

beforeEach(() => {
    for (const provider of SUPPORTED_PROVIDERS) {
        const envVar = PROVIDER_ENV_VARS[provider];
        originalEnv[envVar] = process.env[envVar];
        delete process.env[envVar];
    }
});

afterEach(() => {
    for (const [envVar, value] of Object.entries(originalEnv)) {
        if (value === undefined) delete process.env[envVar];
        else process.env[envVar] = value;
    }
});

describe('resolveChatModel', () => {
    test('throws MissingCredentialsError when the model\'s provider has no key', () => {
        expect(() => resolveChatModel('claude-sonnet-5', undefined)).toThrow(MissingCredentialsError);
    });

    test('the thrown error names the provider that is missing a key', () => {
        expect.assertions(2);
        try {
            resolveChatModel('gpt-5.4', undefined);
        } catch (error) {
            expect(error).toBeInstanceOf(MissingCredentialsError);
            expect((error as MissingCredentialsError).provider).toBe('openai');
        }
    });

    test('builds a language model once a key is available, with no providerOptions when effort is omitted', () => {
        process.env[PROVIDER_ENV_VARS.anthropic] = 'sk-test-key';

        const resolved = resolveChatModel('claude-sonnet-5', undefined);

        expect(resolved.model.id).toBe('claude-sonnet-5');
        expect(resolved.languageModel).toBeDefined();
        expect(resolved.providerOptions).toBeUndefined();
    });

    test('maps effort to providerOptions.anthropic.effort for an Anthropic model', () => {
        process.env[PROVIDER_ENV_VARS.anthropic] = 'sk-test-key';

        const resolved = resolveChatModel('claude-sonnet-5', 'high');

        expect(resolved.providerOptions).toEqual({ anthropic: { effort: 'high' } });
    });

    test('maps effort to providerOptions.openai.reasoningEffort for an OpenAI model', () => {
        process.env[PROVIDER_ENV_VARS.openai] = 'sk-test-key';

        const resolved = resolveChatModel('gpt-5.4', 'medium');

        expect(resolved.providerOptions).toEqual({ openai: { reasoningEffort: 'medium' } });
    });

    test('maps effort to providerOptions.google.thinkingLevel for a Google model', () => {
        process.env[PROVIDER_ENV_VARS.google] = 'test-key';

        const resolved = resolveChatModel('gemini-3.5-flash', 'low');

        expect(resolved.providerOptions).toEqual({ google: { thinkingLevel: 'low' } });
    });
});
