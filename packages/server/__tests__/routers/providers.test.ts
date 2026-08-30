import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { PROVIDER_ENV_VARS, SUPPORTED_PROVIDERS } from '@codeyantram/shared';
import { app } from '../../src/index';

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

describe('GET /providers', () => {
    test('reports no providers configured when no keys are set', async () => {
        const res = await app.request('/providers');

        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ configuredProviders: [] });
    });

    test('reports a provider once its env var is set', async () => {
        process.env[PROVIDER_ENV_VARS.anthropic] = 'sk-test-key';
        const res = await app.request('/providers');

        expect(await res.json()).toEqual({ configuredProviders: ['anthropic'] });
    });
});
