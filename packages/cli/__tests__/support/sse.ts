/** Bun's `fetch` type carries extra static members (e.g. `preconnect`) a plain mock function never has - one cast through `unknown` here instead of at every call site. */
export function mockFetch(impl: (...args: Parameters<typeof fetch>) => ReturnType<typeof fetch>): void {
    global.fetch = impl as unknown as typeof fetch;
}

/**
 * Like mockFetch, but scoped to the /chat endpoint. Any test that mounts a real
 * ChatProvider and sends a message now also exercises useSessionAutosave in the
 * background - creating a session, then appending to it - since that's wired into
 * sendMessage/the "done" handler/respondToApproval, not something a test opts into
 * separately. A test written to check /chat's own behavior shouldn't need to know that,
 * or provide its own session-endpoint responses: anything requested that isn't /chat
 * gets one canned success shape here, chosen to satisfy every schema autosave's calls
 * validate against at once (createSessionResponseSchema's `id`/`title`,
 * sessionActionResponseSchema's `ok`) regardless of which of create/append/approve is
 * actually in flight - so those calls quietly succeed instead of erroring and firing a
 * "not saved" toast the test never asked to think about.
 *
 * A test that specifically wants to exercise autosave's own behavior
 * (session-autosave.test.tsx) uses the plain mockFetch above instead, since it needs
 * real control over what the session endpoints return.
 */
export function mockChatFetch(chatImpl: (...args: Parameters<typeof fetch>) => ReturnType<typeof fetch>): void {
    global.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
        if (url.includes('/chat')) return chatImpl(input, init);

        return new Response(JSON.stringify({ id: 'test-session', title: 'a session', ok: true }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
        });
    }) as unknown as typeof fetch;
}

/** Builds a Response whose body streams the given chunks of already-SSE-formatted text, then closes. */
export function sseResponse(chunks: string[], init?: ResponseInit): Response {
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
        start(controller) {
            for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
            controller.close();
        },
    });

    return new Response(body, { status: 200, ...init });
}

/** An SSE response whose body the caller controls chunk-by-chunk, for tests that need to pause a stream mid-flight rather than have it resolve instantly. */
export function pendingSseResponse(init?: ResponseInit): {
    response: Response;
    push: (chunk: string) => void;
    close: () => void;
    /**
     * Wires this response's body to reject with an AbortError once `signal`
     * fires - a real fetch()'d response body does this on its own; this
     * hand-built one doesn't unless told to. Call from the mocked fetch
     * implementation with the `init.signal` it receives.
     */
    abortOn: (signal: AbortSignal | null | undefined) => void;
} {
    const encoder = new TextEncoder();
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    const body = new ReadableStream<Uint8Array>({
        start(c) {
            controller = c;
        },
    });

    return {
        response: new Response(body, { status: 200, ...init }),
        push: chunk => controller.enqueue(encoder.encode(chunk)),
        close: () => controller.close(),
        abortOn: signal => {
            signal?.addEventListener('abort', () => {
                controller.error(new DOMException('The operation was aborted.', 'AbortError'));
            });
        },
    };
}
