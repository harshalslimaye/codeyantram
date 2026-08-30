import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { ChatRequest } from '@codeyantram/shared';
import { streamChat } from '../../src/api/chat';
import { mockFetch, sseResponse } from '../support/sse';

const originalFetch = global.fetch;

afterEach(() => {
    global.fetch = originalFetch;
});

const request: ChatRequest = {
    model: 'claude-sonnet-5',
    messages: [{ id: '1', role: 'user', parts: [{ type: 'text', text: 'hi' }] }],
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
