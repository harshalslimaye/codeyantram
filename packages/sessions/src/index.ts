export { openDb, getDb, closeDb, resetDbForTests } from './db';
export { migrate, applyMigrations, latestSchemaVersion, type Migration } from './migrations';
export { deriveTitle, deriveTitleFromMessage } from './title';
export { InvalidTitleError, SessionNotFoundError, ToolCallNotFoundError } from './errors';
export {
    sessionRowSchema,
    messageRowSchema,
    parseSessionRow,
    parseMessageRow,
    rowToChatMessage,
    chatMessageToRowFields,
    type SessionRow,
    type MessageRow,
} from './schema';
export {
    createSessionStore,
    type SessionStore,
    type NewSessionInput,
    type SessionSummary,
    type StoredSession,
    type PruneOptions,
} from './store';

import { getDb } from './db';
import { createSessionStore, type SessionStore } from './store';

/** The production convenience: resolves the process-wide database (opening and
 * migrating it on first call) and hands back a store bound to it. The one call a future
 * server router (Phase 3) actually needs - everything else exported here exists for
 * tests, or for composing a store around a different Client (a test's own temp
 * database, in particular). */
export async function getSessionStore(): Promise<SessionStore> {
    return createSessionStore(await getDb());
}
