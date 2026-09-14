// Bun's `bun run <file>` entry-point convention - a default-exported `{ fetch, port,
// hostname }` - only fires when the file is executed directly by the `bun` binary; it does
// nothing for an imported module and nothing at all under Node. Making "start listening" an
// explicit call (rather than a magic export shape) lets the same compiled output boot under
// either runtime: `Bun.serve()` when Bun is present, `@hono/node-server`'s `serve()`
// otherwise. Neither dependency is imported unconditionally at module scope, so this file
// costs nothing to load under the runtime it isn't using.

export interface RuntimeServerHandle {
    /** Stops accepting new connections and resolves once the listener is fully closed. */
    close(): Promise<void>;
}

export interface ServeOptions {
    port: number;
    hostname: string;
}

type FetchHandler = (request: Request) => Response | Promise<Response>;

export async function serveApp(fetch: FetchHandler, options: ServeOptions): Promise<RuntimeServerHandle> {
    if (typeof Bun !== 'undefined') {
        const server = Bun.serve({
            fetch,
            port: options.port,
            hostname: options.hostname,
        });
        return {
            // Bun.serve()'s .stop() is synchronous and returns void, not a promise - wrapped
            // here purely so callers on both runtimes see the same async close() shape.
            close: async () => {
                server.stop();
            },
        };
    }

    // Dynamic import: this branch's only Node-only cost, and it's paid at most once, only
    // when Bun isn't the runtime - a plain `bun run` process never touches this line.
    const { serve } = await import('@hono/node-server');
    const server = serve({
        fetch,
        port: options.port,
        hostname: options.hostname,
    });
    return {
        close: () =>
            new Promise<void>((resolve, reject) => {
                server.close(error => (error ? reject(error) : resolve()));
            }),
    };
}
