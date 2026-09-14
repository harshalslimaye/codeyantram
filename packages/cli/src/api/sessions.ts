import type { z } from 'zod';
import {
    createSessionResponseSchema,
    getSessionResponseSchema,
    listSessionsResponseSchema,
    sessionActionResponseSchema,
    type ChatMessage,
    type CreateSessionRequest,
    type Session,
    type SessionSummary,
} from '@codeyantram/shared';
import { getApiClient } from './client';

/**
 * Thrown by every function in this file on any failure - network-level (couldn't reach
 * the server at all, `status` is undefined), HTTP-level (the server responded but
 * refused or errored, `status` is its code), or a response that doesn't match the shape
 * @codeyantram/shared's schemas promise (also carries the response's own status, if
 * there was one). One error type regardless of which of those it was, so a caller only
 * ever needs one catch clause - the same reasoning streamChat's own single "error" event
 * shape follows for /chat, adapted to a plain REST client that has no stream to fold
 * failures into instead.
 */
export class SessionApiError extends Error {
    constructor(
        message: string,
        public readonly status?: number,
    ) {
        super(message);
        this.name = 'SessionApiError';
    }
}

/** The slice of `Response` this file actually reads. Hono's own per-route
 * `ClientResponse<...>` return types are structurally narrower than DOM's `Response`
 * (they're missing newer, unrelated properties like `textStream`), so these two helpers
 * are typed against only what they use rather than the literal `Response` type - every
 * one of the seven RPC calls below satisfies this regardless of its own specific,
 * route-inferred response type. */
type ReadableResponse = {
    readonly ok: boolean;
    readonly status: number;
    text(): Promise<string>;
    json(): Promise<unknown>;
};

/** Runs `fn` (a Hono RPC call) and turns a network-level failure - fetch itself
 * rejecting, the server unreachable - into a SessionApiError with no status, the same
 * way streamChat's own try/catch around getApiClient().chat.$post already does for
 * /chat. Kept separate from parseResponse below because this is the one failure mode
 * that never produces a Response to inspect at all. */
async function request<R extends ReadableResponse>(fn: () => Promise<R>, context: string): Promise<R> {
    try {
        return await fn();
    } catch (error) {
        throw new SessionApiError(`${context}: ${error instanceof Error ? error.message : 'network error'}`);
    }
}

/** Validates a successful response's JSON body against `schema`, or throws
 * SessionApiError for a non-ok status, an unparseable body, or one that parses but
 * doesn't match the schema - three different failure modes, one exception type, so a
 * caller never needs to tell them apart to just report "the save failed". */
async function parseResponse<T>(res: ReadableResponse, schema: z.ZodType<T>, context: string): Promise<T> {
    if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new SessionApiError(`${context} failed with status ${res.status}${body ? `: ${body}` : ''}`, res.status);
    }

    let json: unknown;
    try {
        json = await res.json();
    } catch (error) {
        throw new SessionApiError(
            `${context}: response was not valid JSON (${error instanceof Error ? error.message : String(error)})`,
            res.status,
        );
    }

    const result = schema.safeParse(json);
    if (!result.success) {
        throw new SessionApiError(`${context}: response did not match the expected shape (${result.error.message})`, res.status);
    }
    return result.data;
}

/** Creates a session and its first message atomically (see @codeyantram/sessions'
 * createSession) and returns the new session's id. */
export async function createSession(body: CreateSessionRequest): Promise<string> {
    const res = await request(() => getApiClient().sessions.$post({ json: body }), 'Failed to create session');
    const { id } = await parseResponse(res, createSessionResponseSchema, 'Failed to create session');
    return id;
}

/** Every session for `project`, newest updated_at first - no messages, matching what
 * the picker (Phase 5) actually needs to draw its rows. */
export async function listSessions(project: string): Promise<SessionSummary[]> {
    const res = await request(() => getApiClient().sessions.$get({ query: { project } }), 'Failed to list sessions');
    const { sessions } = await parseResponse(res, listSessionsResponseSchema, 'Failed to list sessions');
    return sessions;
}

/** The full session, messages included. Null specifically for "no session with this id" -
 * not an exception, preserving the same "not found is a legitimate answer, not a
 * failure" contract @codeyantram/sessions' own loadSession already has (a stale
 * --resume argument is exactly this, not a broken server call). Anything else that goes
 * wrong (network, a non-404 status, a malformed body) still throws SessionApiError. */
export async function loadSession(id: string): Promise<Session | null> {
    const res = await request(() => getApiClient().sessions[':id'].$get({ param: { id } }), `Failed to load session ${id}`);
    if (res.status === 404) return null;
    const { session } = await parseResponse(res, getSessionResponseSchema, `Failed to load session ${id}`);
    return session;
}

/** Appends one already-finished message. Unlike loadSession, a 404 here throws rather
 * than resolving quietly - appending to a session is a command, not a query, and a
 * missing session at this point (deleted out from under an in-flight turn, say) is a
 * genuine failure the caller (Phase 4's autosave) needs to know about, not an expected
 * outcome to treat as a no-op. */
export async function appendMessage(id: string, message: ChatMessage): Promise<void> {
    const res = await request(
        () => getApiClient().sessions[':id'].messages.$post({ param: { id }, json: { message } }),
        `Failed to save message to session ${id}`,
    );
    await parseResponse(res, sessionActionResponseSchema, `Failed to save message to session ${id}`);
}

/** Resolves a pending tool-call approval. Same "404 is a real failure" reasoning as
 * appendMessage - see @codeyantram/sessions' resolveApproval for what a 404 here
 * actually distinguishes (no such session vs. no such tool call), which the router folds
 * into the same status either way (see errorResponse in routers/sessions.ts). */
export async function resolveApproval(id: string, toolCallId: string, approved: boolean): Promise<void> {
    const res = await request(
        () => getApiClient().sessions[':id'].approvals.$post({ param: { id }, json: { toolCallId, approved } }),
        `Failed to resolve approval in session ${id}`,
    );
    await parseResponse(res, sessionActionResponseSchema, `Failed to resolve approval in session ${id}`);
}

export async function renameSession(id: string, title: string): Promise<void> {
    const res = await request(
        () => getApiClient().sessions[':id'].$patch({ param: { id }, json: { title } }),
        `Failed to rename session ${id}`,
    );
    await parseResponse(res, sessionActionResponseSchema, `Failed to rename session ${id}`);
}

export async function deleteSession(id: string): Promise<void> {
    const res = await request(() => getApiClient().sessions[':id'].$delete({ param: { id } }), `Failed to delete session ${id}`);
    await parseResponse(res, sessionActionResponseSchema, `Failed to delete session ${id}`);
}
