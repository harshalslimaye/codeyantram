import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { PROVIDER_ENV_VARS, SUPPORTED_PROVIDERS, type ChatStreamEvent } from '@codeyantram/shared';
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

/** Parses the SSE body back into the JSON events streamChatResponse wrote. */
function parseSseEvents(body: string): ChatStreamEvent[] {
    return body
        .split('\n\n')
        .filter(chunk => chunk.startsWith('data:'))
        .map(chunk => JSON.parse(chunk.slice('data:'.length).trim()));
}

describe('POST /chat', () => {
    test('rejects a malformed request body', async () => {
        const res = await app.request('/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: 'not-a-real-model', messages: [] }),
        });

        expect(res.status).toBe(400);
    });

    test('streams a missing_credentials error when the model\'s provider has no key', async () => {
        const res = await app.request('/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: 'claude-sonnet-5',
                messages: [{ id: '1', role: 'user', parts: [{ type: 'text', text: 'hi' }] }],
            }),
        });

        expect(res.status).toBe(200);
        const events = parseSseEvents(await res.text());

        expect(events[0]).toEqual({ type: 'start', messageId: expect.any(String) });
        expect(events[1]).toEqual({
            type: 'error',
            code: 'missing_credentials',
            message: expect.stringContaining('ANTHROPIC_API_KEY'),
        });
    });
});
