import { z } from 'zod';
import { chatMessageSchema, type ChatMessage } from '@codeyantram/shared';

// ---------------------------------------------------------------------------
// Raw row shapes, as read back from libsql.
//
// Rows are parsed, not cast: a row written by an older schema version, or corrupted by
// hand, fails loudly here - as a thrown error a test can assert on - rather than
// surfacing three layers up as a broken render or a silently wrong resume.
// ---------------------------------------------------------------------------

export const sessionRowSchema = z.object({
    id: z.string().min(1),
    project: z.string().min(1),
    title: z.string().min(1),
    created_at: z.number().int(),
    updated_at: z.number().int(),
    model_id: z.string().min(1),
    agent_name: z.string().min(1),
    // Not validated against shared's current model/agent/effort catalogs - those
    // catalogs can change over time, and a session written months ago against a
    // since-removed model or effort level must still load. Deciding what to do about a
    // stale value (fall back to the current default, warn the user) is Phase 5's job -
    // the CLI's resume logic - not this store's; the store's only job is to hand back
    // whatever was actually recorded.
    effort: z.string().min(1).nullable(),
});

export type SessionRow = z.infer<typeof sessionRowSchema>;

export const messageRowSchema = z.object({
    session_id: z.string().min(1),
    seq: z.number().int().nonnegative(),
    message_id: z.string().min(1),
    role: z.enum(['user', 'assistant']),
    parts: z.string().min(1),
    usage: z.string().nullable(),
    instructions: z.string().nullable(),
});

export type MessageRow = z.infer<typeof messageRowSchema>;

/** Parses one row's worth of unknown data (whatever the driver handed back) into a
 * SessionRow, throwing - with the row's id, if it has one worth showing - rather than
 * returning something a caller might use without realizing it's malformed. Unknown extra
 * columns (e.g. listSessions' joined message_count) are silently dropped by z.object()'s
 * default "strip" behavior, not an error - only a wrong shape for a column this schema
 * actually declares is a real problem. */
export function parseSessionRow(row: unknown): SessionRow {
    const result = sessionRowSchema.safeParse(row);
    if (!result.success) {
        const id = (row as { id?: unknown } | null)?.id;
        throw new Error(
            `Malformed session row${typeof id === 'string' ? ` (id: ${id})` : ''}: ${result.error.message}`,
            { cause: result.error },
        );
    }
    return result.data;
}

export function parseMessageRow(row: unknown): MessageRow {
    const result = messageRowSchema.safeParse(row);
    if (!result.success) {
        const sessionId = (row as { session_id?: unknown } | null)?.session_id;
        const seq = (row as { seq?: unknown } | null)?.seq;
        throw new Error(
            `Malformed message row (session: ${String(sessionId)}, seq: ${String(seq)}): ${result.error.message}`,
            { cause: result.error },
        );
    }
    return result.data;
}

/**
 * Reassembles a validated MessageRow back into the ChatMessage shape the CLI already
 * knows how to render. `parts`/`usage`/`instructions` are stored as JSON text columns and
 * parsed back out here, then the whole candidate is validated against chatMessageSchema -
 * so a row that doesn't actually satisfy the shape its own role claims (a "user" row that
 * somehow carries usage, say) fails the same way any other malformed row does, rather
 * than producing a ChatMessage the rest of the app wasn't expecting.
 *
 * Reasoning parts are kept as stored and re-render on resume - stripping them for replay
 * to a provider is toRequestMessage's job on the way back out, not this store's.
 */
export function rowToChatMessage(row: MessageRow): ChatMessage {
    let parts: unknown;
    try {
        parts = JSON.parse(row.parts);
    } catch (error) {
        throw new Error(
            `Malformed parts JSON for message ${row.message_id} (seq ${row.seq}): ${(error as Error).message}`,
            { cause: error },
        );
    }

    let candidate: unknown;
    if (row.role === 'user') {
        candidate = { id: row.message_id, role: 'user' as const, parts };
    } else {
        let usage: unknown;
        let projectInstructions: unknown;
        try {
            usage = row.usage !== null ? JSON.parse(row.usage) : undefined;
            projectInstructions = row.instructions !== null ? JSON.parse(row.instructions) : undefined;
        } catch (error) {
            throw new Error(
                `Malformed usage/instructions JSON for message ${row.message_id} (seq ${row.seq}): ${(error as Error).message}`,
                { cause: error },
            );
        }
        candidate = { id: row.message_id, role: 'assistant' as const, parts, usage, projectInstructions };
    }

    const result = chatMessageSchema.safeParse(candidate);
    if (!result.success) {
        throw new Error(
            `Message ${row.message_id} (seq ${row.seq}) does not satisfy ChatMessage: ${result.error.message}`,
            { cause: result.error },
        );
    }
    return result.data;
}

/** The inverse of rowToChatMessage: the JSON-text column values to insert for a given
 * ChatMessage. `usage`/`instructions` are only ever present on an assistant message, and
 * only once its turn has actually finished - null here simply means "not yet known",
 * matching how assistantMessageSchema itself treats both fields as optional. */
export function chatMessageToRowFields(message: ChatMessage): {
    role: 'user' | 'assistant';
    parts: string;
    usage: string | null;
    instructions: string | null;
} {
    return {
        role: message.role,
        parts: JSON.stringify(message.parts),
        usage: message.role === 'assistant' && message.usage !== undefined ? JSON.stringify(message.usage) : null,
        instructions:
            message.role === 'assistant' && message.projectInstructions !== undefined
                ? JSON.stringify(message.projectInstructions)
                : null,
    };
}
