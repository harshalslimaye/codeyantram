import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getOrCreateServerToken, type ChatStreamEvent } from '@codeyantram/shared';
import { app } from '../../src/index';
import { SERVER_TOKEN_HEADER } from '../../src/lib/server-auth';

const ORIGINAL_CONFIG_DIR_OVERRIDE = process.env.CODEYANTRAM_CONFIG_DIR;
let tempDir: string | null = null;

beforeEach(() => {
    delete process.env.CODEYANTRAM_CONFIG_DIR;
});

afterEach(() => {
    if (ORIGINAL_CONFIG_DIR_OVERRIDE === undefined) delete process.env.CODEYANTRAM_CONFIG_DIR;
    else process.env.CODEYANTRAM_CONFIG_DIR = ORIGINAL_CONFIG_DIR_OVERRIDE;

    if (tempDir !== null) {
        rmSync(tempDir, { recursive: true, force: true });
        tempDir = null;
    }
});

/** Turns enforcement on for one test by pointing at a real temp config dir (the same
 * escape hatch every other real-I/O test in this codebase uses - see
 * shared/__tests__/server-token.test.ts), then mints and returns the token that will be
 * enforced. */
function enableEnforcement(): string {
    tempDir = mkdtempSync(join(tmpdir(), 'codeyantram-server-auth-test-'));
    process.env.CODEYANTRAM_CONFIG_DIR = tempDir;
    return getOrCreateServerToken();
}

/** Parses an SSE response body back into the JSON events written to it - same shape as
 * routers/chat.test.ts's own helper, since this is the identical wire format. */
function parseSseEvents(body: string): ChatStreamEvent[] {
    return body
        .split('\n\n')
        .filter(chunk => chunk.startsWith('data:'))
        .map(chunk => JSON.parse(chunk.slice('data:'.length).trim()));
}

// Every other test file in this package (index.test.ts, routers/*.test.ts) calls
// app.request() with no auth header at all, exactly like these do - this section is
// what actually proves that keeps working, rather than leaving it as an assumption
// implicit in "the rest of the suite didn't need to change".
describe('without CODEYANTRAM_CONFIG_DIR (enforcement off - the default bun test run)', () => {
    test('GET /health succeeds with no token header', async () => {
        const res = await app.request('/health');
        expect(res.status).toBe(200);
    });

    test('GET /providers succeeds with no token header', async () => {
        const res = await app.request('/providers');
        expect(res.status).toBe(200);
    });

    test('POST /chat reaches its own validation (not the auth gate) with no token header', async () => {
        const res = await app.request('/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: 'not-a-real-model', messages: [] }),
        });
        // 400 from chatRequestSchema, not the auth gate's own SSE-shaped failure -
        // proves the request passed straight through requireServerToken().
        expect(res.status).toBe(400);
    });
});

describe('with CODEYANTRAM_CONFIG_DIR set (real enforcement)', () => {
    test('GET /health without a token is refused', async () => {
        enableEnforcement();
        const res = await app.request('/health');

        expect(res.status).toBe(401);
        expect(await res.json()).toMatchObject({ error: expect.any(String) });
    });

    test('GET /health with the wrong token is refused', async () => {
        enableEnforcement();
        const res = await app.request('/health', { headers: { [SERVER_TOKEN_HEADER]: 'not-the-real-token' } });

        expect(res.status).toBe(401);
    });

    test('GET /health with the correct token succeeds', async () => {
        const token = enableEnforcement();
        const res = await app.request('/health', { headers: { [SERVER_TOKEN_HEADER]: token } });

        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ status: 'ok' });
    });

    test('GET /providers without a token is refused', async () => {
        enableEnforcement();
        const res = await app.request('/providers');

        expect(res.status).toBe(401);
    });

    test('GET /providers with the correct token succeeds', async () => {
        const token = enableEnforcement();
        const res = await app.request('/providers', { headers: { [SERVER_TOKEN_HEADER]: token } });

        expect(res.status).toBe(200);
    });

    test('POST /chat without a token gets a "start" then "error" SSE stream, not an HTTP error status', async () => {
        enableEnforcement();
        const res = await app.request('/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: 'claude-sonnet-5', messages: [], agent: 'Talk', cwd: '/repo' }),
        });

        // The transport-level status is 200, same as chat-stream.ts's own
        // missing_credentials case - the failure lives inside the stream, not the
        // HTTP status, so the CLI's existing chat client needs no special case for it.
        expect(res.status).toBe(200);

        const events = parseSseEvents(await res.text());
        expect(events[0]).toEqual({ type: 'start', messageId: expect.any(String) });
        expect(events[1]).toEqual({
            type: 'error',
            code: 'invalid_request',
            message: expect.stringContaining('server token'),
        });
    });

    test('POST /chat with the correct token reaches chatRequestSchema validation, not the auth gate', async () => {
        const token = enableEnforcement();
        const res = await app.request('/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', [SERVER_TOKEN_HEADER]: token },
            // Deliberately invalid per chatRequestSchema (unknown model, empty messages) -
            // a plain 400 here proves the auth gate let the request through to the
            // router's own validation, rather than intercepting it first.
            body: JSON.stringify({ model: 'not-a-real-model', messages: [] }),
        });

        expect(res.status).toBe(400);
    });
});
