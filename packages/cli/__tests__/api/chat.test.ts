import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getOrCreateServerToken, type ChatRequest } from '@codeyantram/shared';
import { streamChat } from '../../src/api/chat';
import { mockFetch, sseResponse } from '../support/sse';

const originalFetch = global.fetch;
const ORIGINAL_CONFIG_DIR_OVERRIDE = process.env.CODEYANTRAM_CONFIG_DIR;
let tempDir: string | null = null;

afterEach(() => {
    global.fetch = originalFetch;

    if (ORIGINAL_CONFIG_DIR_OVERRIDE === undefined) delete process.env.CODEYANTRAM_CONFIG_DIR;
    else process.env.CODEYANTRAM_CONFIG_DIR = ORIGINAL_CONFIG_DIR_OVERRIDE;

    if (tempDir !== null) {
        rmSync(tempDir, { recursive: true, force: true });
        tempDir = null;
    }
});

const request: ChatRequest = {
    model: 'claude-sonnet-5',
    messages: [{ id: '1', role: 'user', parts: [{ type: 'text', text: 'hi' }] }],
    agent: 'Talk',
    cwd: '/repo',
};

async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
    const results: T[] = [];
    for await (const item of iterable) results.push(item);
    return results;
}

describe('streamChat', () => {
    beforeEach(() => {
        mockFetch(async () => {
            throw new Error('fetch should be mocked per-test');
        });
    });

    test('yields events parsed out of a well-formed SSE stream, even split mid-record across chunks', async () => {
        mockFetch(async () =>
            sseResponse([
                'data: {"type":"start","messageId":"m1"}\n\n',
                'data: {"type":"text-delta","te',
                'xt":"hello"}\n\n',
                'data: {"type":"done","durationMs":42}\n\n',
            ]),
        );

        const events = await collect(streamChat({ request }));

        expect(events).toEqual([
            { type: 'start', messageId: 'm1' },
            { type: 'text-delta', text: 'hello' },
            { type: 'done', durationMs: 42 },
        ]);
    });

    test('skips a line that is not valid JSON rather than throwing', async () => {
        mockFetch(async () =>
            sseResponse(['data: not json at all\n\n', 'data: {"type":"text-delta","text":"ok"}\n\n']),
        );

        const events = await collect(streamChat({ request }));

        expect(events).toEqual([{ type: 'text-delta', text: 'ok' }]);
    });

    test('skips a line that is valid JSON but does not match the schema', async () => {
        mockFetch(async () =>
            sseResponse([
                'data: {"type":"not-a-real-event"}\n\n',
                'data: {"type":"text-delta","text":"ok"}\n\n',
            ]),
        );

        const events = await collect(streamChat({ request }));

        expect(events).toEqual([{ type: 'text-delta', text: 'ok' }]);
    });

    test('yields one internal_error event when the fetch itself rejects', async () => {
        mockFetch(async () => {
            throw new Error('network is down');
        });

        const events = await collect(streamChat({ request }));

        expect(events).toEqual([{ type: 'error', code: 'internal_error', message: 'network is down' }]);
    });

    test('yields one internal_error event on a non-OK response', async () => {
        mockFetch(async () => new Response('server exploded', { status: 500 }));

        const events = await collect(streamChat({ request }));

        expect(events).toEqual([{ type: 'error', code: 'internal_error', message: 'server exploded' }]);
    });

    test('stops reading after a "done" event, ignoring anything the server sends afterward', async () => {
        mockFetch(async () =>
            sseResponse([
                'data: {"type":"done","durationMs":1}\n\n',
                'data: {"type":"text-delta","text":"should never be seen"}\n\n',
            ]),
        );

        const events = await collect(streamChat({ request }));

        expect(events).toEqual([{ type: 'done', durationMs: 1 }]);
    });

    test('stops reading after an "error" event, ignoring anything the server sends afterward', async () => {
        mockFetch(async () =>
            sseResponse([
                'data: {"type":"error","code":"provider_error","message":"boom"}\n\n',
                'data: {"type":"text-delta","text":"should never be seen"}\n\n',
            ]),
        );

        const events = await collect(streamChat({ request }));

        expect(events).toEqual([{ type: 'error', code: 'provider_error', message: 'boom' }]);
    });

    test('ends with no events when the signal is already aborted and fetch rejects accordingly', async () => {
        const controller = new AbortController();
        controller.abort();

        mockFetch(async () => {
            throw new DOMException('The operation was aborted', 'AbortError');
        });

        const events = await collect(streamChat({ request, signal: controller.signal }));

        expect(events).toEqual([]);
    });
});

describe('the server token header', () => {
    test('sends the real token once one has actually been minted for this config dir', async () => {
        tempDir = mkdtempSync(join(tmpdir(), 'codeyantram-chat-client-test-'));
        process.env.CODEYANTRAM_CONFIG_DIR = tempDir;
        const token = getOrCreateServerToken();

        let sentToken: string | null | undefined;
        mockFetch(async (_url, init) => {
            sentToken = (init?.headers as Headers).get('x-codeyantram-token');
            return sseResponse(['data: {"type":"done","durationMs":1}\n\n']);
        });

        await collect(streamChat({ request }));

        expect(sentToken).toBe(token);
    });

    test('sends an empty token when none has been minted yet for this config dir - the server rejects it as any other missing/wrong token, not a special case', async () => {
        tempDir = mkdtempSync(join(tmpdir(), 'codeyantram-chat-client-test-'));
        process.env.CODEYANTRAM_CONFIG_DIR = tempDir; // real config dir, but nothing has written a token into it yet

        let sentToken: string | null | undefined;
        mockFetch(async (_url, init) => {
            sentToken = (init?.headers as Headers).get('x-codeyantram-token');
            return sseResponse(['data: {"type":"done","durationMs":1}\n\n']);
        });

        await collect(streamChat({ request }));

        expect(sentToken).toBe('');
    });
});
