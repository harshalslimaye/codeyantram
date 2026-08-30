import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { PROVIDER_ENV_VARS, SUPPORTED_PROVIDERS } from '@codeyantram/shared';
import { getUsableProviders, resolveApiKey } from '../../src/providers';

// The dev .env this repo loads for `bun test` may itself carry a real key
// (e.g. ANTHROPIC_API_KEY), so every test here clears all three vars first
// and restores them afterward rather than assuming a clean environment.
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

describe('resolveApiKey', () => {
    test('returns undefined when no env var is set (auth.json is unreadable in tests)', () => {
        expect(resolveApiKey('anthropic')).toBeUndefined();
    });

    test('falls back to the provider env var', () => {
        process.env[PROVIDER_ENV_VARS.openai] = 'sk-test-key';
        expect(resolveApiKey('openai')).toBe('sk-test-key');
    });
});

describe('getUsableProviders', () => {
    test('is empty with no keys configured', () => {
        expect(getUsableProviders()).toEqual([]);
    });

    test('lists only providers with an env var set', () => {
        process.env[PROVIDER_ENV_VARS.google] = 'test-key';
        expect(getUsableProviders()).toEqual(['google']);
    });
});
