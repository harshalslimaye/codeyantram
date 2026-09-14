import type { Client, Transaction } from '@libsql/client';
import type { ChatMessage, MessagePart, UserMessage } from '@codeyantram/shared';
import { chatMessageToRowFields, parseMessageRow, parseSessionRow, rowToChatMessage, type SessionRow } from './schema';
import { deriveTitleFromMessage } from './title';
import { InvalidTitleError, SessionNotFoundError, ToolCallNotFoundError } from './errors';

// ---------------------------------------------------------------------------
// Public types
//
// These are the store's own internal shapes, not the wire contract a future HTTP layer
// exposes - Phase 3 (the session API) will define request/response schemas in `shared`
// and translate between them and these at the router, the same way the router already
// translates ChatRequest into whatever chat-stream.ts needs internally. Keeping the two
// separate means a wire-format decision (should effort ever be omitted vs. null on the
// wire?) doesn't have to be this store's decision too.
// ---------------------------------------------------------------------------

export type NewSessionInput = {
    project: string;
    modelId: string;
    agentName: string;
    effort?: string | null;
    /** The message a session opens with. Always a user message - createSession exists
     * specifically so a session row is never created without one (see chat.tsx's own
     * "never create a session for an empty conversation" rule on the CLI side). */
    firstMessage: UserMessage;
};

export type SessionSummary = {
    id: string;
    project: string;
    title: string;
    createdAt: number;
    updatedAt: number;
    modelId: string;
    agentName: string;
    effort: string | null;
    messageCount: number;
};

export type StoredSession = SessionSummary & {
    messages: ChatMessage[];
};

export type PruneOptions = {
    project: string;
    /** How many of the project's most recently updated sessions to keep regardless of
     * age. */
    keepNewest: number;
    /** Sessions older than this many days are removed even if they'd otherwise fall
     * within keepNewest - the two caps are independent triggers, not a combined
     * threshold: a session is kept only if it satisfies both. Omit to disable the age
     * cap entirely. */
    olderThanDays?: number;
    /** A session id to never prune, regardless of the two caps above - the session
     * currently open in the caller. */
    exceptSessionId?: string;
};

export interface SessionStore {
    /** Creates a session and inserts its first message atomically, so a crash between
     * the two can never leave an empty session row behind. Returns the new session's id
     * and its derived title (see title.ts) - the caller (the HTTP router) needs both to
     * answer POST /sessions without a second round trip just to learn the title it
     * computed. */
    createSession(input: NewSessionInput): Promise<{ id: string; title: string }>;
    /** Appends one already-finished message and bumps the session's updated_at, in one
     * transaction. Accepts either role - after the first message (handled by
     * createSession), a session alternates user and assistant messages through this. */
    appendMessage(sessionId: string, message: ChatMessage): Promise<void>;
    /** Finds the pending tool-call part with `toolCallId` (searching the session's
     * assistant messages newest-first) and sets its approvalStatus, bumping updated_at in
     * the same transaction. Throws ToolCallNotFoundError if no message carries it. */
    resolveApproval(sessionId: string, toolCallId: string, approved: boolean): Promise<void>;
    /** The full session, messages included, in seq order. Null if no session has this id -
     * not an error, since "does this id exist" is a legitimate question (e.g. a stale
     * --resume argument). */
    loadSession(sessionId: string): Promise<StoredSession | null>;
    /** Every session for `project`, newest updated_at first, without their messages -
     * the query the picker draws its rows from. */
    listSessions(project: string): Promise<SessionSummary[]>;
    /** Renames a session and bumps updated_at. Throws SessionNotFoundError for an
     * unknown id; throws InvalidTitleError for an empty/whitespace-only title, since a
     * session should never end up with nothing a picker row can show. */
    renameSession(sessionId: string, title: string): Promise<void>;
    /** Deletes a session; its messages cascade via the messages table's
     * ON DELETE CASCADE, which depends on the foreign_keys pragma set when the
     * connection was opened (see db.ts). Throws SessionNotFoundError for an unknown id. */
    deleteSession(sessionId: string): Promise<void>;
    /** Deletes sessions in `options.project` that fall outside the keepNewest window,
     * or past olderThanDays, whichever applies - except exceptSessionId, which is never
     * touched. Returns how many were deleted, for logging/tests. Deletes inside one
     * transaction, so a crash mid-prune can't leave it half done. */
    pruneSessions(options: PruneOptions): Promise<number>;
    /** Every distinct project with at least one session, in no particular order - what a
     * server-startup prune sweep (pruneSessions is scoped to one project at a time) needs
     * to iterate over, since the server itself has no notion of "the current project"; it
     * only ever sees whatever `cwd` each request happens to carry. */
    listProjects(): Promise<string[]>;
    /** Reclaims disk space pruneSessions' deletes freed up. A separate call, not run
     * automatically inside pruneSessions itself, because VACUUM rewrites the entire
     * database file and takes a lock incompatible with a concurrent write - worth doing
     * once, right after a startup prune actually deleted something, not after every
     * single delete/prune call this store makes over the server's lifetime. */
    vacuum(): Promise<void>;
}

function toSessionSummary(row: SessionRow, messageCount: number): SessionSummary {
    return {
        id: row.id,
        project: row.project,
        title: row.title,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        modelId: row.model_id,
        agentName: row.agent_name,
        effort: row.effort,
        messageCount,
    };
}

/** Throws SessionNotFoundError unless `sessionId` exists, as seen by `tx`. Must run
 * before any write that depends on the session already being there:
 * `messages.session_id` is a foreign key, so inserting a message for a missing session
 * fails with a raw SQLITE_CONSTRAINT error rather than the caller's own
 * SessionNotFoundError unless this check runs first - and resolveApproval can't tell "no
 * such session" from "session exists, but no message carries this tool call" without
 * checking existence up front rather than inferring it from an empty message scan. */
async function assertSessionExists(tx: Transaction, sessionId: string): Promise<void> {
    const { rows } = await tx.execute({ sql: `SELECT 1 FROM sessions WHERE id = ?`, args: [sessionId] });
    if (rows.length === 0) throw new SessionNotFoundError(sessionId);
}

/** Runs `body` inside a write transaction, committing on success and rolling back (then
 * always closing) on any failure - the one place this file's transaction boilerplate
 * lives, so createSession/appendMessage/resolveApproval/pruneSessions don't each
 * reimplement the same try/catch/finally. */
async function withTransaction<T>(db: Client, body: (tx: Transaction) => Promise<T>): Promise<T> {
    const tx = await db.transaction('write');
    try {
        const result = await body(tx);
        await tx.commit();
        return result;
    } catch (error) {
        await tx.rollback();
        throw error;
    } finally {
        tx.close();
    }
}

export function createSessionStore(db: Client): SessionStore {
    async function createSession(input: NewSessionInput): Promise<{ id: string; title: string }> {
        const id = crypto.randomUUID();
        const now = Date.now();
        const title = deriveTitleFromMessage(input.firstMessage);
        const fields = chatMessageToRowFields(input.firstMessage);

        await withTransaction(db, async tx => {
            await tx.execute({
                sql: `INSERT INTO sessions (id, project, title, created_at, updated_at, model_id, agent_name, effort)
                      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                args: [id, input.project, title, now, now, input.modelId, input.agentName, input.effort ?? null],
            });
            await tx.execute({
                sql: `INSERT INTO messages (session_id, seq, message_id, role, parts, usage, instructions)
                      VALUES (?, 0, ?, ?, ?, ?, ?)`,
                args: [id, input.firstMessage.id, fields.role, fields.parts, fields.usage, fields.instructions],
            });
        });

        return { id, title };
    }

    async function appendMessage(sessionId: string, message: ChatMessage): Promise<void> {
        const fields = chatMessageToRowFields(message);
        const now = Date.now();

        await withTransaction(db, async tx => {
            await assertSessionExists(tx, sessionId);

            const { rows } = await tx.execute({
                sql: `SELECT COALESCE(MAX(seq), -1) + 1 AS next_seq FROM messages WHERE session_id = ?`,
                args: [sessionId],
            });
            const nextSeq = Number(rows[0]?.next_seq ?? 0);

            await tx.execute({
                sql: `INSERT INTO messages (session_id, seq, message_id, role, parts, usage, instructions)
                      VALUES (?, ?, ?, ?, ?, ?, ?)`,
                args: [sessionId, nextSeq, message.id, fields.role, fields.parts, fields.usage, fields.instructions],
            });

            await tx.execute({
                sql: `UPDATE sessions SET updated_at = ? WHERE id = ?`,
                args: [now, sessionId],
            });
        });
    }

    async function resolveApproval(sessionId: string, toolCallId: string, approved: boolean): Promise<void> {
        await withTransaction(db, async tx => {
            await assertSessionExists(tx, sessionId);

            const { rows } = await tx.execute({
                sql: `SELECT seq, parts FROM messages WHERE session_id = ? AND role = 'assistant' ORDER BY seq DESC`,
                args: [sessionId],
            });

            let targetSeq: number | null = null;
            let updatedPartsJson: string | null = null;

            for (const row of rows) {
                let parts: MessagePart[];
                try {
                    parts = JSON.parse(String(row.parts)) as MessagePart[];
                } catch (error) {
                    throw new Error(
                        `Malformed parts JSON in session ${sessionId} (seq ${row.seq}): ${(error as Error).message}`,
                        { cause: error },
                    );
                }
                const index = parts.findIndex(part => part.type === 'tool-call' && part.toolCallId === toolCallId);
                if (index === -1) continue;

                const updatedParts = parts.map((part, i) =>
                    i === index ? { ...part, approvalStatus: approved ? ('approved' as const) : ('denied' as const) } : part,
                );
                targetSeq = Number(row.seq);
                updatedPartsJson = JSON.stringify(updatedParts);
                break;
            }

            if (targetSeq === null || updatedPartsJson === null) {
                throw new ToolCallNotFoundError(sessionId, toolCallId);
            }

            await tx.execute({
                sql: `UPDATE messages SET parts = ? WHERE session_id = ? AND seq = ?`,
                args: [updatedPartsJson, sessionId, targetSeq],
            });

            await tx.execute({
                sql: `UPDATE sessions SET updated_at = ? WHERE id = ?`,
                args: [Date.now(), sessionId],
            });
        });
    }

    async function loadSession(sessionId: string): Promise<StoredSession | null> {
        const sessionResult = await db.execute({
            sql: `SELECT * FROM sessions WHERE id = ?`,
            args: [sessionId],
        });
        const rawSessionRow = sessionResult.rows[0];
        if (rawSessionRow === undefined) return null;

        const sessionRow = parseSessionRow(rawSessionRow);

        const messagesResult = await db.execute({
            sql: `SELECT * FROM messages WHERE session_id = ? ORDER BY seq ASC`,
            args: [sessionId],
        });
        const messages = messagesResult.rows.map(row => rowToChatMessage(parseMessageRow(row)));

        return { ...toSessionSummary(sessionRow, messages.length), messages };
    }

    async function listSessions(project: string): Promise<SessionSummary[]> {
        const result = await db.execute({
            sql: `SELECT s.*, (SELECT COUNT(*) FROM messages m WHERE m.session_id = s.id) AS message_count
                  FROM sessions s
                  WHERE s.project = ?
                  ORDER BY s.updated_at DESC`,
            args: [project],
        });

        return result.rows.map(row => {
            const sessionRow = parseSessionRow(row);
            const messageCount = Number(row.message_count ?? 0);
            return toSessionSummary(sessionRow, messageCount);
        });
    }

    async function renameSession(sessionId: string, title: string): Promise<void> {
        const trimmed = title.trim();
        if (trimmed === '') throw new InvalidTitleError();

        const result = await db.execute({
            sql: `UPDATE sessions SET title = ?, updated_at = ? WHERE id = ?`,
            args: [trimmed, Date.now(), sessionId],
        });
        if (result.rowsAffected === 0) throw new SessionNotFoundError(sessionId);
    }

    async function deleteSession(sessionId: string): Promise<void> {
        const result = await db.execute({
            sql: `DELETE FROM sessions WHERE id = ?`,
            args: [sessionId],
        });
        if (result.rowsAffected === 0) throw new SessionNotFoundError(sessionId);
    }

    async function pruneSessions(options: PruneOptions): Promise<number> {
        const { project, keepNewest, olderThanDays, exceptSessionId } = options;

        const result = await db.execute({
            sql: `SELECT id, updated_at FROM sessions WHERE project = ? ORDER BY updated_at DESC`,
            args: [project],
        });
        const rows = result.rows.map(row => ({ id: String(row.id), updatedAt: Number(row.updated_at) }));

        // Already ordered newest-first, so the first `keepNewest` rows are exactly the
        // ones the count cap protects.
        const withinCountCap = new Set(rows.slice(0, keepNewest).map(row => row.id));
        const cutoff = olderThanDays !== undefined ? Date.now() - olderThanDays * 24 * 60 * 60 * 1000 : null;

        // A session survives only if it clears both caps - outside the count window OR
        // past the age cutoff is enough to mark it for deletion, matching "keep the
        // newest N ... AND drop anything older than D days" as two independent triggers
        // rather than a single combined threshold.
        const toDelete = rows
            .filter(row => row.id !== exceptSessionId)
            .filter(row => !withinCountCap.has(row.id) || (cutoff !== null && row.updatedAt < cutoff))
            .map(row => row.id);

        if (toDelete.length === 0) return 0;

        await withTransaction(db, async tx => {
            for (const id of toDelete) {
                await tx.execute({ sql: `DELETE FROM sessions WHERE id = ?`, args: [id] });
            }
        });

        return toDelete.length;
    }

    async function listProjects(): Promise<string[]> {
        const result = await db.execute('SELECT DISTINCT project FROM sessions');
        return result.rows.map(row => String(row.project));
    }

    async function vacuum(): Promise<void> {
        // Not wrapped in withTransaction - VACUUM manages its own transaction internally
        // and SQLite rejects running it inside one that's already open.
        await db.execute('VACUUM');
    }

    return {
        createSession,
        appendMessage,
        resolveApproval,
        loadSession,
        listSessions,
        renameSession,
        deleteSession,
        pruneSessions,
        listProjects,
        vacuum,
    };
}
