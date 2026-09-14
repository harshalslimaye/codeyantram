/** Thrown by any store operation addressed at a session id that doesn't exist - a
 * dedicated, catchable type rather than a generic Error so a caller (the session router,
 * from Phase 3 on) can map it to a 404 without string-matching a message. */
export class SessionNotFoundError extends Error {
    constructor(public readonly sessionId: string) {
        super(`No session found with id ${sessionId}`);
        this.name = 'SessionNotFoundError';
    }
}

/** Thrown by resolveApproval when no message in the session carries a pending tool-call
 * part with the given toolCallId - either it was already resolved, or the id is wrong. */
export class ToolCallNotFoundError extends Error {
    constructor(
        public readonly sessionId: string,
        public readonly toolCallId: string,
    ) {
        super(`No tool call ${toolCallId} found in session ${sessionId}`);
        this.name = 'ToolCallNotFoundError';
    }
}

/** Thrown by renameSession for an empty or whitespace-only title - the caller sent a
 * value the wire schema's own `.min(1)` can't catch (a non-empty string that's still
 * empty once trimmed), not a missing session. A dedicated type for the same reason as
 * the two above: the session router needs to tell "bad input" (400) from "no such
 * session" (404) without string-matching a message. */
export class InvalidTitleError extends Error {
    constructor() {
        super('Session title cannot be empty');
        this.name = 'InvalidTitleError';
    }
}
