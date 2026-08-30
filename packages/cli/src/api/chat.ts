import { hc } from 'hono/client';
import type { AppType } from '@codeyantram/server';
import { chatStreamEventSchema, type ChatRequest, type ChatStreamEvent } from '@codeyantram/shared';

// Matches the server's own default (packages/server/src/index.ts) so a
// fresh checkout works without any .env at all.
const DEFAULT_BASE_URL = 'http://localhost:3001';

export function getServerBaseUrl(): string {
    return process.env.API_URL ?? DEFAULT_BASE_URL;
}

// AppType is a type-only import (see package.json: @codeyantram/server is a
// devDependency, never a runtime one) - hc<AppType>() gets full route/body
// typing for free without the CLI depending on the server at runtime.
function getClient() {
    return hc<AppType>(getServerBaseUrl());
}

/**
 * Splits a growing text buffer on SSE record boundaries ("\n\n"), returning
 * every complete "data:" line found as a parsed ChatStreamEvent and the
 * trailing partial record to prepend to the next chunk. A line that isn't
 * valid JSON, or doesn't match the schema, is skipped rather than thrown -
 * this is a long-lived stream, and one bad line shouldn't end it.
 */
function parseSseChunk(buffer: string): { events: ChatStreamEvent[]; rest: string } {
    const records = buffer.split('\n\n');
    const rest = records.pop() ?? '';

    const events: ChatStreamEvent[] = [];
    for (const record of records) {
        for (const line of record.split('\n')) {
            if (!line.startsWith('data:')) continue;

            const json = line.slice('data:'.length).trim();
            if (json === '') continue;

            try {
                const parsed = chatStreamEventSchema.safeParse(JSON.parse(json));
                if (parsed.success) events.push(parsed.data);
            } catch {
                // Malformed JSON on this line - skip it, same as a failed schema parse.
            }
        }
    }

    return { events, rest };
}

/**
 * Streams one chat turn from the server as parsed ChatStreamEvents. Mirrors
 * the server's own "one path for success and failure" design: a request
 * that never reaches the server, or fails before streaming starts, yields a
 * single synthetic `error`/`internal_error` event instead of throwing, so
 * callers only ever need to consume events. An aborted `signal` ends the
 * generator silently, with no event - consistent with chatStreamEventSchema's
 * own convention that a closed connection with no `done`/`error` is a normal
 * cancellation, not a failure.
 */
export async function* streamChat({
    request,
    signal,
}: {
    request: ChatRequest;
    signal?: AbortSignal;
}): AsyncGenerator<ChatStreamEvent> {
    let response: Awaited<ReturnType<ReturnType<typeof getClient>['chat']['$post']>>;
    try {
        response = await getClient().chat.$post({ json: request }, { init: { signal } });
    } catch (error) {
        if (signal?.aborted) return;
        yield {
            type: 'error',
            code: 'internal_error',
            message: error instanceof Error ? error.message : 'Network error',
        };
        return;
    }

    if (!response.ok || response.body === null) {
        const message = await response.text().catch(() => '');
        yield {
            type: 'error',
            code: 'internal_error',
            message: message || `Request failed with status ${response.status}`,
        };
        return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const { events, rest } = parseSseChunk(buffer);
            buffer = rest;

            for (const event of events) {
                yield event;
                // "done"/"error" are terminal on the wire (chatStreamEventSchema);
                // stop reading rather than relying on the server to also close
                // the connection right after sending one.
                if (event.type === 'done' || event.type === 'error') return;
            }
        }
    } catch (error) {
        if (signal?.aborted) return;
        yield {
            type: 'error',
            code: 'internal_error',
            message: error instanceof Error ? error.message : 'Stream read error',
        };
    } finally {
        reader.releaseLock();
    }
}
