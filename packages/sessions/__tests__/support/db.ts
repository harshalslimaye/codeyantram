import type { Client } from '@libsql/client';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../../src/db';

/**
 * Opens a fresh, fully migrated database at its own temp-file path and hands it to
 * `run`, closing the client and removing the directory (including the -wal/-shm files
 * WAL leaves alongside the main file) afterward regardless of whether `run` throws.
 *
 * A real temp file rather than ":memory:" - matching Phase 0's own withTempDir pattern
 * for local-store.test.ts - so every test in this package exercises the same code path
 * production actually takes (a local file client with WAL), not a special-cased
 * in-memory one.
 */
export async function withTestDb(run: (db: Client) => Promise<void>): Promise<void> {
    const dir = mkdtempSync(join(tmpdir(), 'codeyantram-sessions-test-'));
    const db = await openDb(`file:${join(dir, 'sessions.db')}`);
    try {
        await run(db);
    } finally {
        db.close();
        rmSync(dir, { recursive: true, force: true });
    }
}
