import type { Context, MiddlewareHandler, Next } from 'hono';
import { streamSSE } from 'hono/streaming';
import { API_ROUTES, getOrCreateServerToken, isServerTokenEnforced } from '@codeyantram/shared';

/** Header the CLI sends its copy of the server's token in - the one name both sides need
 * to agree on (see cli/src/api/chat.ts). */
export const SERVER_TOKEN_HEADER = 'x-codeyantram-token';

const UNAUTHORIZED_MESSAGE =
    'Missing or invalid server token. Make sure the CLI and server were started against the same ~/.codeyantram (or CODEYANTRAM_CONFIG_DIR).';

/**
 * Gates every route behind the server's own local token (see @codeyantram/shared's
 * server-token.ts). Binding to loopback (see index.ts's `hostname`) only keeps *other
 * machines* out - anything already running on this one can still reach 127.0.0.1, and
 * the token is what a different user's process (or a browser tab, or a stray script) on
 * the same machine can't produce, since it never sees the 0600 file this reads from.
 *
 * /chat gets a different failure shape than everything else, mirroring how a
 * request-time failure inside chat-stream.ts (a missing API key, say) is already
 * delivered - "start" then "error" on an SSE stream, never an HTTP error status - so the
 * CLI's chat client (streamChat, which already folds any non-ok HTTP response into that
 * same shape) never needs a second failure-handling branch just for this. Every other
 * route (currently /health and /providers, both plain JSON) gets an ordinary 401.
 * "invalid_request" is reused rather than adding a new ChatErrorCode - a request the
 * server won't process because it doesn't satisfy the server's requirements is exactly
 * what that code already means to callers, and chatRequestSchema's own validation
 * failures (see routers/chat.ts) already use the same status/code pairing for the same
 * reason.
 *
 * A plain string comparison, not constant-time: the actual defense here is the token
 * file's own 0600 permission plus loopback binding, not resistance to a timing attack
 * from a local process willing to send this server thousands of guesses - a threat model
 * this local, single-user tool doesn't need to design against.
 */
export function requireServerToken(): MiddlewareHandler {
    return async (c: Context, next: Next) => {
        if (!isServerTokenEnforced()) {
            await next();
            return;
        }

        const expected = getOrCreateServerToken();
        const provided = c.req.header(SERVER_TOKEN_HEADER);
        if (provided === expected) {
            await next();
            return;
        }

        if (c.req.path.startsWith(API_ROUTES.chat)) {
            return streamSSE(c, async stream => {
                await stream.writeSSE({ data: JSON.stringify({ type: 'start', messageId: crypto.randomUUID() }) });
                await stream.writeSSE({
                    data: JSON.stringify({ type: 'error', code: 'invalid_request', message: UNAUTHORIZED_MESSAGE }),
                });
            });
        }

        return c.json({ error: UNAUTHORIZED_MESSAGE }, 401);
    };
}
