import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { UserMessage } from '@codeyantram/shared';
import { getDb, getSessionStore, resetDbForTests } from '@codeyantram/sessions';
import { KEEP_NEWEST_SESSIONS_PER_PROJECT, MAX_SESSION_AGE_DAYS, pruneOldSessions } from '../src/index';

const ORIGINAL_CONFIG_DIR_OVERRIDE = process.env.CODEYANTRAM_CONFIG_DIR;
let tempDir: string | null = null;

// Same isolation pattern as routers/sessions.test.ts - a fresh temp config dir and a
// reset store singleton per test, so this file's sessions.db never leaks into (or is
// leaked into by) any other test in the workspace.
beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'codeyantram-prune-on-start-test-'));
    process.env.CODEYANTRAM_CONFIG_DIR = tempDir;
    resetDbForTests();
});

afterEach(() => {
    resetDbForTests();
    if (ORIGINAL_CONFIG_DIR_OVERRIDE === undefined) delete process.env.CODEYANTRAM_CONFIG_DIR;
    else process.env.CODEYANTRAM_CONFIG_DIR = ORIGINAL_CONFIG_DIR_OVERRIDE;

    if (tempDir !== null) {
        rmSync(tempDir, { recursive: true, force: true });
        tempDir = null;
    }
});

function userMessage(id: string, text: string): UserMessage {
    return { id, role: 'user', parts: [{ type: 'text', text }] };
}

async function seedSession(project: string, id: string, daysOld: number): Promise<void> {
    const store = await getSessionStore();
    const sessionId = await store.createSession({
        project,
        modelId: 'claude-sonnet-5',
        agentName: 'Build',
        firstMessage: userMessage(id, `session ${id}`),
    });
    const client = await getDb();
    await client.execute({
        sql: 'UPDATE sessions SET updated_at = ? WHERE id = ?',
        args: [Date.now() - daysOld * 24 * 60 * 60 * 1000, sessionId],
    });
}

describe('pruneOldSessions', () => {
    test('does nothing when there are no sessions at all', async () => {
        await expect(pruneOldSessions()).resolves.toBeUndefined();
    });

    test('leaves everything untouched when nothing exceeds either cap', async () => {
        await seedSession('/repo', 'm1', 0);
        await pruneOldSessions();

        const store = await getSessionStore();
        expect((await store.listSessions('/repo')).length).toBe(1);
    });

    test('drops sessions older than MAX_SESSION_AGE_DAYS', async () => {
        await seedSession('/repo', 'recent', 1);
        await seedSession('/repo', 'ancient', MAX_SESSION_AGE_DAYS + 1);

        await pruneOldSessions();

        const store = await getSessionStore();
        const remaining = await store.listSessions('/repo');
        expect(remaining.map(s => s.title)).toEqual(['session recent']);
    });

    test('sweeps every project the store has seen, not just one', async () => {
        await seedSession('/repo-a', 'old-a', MAX_SESSION_AGE_DAYS + 1);
        await seedSession('/repo-b', 'old-b', MAX_SESSION_AGE_DAYS + 1);

        await pruneOldSessions();

        const store = await getSessionStore();
        expect(await store.listSessions('/repo-a')).toEqual([]);
        expect(await store.listSessions('/repo-b')).toEqual([]);
    });

    test('keeps at most KEEP_NEWEST_SESSIONS_PER_PROJECT recent sessions even without an age trigger', async () => {
        const store = await getSessionStore();
        for (let i = 0; i < KEEP_NEWEST_SESSIONS_PER_PROJECT + 1; i++) {
            await seedSession('/repo', `s${i}`, 0);
        }

        await pruneOldSessions();

        expect((await store.listSessions('/repo')).length).toBe(KEEP_NEWEST_SESSIONS_PER_PROJECT);
    });
});
