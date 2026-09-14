import type { Client } from '@libsql/client';

export type Migration = {
    version: number;
    up: readonly string[];
};

// Forward-only, keyed to PRAGMA user_version. Append new entries to the end; never edit
// or remove one that has already shipped - a database out in the world has already
// applied it exactly as written, and rewriting the entry here would desync what
// PRAGMA user_version actually means for that database from what this list claims it
// means. See __tests__/migrations.test.ts for the upgrade-path test this discipline
// depends on.
//
// `messages` gets its own UNIQUE index on (session_id, message_id) in addition to the
// (session_id, seq) primary key: seq is assigned by this store and can't collide, but
// message_id comes from the caller (a ChatMessage's own id), and a future retried
// append (Phase 4, once this sits behind an HTTP call that can time out and be resent)
// should fail loudly on a duplicate rather than silently double-inserting the same
// message under a new seq.
const MIGRATIONS: readonly Migration[] = [
    {
        version: 1,
        up: [
            `CREATE TABLE sessions (
                id          TEXT PRIMARY KEY,
                project     TEXT NOT NULL,
                title       TEXT NOT NULL,
                created_at  INTEGER NOT NULL,
                updated_at  INTEGER NOT NULL,
                model_id    TEXT NOT NULL,
                agent_name  TEXT NOT NULL,
                effort      TEXT
            )`,
            `CREATE INDEX sessions_project_updated ON sessions (project, updated_at DESC)`,
            `CREATE TABLE messages (
                session_id   TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
                seq          INTEGER NOT NULL,
                message_id   TEXT NOT NULL,
                role         TEXT NOT NULL,
                parts        TEXT NOT NULL,
                usage        TEXT,
                instructions TEXT,
                PRIMARY KEY (session_id, seq)
            )`,
            `CREATE UNIQUE INDEX messages_session_message_unique ON messages (session_id, message_id)`,
        ],
    },
];

/** The schema version a fresh database ends up at once every migration below has run -
 * what a test asserts `PRAGMA user_version` equals after calling migrate(). */
export function latestSchemaVersion(): number {
    return MIGRATIONS[MIGRATIONS.length - 1]?.version ?? 0;
}

/**
 * Brings `db` from whatever PRAGMA user_version it currently reports up to the highest
 * version in `migrations`, applying only the ones it hasn't seen yet, in order. Each
 * migration runs inside its own transaction with the version bump as that transaction's
 * last statement, so a crash mid-migration leaves user_version at the last one that
 * fully committed rather than at a half-applied schema claiming to be further along
 * than it is. A version at or below the database's current one is skipped outright -
 * this is also what makes it safe to open a database that's already *ahead* of what
 * this build of the code knows about (an older binary opening a newer database): nothing
 * in `migrations` has a version low enough to look pending, so this is a no-op rather
 * than an attempt to "fix" a schema it doesn't recognize.
 *
 * Exported as the general mechanism, separate from the fixed MIGRATIONS list, so
 * __tests__/migrations.test.ts can exercise a real multi-version upgrade - including one
 * that alters a populated table - without needing a second real migration to exist yet.
 * migrate() below is the only production caller, always with MIGRATIONS.
 */
export async function applyMigrations(db: Client, migrations: readonly Migration[]): Promise<void> {
    const { rows } = await db.execute('PRAGMA user_version');
    const current = Number(rows[0]?.user_version ?? 0);

    const pending = migrations.filter(migration => migration.version > current).sort((a, b) => a.version - b.version);

    for (const migration of pending) {
        const tx = await db.transaction('write');
        try {
            for (const sql of migration.up) {
                await tx.execute(sql);
            }
            // PRAGMA statements can't take a bound parameter in SQLite - the version
            // number has to be inlined. It's an internal integer this module controls
            // (never user input, never a string), so there's no injection surface here.
            await tx.execute(`PRAGMA user_version = ${migration.version}`);
            await tx.commit();
        } catch (error) {
            await tx.rollback();
            throw new Error(
                `Failed to apply sessions database migration ${migration.version}: ${(error as Error).message}`,
                { cause: error },
            );
        } finally {
            tx.close();
        }
    }
}

/** Brings `db` up to latestSchemaVersion() using the real, shipped MIGRATIONS list -
 * what db.ts actually calls on every open. Safe to call repeatedly: with nothing
 * pending, this is one PRAGMA read and nothing else. */
export async function migrate(db: Client): Promise<void> {
    await applyMigrations(db, MIGRATIONS);
}
