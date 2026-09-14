import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { chmodSync, existsSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getDb, openDb, resetDbForTests } from '../src/db';
import { latestSchemaVersion } from '../src/migrations';

const ORIGINAL_CONFIG_DIR_OVERRIDE = process.env.CODEYANTRAM_CONFIG_DIR;

// getDb() memoizes a client at module scope - every test here either uses openDb()
// directly (no shared state) or resets that memo, so one test's database can never leak
// into the next, in this file or (since bun shares a process across test files) any
// other file that also calls getDb().
beforeEach(() => {
    delete process.env.CODEYANTRAM_CONFIG_DIR;
    resetDbForTests();
});

afterEach(() => {
    resetDbForTests();
    if (ORIGINAL_CONFIG_DIR_OVERRIDE === undefined) delete process.env.CODEYANTRAM_CONFIG_DIR;
    else process.env.CODEYANTRAM_CONFIG_DIR = ORIGINAL_CONFIG_DIR_OVERRIDE;
});

function withTempConfigDir<T>(run: (dir: string) => Promise<T>): Promise<T> {
    const dir = mkdtempSync(join(tmpdir(), 'codeyantram-sessions-db-test-'));
    return run(dir).finally(() => rmSync(dir, { recursive: true, force: true }));
}

describe('openDb', () => {
    test('sets journal_mode and foreign_keys on the connection it returns', async () => {
        await withTempConfigDir(async dir => {
            const db = await openDb(`file:${join(dir, 'sessions.db')}`);
            try {
                const journalMode = await db.execute('PRAGMA journal_mode');
                expect(String(journalMode.rows[0]?.journal_mode).toLowerCase()).toBe('wal');

                const foreignKeys = await db.execute('PRAGMA foreign_keys');
                expect(Number(foreignKeys.rows[0]?.foreign_keys)).toBe(1);
            } finally {
                db.close();
            }
        });
    });

    test('migrates a fresh database to latestSchemaVersion() before returning it', async () => {
        await withTempConfigDir(async dir => {
            const db = await openDb(`file:${join(dir, 'sessions.db')}`);
            try {
                const { rows } = await db.execute('PRAGMA user_version');
                expect(Number(rows[0]?.user_version)).toBe(latestSchemaVersion());
            } finally {
                db.close();
            }
        });
    });

    test('hardens the main file and its WAL sidecars to 0600', async () => {
        await withTempConfigDir(async dir => {
            const path = join(dir, 'sessions.db');
            const db = await openDb(`file:${path}`);
            try {
                expect(statSync(path).mode & 0o777).toBe(0o600);
                expect(statSync(`${path}-wal`).mode & 0o777).toBe(0o600);
                expect(statSync(`${path}-shm`).mode & 0o777).toBe(0o600);
            } finally {
                db.close();
            }
        });
    });

    test('retroactively hardens an existing database from before this hardening existed', async () => {
        await withTempConfigDir(async dir => {
            const path = join(dir, 'sessions.db');

            // A first open creates the file (and its sidecars) already hardened -
            // loosen them afterward to simulate a database that predates this feature.
            const first = await openDb(`file:${path}`);
            first.close();
            chmodSync(path, 0o644);
            chmodSync(`${path}-wal`, 0o644);
            chmodSync(`${path}-shm`, 0o644);

            const second = await openDb(`file:${path}`);
            try {
                expect(statSync(path).mode & 0o777).toBe(0o600);
                expect(statSync(`${path}-wal`).mode & 0o777).toBe(0o600);
                expect(statSync(`${path}-shm`).mode & 0o777).toBe(0o600);
            } finally {
                second.close();
            }
        });
    });

    test('does not attempt to chmod anything for a non-file URL', async () => {
        const db = await openDb(':memory:');
        try {
            const { rows } = await db.execute('PRAGMA user_version');
            expect(Number(rows[0]?.user_version)).toBe(latestSchemaVersion());
        } finally {
            db.close();
        }
    });
});

describe('getDb', () => {
    test('refuses to run under bare `bun test` with no CODEYANTRAM_CONFIG_DIR override - never silently opens the real config dir', () => {
        // No override set (beforeEach already deleted it) - this is the exact situation
        // every other test file in the workspace is in by default, including the
        // server's own router tests. Without this guard, any of them forgetting to set
        // the override would write to whoever's real ~/.codeyantram runs the suite.
        expect(() => getDb()).toThrow(/CODEYANTRAM_CONFIG_DIR/);
    });

    test('creates sessions.db inside configDir()', async () => {
        await withTempConfigDir(async dir => {
            process.env.CODEYANTRAM_CONFIG_DIR = dir;
            await getDb();
            expect(existsSync(join(dir, 'sessions.db'))).toBe(true);
        });
    });

    test('creates configDir() at 0700 if it does not exist yet', async () => {
        await withTempConfigDir(async parent => {
            const dir = join(parent, 'config');
            process.env.CODEYANTRAM_CONFIG_DIR = dir;
            await getDb();
            expect(statSync(dir).mode & 0o777).toBe(0o700);
        });
    });

    test('memoizes: two calls in the same process share one client and its data', async () => {
        await withTempConfigDir(async dir => {
            process.env.CODEYANTRAM_CONFIG_DIR = dir;

            const first = await getDb();
            await first.execute({
                sql: `INSERT INTO sessions (id, project, title, created_at, updated_at, model_id, agent_name, effort)
                      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                args: ['s1', dir, 'hello', 1, 1, 'm', 'Build', null],
            });

            const second = await getDb();
            const rows = await second.execute('SELECT * FROM sessions');
            expect(rows.rows.length).toBe(1); // same underlying connection, not a second one racing to reopen
        });
    });

    test('resetDbForTests() lets a later getDb() call open a database at a new configDir()', async () => {
        await withTempConfigDir(async firstDir => {
            await withTempConfigDir(async secondDir => {
                process.env.CODEYANTRAM_CONFIG_DIR = firstDir;
                await getDb();
                expect(existsSync(join(firstDir, 'sessions.db'))).toBe(true);
                expect(existsSync(join(secondDir, 'sessions.db'))).toBe(false);

                resetDbForTests();
                process.env.CODEYANTRAM_CONFIG_DIR = secondDir;
                await getDb();
                expect(existsSync(join(secondDir, 'sessions.db'))).toBe(true);
            });
        });
    });
});
