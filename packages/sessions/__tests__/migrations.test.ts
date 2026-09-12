import { describe, expect, test } from 'bun:test';
import { applyMigrations, latestSchemaVersion, migrate, type Migration } from '../src/migrations';
import { withTestDb } from './support/db';

describe('migrate (the real, shipped MIGRATIONS list)', () => {
    test('brings a fresh database to latestSchemaVersion()', async () => {
        await withTestDb(async db => {
            const { rows } = await db.execute('PRAGMA user_version');
            expect(Number(rows[0]?.user_version)).toBe(latestSchemaVersion());
        });
    });

    test('creates the sessions and messages tables with the expected columns', async () => {
        await withTestDb(async db => {
            const sessionsInfo = await db.execute('PRAGMA table_info(sessions)');
            const sessionColumns = sessionsInfo.rows.map(row => String(row.name)).sort();
            expect(sessionColumns).toEqual(
                ['agent_name', 'created_at', 'effort', 'id', 'model_id', 'project', 'title', 'updated_at'].sort(),
            );

            const messagesInfo = await db.execute('PRAGMA table_info(messages)');
            const messageColumns = messagesInfo.rows.map(row => String(row.name)).sort();
            expect(messageColumns).toEqual(
                ['instructions', 'message_id', 'parts', 'role', 'seq', 'session_id', 'usage'].sort(),
            );
        });
    });

    test('is a no-op when called again on an already-migrated database', async () => {
        await withTestDb(async db => {
            await db.execute({
                sql: `INSERT INTO sessions (id, project, title, created_at, updated_at, model_id, agent_name, effort)
                      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                args: ['s1', '/repo', 'hello', 1, 1, 'model', 'Build', null],
            });

            await migrate(db); // openDb() already ran this once; running it again must be safe

            const { rows } = await db.execute('PRAGMA user_version');
            expect(Number(rows[0]?.user_version)).toBe(latestSchemaVersion());

            const sessions = await db.execute('SELECT * FROM sessions');
            expect(sessions.rows.length).toBe(1);
        });
    });

    test('deleting a session cascades to its messages via the schema-declared foreign key', async () => {
        await withTestDb(async db => {
            await db.execute({
                sql: `INSERT INTO sessions (id, project, title, created_at, updated_at, model_id, agent_name, effort)
                      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                args: ['s1', '/repo', 'hello', 1, 1, 'model', 'Build', null],
            });
            await db.execute({
                sql: `INSERT INTO messages (session_id, seq, message_id, role, parts, usage, instructions)
                      VALUES (?, 0, ?, 'user', '[]', NULL, NULL)`,
                args: ['s1', 'm1'],
            });

            await db.execute({ sql: 'DELETE FROM sessions WHERE id = ?', args: ['s1'] });

            const remaining = await db.execute('SELECT * FROM messages WHERE session_id = ?', ['s1']);
            expect(remaining.rows.length).toBe(0);
        });
    });

    test('rejects a message row with a duplicate message_id in the same session', async () => {
        await withTestDb(async db => {
            await db.execute({
                sql: `INSERT INTO sessions (id, project, title, created_at, updated_at, model_id, agent_name, effort)
                      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                args: ['s1', '/repo', 'hello', 1, 1, 'model', 'Build', null],
            });
            await db.execute({
                sql: `INSERT INTO messages (session_id, seq, message_id, role, parts, usage, instructions)
                      VALUES (?, 0, ?, 'user', '[]', NULL, NULL)`,
                args: ['s1', 'm1'],
            });

            await expect(
                db.execute({
                    sql: `INSERT INTO messages (session_id, seq, message_id, role, parts, usage, instructions)
                          VALUES (?, 1, ?, 'user', '[]', NULL, NULL)`,
                    args: ['s1', 'm1'],
                }),
            ).rejects.toThrow();
        });
    });
});

describe('applyMigrations (the general upgrade mechanism)', () => {
    test('applies every migration in order to a brand-new database', async () => {
        const migrations: Migration[] = [
            { version: 1, up: ['CREATE TABLE widgets (id TEXT PRIMARY KEY)'] },
            { version: 2, up: ['ALTER TABLE widgets ADD COLUMN name TEXT'] },
        ];

        await withTestDb(async db => {
            // withTestDb already ran the real migrate() - reset to a clean slate so this
            // test's own synthetic migrations are the only ones in play.
            await db.execute('DROP TABLE sessions');
            await db.execute('DROP TABLE messages');
            await db.execute('PRAGMA user_version = 0');

            await applyMigrations(db, migrations);

            const { rows } = await db.execute('PRAGMA user_version');
            expect(Number(rows[0]?.user_version)).toBe(2);

            const info = await db.execute('PRAGMA table_info(widgets)');
            expect(info.rows.map(row => String(row.name))).toEqual(['id', 'name']);
        });
    });

    test('the scenario Phase 1 exists to protect: a v1 database, populated with real data, upgrades to v2 without losing it', async () => {
        const v1: Migration = { version: 1, up: ['CREATE TABLE widgets (id TEXT PRIMARY KEY, label TEXT NOT NULL)'] };
        const v2: Migration = { version: 2, up: ['ALTER TABLE widgets ADD COLUMN archived INTEGER NOT NULL DEFAULT 0'] };

        await withTestDb(async db => {
            await db.execute('DROP TABLE sessions');
            await db.execute('DROP TABLE messages');
            await db.execute('PRAGMA user_version = 0');

            // Simulate a database that has only ever seen v1, with a real row in it.
            await applyMigrations(db, [v1]);
            await db.execute({
                sql: 'INSERT INTO widgets (id, label) VALUES (?, ?)',
                args: ['w1', 'a widget written before migration 2 existed'],
            });

            // Now "upgrade" to a codebase that knows about v2 as well.
            await applyMigrations(db, [v1, v2]);

            const { rows } = await db.execute('PRAGMA user_version');
            expect(Number(rows[0]?.user_version)).toBe(2);

            const widgets = await db.execute('SELECT * FROM widgets WHERE id = ?', ['w1']);
            expect(widgets.rows[0]?.label).toBe('a widget written before migration 2 existed');
            expect(Number(widgets.rows[0]?.archived)).toBe(0);
        });
    });

    test('is a no-op when the database is already at or beyond every known version', async () => {
        await withTestDb(async db => {
            await db.execute('PRAGMA user_version = 99'); // a newer build has been here before

            await applyMigrations(db, [{ version: 1, up: ['CREATE TABLE should_not_run (id TEXT)'] }]);

            const { rows } = await db.execute('PRAGMA user_version');
            expect(Number(rows[0]?.user_version)).toBe(99); // untouched

            await expect(db.execute('SELECT * FROM should_not_run')).rejects.toThrow();
        });
    });

    test('rolls back and leaves user_version unchanged when a migration fails partway through', async () => {
        await withTestDb(async db => {
            await db.execute('DROP TABLE sessions');
            await db.execute('DROP TABLE messages');
            await db.execute('PRAGMA user_version = 0');

            const broken: Migration = {
                version: 1,
                up: ['CREATE TABLE widgets (id TEXT PRIMARY KEY)', 'THIS IS NOT VALID SQL'],
            };

            await expect(applyMigrations(db, [broken])).rejects.toThrow();

            const { rows } = await db.execute('PRAGMA user_version');
            expect(Number(rows[0]?.user_version)).toBe(0);

            // The first statement in the failed migration must not have survived either -
            // that is the point of running the whole migration in one transaction.
            await expect(db.execute('SELECT * FROM widgets')).rejects.toThrow();
        });
    });
});
