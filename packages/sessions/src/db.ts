import { createClient, type Client } from '@libsql/client';
import { chmodSync } from 'node:fs';
import { join } from 'node:path';
import { CONFIG_DIR_MODE, configDir, ensureDir, isRealIoEnabled } from '@codeyantram/shared';
import { migrate } from './migrations';

const DB_FILENAME = 'sessions.db';

// A real file's own permissions, not just the directory holding it - full chat
// transcripts are worth protecting even if the directory around them were ever
// misconfigured. Applied to the main file and both WAL sidecars (see hardenFilePermissions
// below), and reapplied on every openDb() call rather than only when the file is first
// created - the same "fix a pre-existing one, not just a fresh one" reasoning
// ensureDir(..., CONFIG_DIR_MODE) already applies to the directory itself.
const DB_FILE_MODE = 0o600;

/**
 * chmods `path` to DB_FILE_MODE, tolerating ENOENT - the two WAL sidecars
 * (`sessions.db-wal`/`sessions.db-shm`) don't exist until something has actually written
 * to the database at least once (verified directly: they appear only after the first
 * CREATE TABLE, not merely after `PRAGMA journal_mode = WAL`), so calling this before
 * `migrate()` has run its very first CREATE TABLE on a brand new database would otherwise
 * throw on files that are about to exist but don't yet. Any other error (e.g. a real
 * permissions problem) is not swallowed.
 */
function hardenFilePermissions(path: string): void {
    try {
        chmodSync(path, DB_FILE_MODE);
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
}

/** Extracts the real filesystem path from a libsql `file:` URL, or null for anything
 * else (":memory:", a remote libsql:/https: URL) - there's no real file to chmod in
 * those cases. Every production and test caller in this codebase uses a `file:` URL
 * (see __tests__/support/db.ts), but openDb() itself is a general-purpose entry point
 * that shouldn't assume that. */
function filePathFromUrl(url: string): string | null {
    return url.startsWith('file:') ? url.slice('file:'.length) : null;
}

/**
 * Opens a libsql client against `url`, applies the two pragmas every statement in this
 * package relies on, and brings the schema up to date before handing the client back.
 *
 * The pragmas are set once here, not before every statement, because a local `file:`
 * client holds one real connection open for its lifetime rather than reopening per call -
 * verified directly (both foreign_keys enforcement and journal_mode surviving across
 * separate .execute() calls, on both the node and bun builds of @libsql/client), not
 * assumed from the driver's own docs, whose "own logical database connection" language
 * describes the batch/transaction methods and reads more like per-call reconnection than
 * it behaves for a local file.
 *
 * Exported apart from getDb() below so a test can open an independent, disposable
 * database (its own temp file, or ":memory:") without going through the process-wide
 * singleton - that singleton exists for the one production call site (the server, from
 * Phase 3 on), not for a test suite that wants many isolated databases in one process.
 */
export async function openDb(url: string): Promise<Client> {
    const db = createClient({ url });
    await db.execute('PRAGMA journal_mode = WAL');
    await db.execute('PRAGMA foreign_keys = ON');
    await migrate(db);

    // After migrate(), not before: on a brand new database, migrate() is what actually
    // performs the first write (CREATE TABLE), which is what brings the -wal/-shm
    // sidecars into existence in the first place.
    const path = filePathFromUrl(url);
    if (path !== null) {
        hardenFilePermissions(path);
        hardenFilePermissions(`${path}-wal`);
        hardenFilePermissions(`${path}-shm`);
    }

    return db;
}

let dbPromise: Promise<Client> | null = null;

/**
 * The production entry point: one client per process, opened lazily on first use and
 * reused after that. `sessions.db` lives inside configDir(), so it moves with a
 * CODEYANTRAM_CONFIG_DIR override the same way auth.json and preferences.json already do.
 *
 * ensureDir gets CONFIG_DIR_MODE (0700) here, same as writeJsonFile's own call in
 * local-store.ts - whichever of the two actually creates the directory first is what
 * sets its permissions.
 *
 * Guarded by isRealIoEnabled() - refuses to run at all under `bun test` with no
 * CODEYANTRAM_CONFIG_DIR override, rather than silently opening a real database at the
 * real configDir(). Every other store built on local-store.ts gets this for free because
 * readJsonFile/writeJsonFile check it internally; this module bypasses those (it needs a
 * database connection, not a JSON blob) and so has to check it explicitly. Unlike a flat
 * JSON file, there's no safe, cheap "no-op" a database connection could silently return
 * instead - so this fails loudly and immediately, forcing exactly the same explicit
 * opt-in every other real-I/O test in this codebase already uses, rather than an
 * accidental write to whoever's real ~/.codeyantram happens to run the suite.
 */
export function getDb(): Promise<Client> {
    if (!isRealIoEnabled()) {
        throw new Error(
            'getDb() was called under `bun test` without CODEYANTRAM_CONFIG_DIR set - refusing to open ' +
                'a real database at the default config directory. Set CODEYANTRAM_CONFIG_DIR to a temp ' +
                'directory before calling this (see __tests__/support/db.ts\'s withTestDb, or ' +
                '__tests__/db.test.ts), or call openDb() directly against your own path.',
        );
    }

    if (dbPromise === null) {
        ensureDir(configDir(), CONFIG_DIR_MODE);
        dbPromise = openDb(`file:${join(configDir(), DB_FILENAME)}`);
    }
    return dbPromise;
}

/**
 * Test-only: drops the memoized production client so the next getDb() call reopens
 * against whatever configDir() now resolves to. Production code never needs this - the
 * process either holds one database for its whole lifetime or exits; only a test suite
 * that changes CODEYANTRAM_CONFIG_DIR between cases and still wants to exercise getDb()
 * itself (rather than openDb() directly) needs a way to forget the cached client.
 */
export function resetDbForTests(): void {
    dbPromise = null;
}

/**
 * Closes the process-wide connection if getDb() ever opened one, and forgets it - a
 * no-op if it never did, since there's no reason to force a connection open just to
 * immediately close it (a server that received zero session requests before shutting
 * down has nothing to close).
 *
 * This is not a correctness requirement - WAL is already crash-safe on its own (a killed
 * process recovers cleanly on the next open; see migrations.test.ts's own upgrade-path
 * test, which exercises exactly that reopen behavior). What close() buys is a passive
 * checkpoint, folding the WAL file back into sessions.db itself, so the main file alone
 * stays a complete, accurate snapshot rather than depending on its -wal/-shm sidecars
 * always traveling with it - the thing that matters if someone runs the system `sqlite3`
 * binary against it, or copies just the one file, which is the whole point of D2's
 * choice to use an ordinary SQLite format in the first place.
 *
 * The caller (the server's own shutdown handler) is expected to call this at most once
 * per process lifetime; calling it again after is safe (dbPromise is already null, so
 * this just returns) but there is normally no reason to.
 */
export async function closeDb(): Promise<void> {
    if (dbPromise === null) return;

    const db = await dbPromise;
    dbPromise = null;
    db.close();
}
