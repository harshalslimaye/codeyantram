import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
                agent: 'Talk',
                cwd: '/repo',
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

    describe('project instructions on the start event', () => {
        let projectDir: string;

        beforeEach(() => {
            projectDir = mkdtempSync(join(tmpdir(), 'codeyantram-chat-router-'));
        });

        afterEach(() => {
            rmSync(projectDir, { recursive: true, force: true });
        });

        // No API key is configured (see the outer beforeEach), so every case here hits the
        // same missing_credentials fast path as the test above - the "start" event is sent
        // before model resolution regardless, so this is enough to exercise it without a
        // real model call.
        function chatBody(overrides: Record<string, unknown>) {
            return JSON.stringify({
                model: 'claude-sonnet-5',
                messages: [{ id: '1', role: 'user', parts: [{ type: 'text', text: 'hi' }] }],
                agent: 'Talk',
                cwd: projectDir,
                ...overrides,
            });
        }

        test('carries filename/bytes/truncated when the project has an AGENTS.md', async () => {
            writeFileSync(join(projectDir, 'AGENTS.md'), 'be nice to the user');

            const res = await app.request('/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: chatBody({}),
            });
            const events = parseSseEvents(await res.text());

            expect(events[0]).toEqual({
                type: 'start',
                messageId: expect.any(String),
                projectInstructions: { filename: 'AGENTS.md', bytes: expect.any(Number), truncated: false },
            });
        });

        test('omits the field when the project has no instruction file', async () => {
            const res = await app.request('/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: chatBody({}),
            });
            const events = parseSseEvents(await res.text());

            expect(events[0]).toEqual({ type: 'start', messageId: expect.any(String) });
        });

        test('omits the field when useProjectInstructions is false, even with an AGENTS.md present', async () => {
            writeFileSync(join(projectDir, 'AGENTS.md'), 'be nice to the user');

            const res = await app.request('/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: chatBody({ useProjectInstructions: false }),
            });
            const events = parseSseEvents(await res.text());

            expect(events[0]).toEqual({ type: 'start', messageId: expect.any(String) });
        });
    });
});
