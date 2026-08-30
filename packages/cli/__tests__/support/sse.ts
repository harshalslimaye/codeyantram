/** Bun's `fetch` type carries extra static members (e.g. `preconnect`) a plain mock function never has - one cast through `unknown` here instead of at every call site. */
export function mockFetch(impl: (...args: Parameters<typeof fetch>) => ReturnType<typeof fetch>): void {
    global.fetch = impl as unknown as typeof fetch;
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
