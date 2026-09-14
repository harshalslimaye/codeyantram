import { describe, expect, test } from 'bun:test';
import type { AssistantMessage, ChatMessage, UserMessage } from '@codeyantram/shared';
import { InvalidTitleError, SessionNotFoundError, ToolCallNotFoundError } from '../src/errors';
import { createSessionStore } from '../src/store';
import { withTestDb } from './support/db';

function userMessage(id: string, text: string): UserMessage {
    return { id, role: 'user', parts: [{ type: 'text', text }] };
}

function assistantMessage(id: string, overrides: Partial<AssistantMessage> = {}): AssistantMessage {
    return {
        id,
        role: 'assistant',
        parts: [{ type: 'text', text: 'a reply' }],
        ...overrides,
    };
}

describe('createSession / loadSession', () => {
    test('round-trips a new session with its first message', async () => {
        await withTestDb(async db => {
            const store = createSessionStore(db);

            const id = await store.createSession({
                project: '/repo',
                modelId: 'claude-sonnet-5',
                agentName: 'Build',
                effort: 'high',
                firstMessage: userMessage('m1', 'fix the socket handshake'),
            });

            const session = await store.loadSession(id);
            expect(session).not.toBeNull();
            expect(session!.id).toBe(id);
            expect(session!.project).toBe('/repo');
            expect(session!.title).toBe('fix the socket handshake');
            expect(session!.modelId).toBe('claude-sonnet-5');
            expect(session!.agentName).toBe('Build');
            expect(session!.effort).toBe('high');
            expect(session!.messageCount).toBe(1);
            expect(session!.messages).toEqual([userMessage('m1', 'fix the socket handshake')]);
            expect(session!.createdAt).toBe(session!.updatedAt);
        });
    });

    test('accepts a null effort', async () => {
        await withTestDb(async db => {
            const store = createSessionStore(db);
            const id = await store.createSession({
                project: '/repo',
                modelId: 'gemini-3.5-flash',
                agentName: 'Talk',
                effort: null,
                firstMessage: userMessage('m1', 'hello'),
            });
            const session = await store.loadSession(id);
            expect(session!.effort).toBeNull();
        });
    });

    test('returns null for an id that does not exist', async () => {
        await withTestDb(async db => {
            const store = createSessionStore(db);
            expect(await store.loadSession('missing')).toBeNull();
        });
    });

    test('two sessions get distinct ids', async () => {
        await withTestDb(async db => {
            const store = createSessionStore(db);
            const a = await store.createSession({
                project: '/repo',
                modelId: 'm',
                agentName: 'Build',
                firstMessage: userMessage('m1', 'a'),
            });
            const b = await store.createSession({
                project: '/repo',
                modelId: 'm',
                agentName: 'Build',
                firstMessage: userMessage('m2', 'b'),
            });
            expect(a).not.toBe(b);
        });
    });
});

describe('appendMessage', () => {
    async function seedSession(db: Parameters<typeof createSessionStore>[0]) {
        const store = createSessionStore(db);
        const id = await store.createSession({
            project: '/repo',
            modelId: 'claude-sonnet-5',
            agentName: 'Build',
            firstMessage: userMessage('m1', 'first message'),
        });
        return { store, id };
    }

    test('preserves seq order across several appends of either role', async () => {
        await withTestDb(async db => {
            const { store, id } = await seedSession(db);

            await store.appendMessage(id, assistantMessage('m2'));
            await store.appendMessage(id, userMessage('m3', 'a follow-up'));
            await store.appendMessage(id, assistantMessage('m4'));

            const session = await store.loadSession(id);
            expect(session!.messages.map(m => m.id)).toEqual(['m1', 'm2', 'm3', 'm4']);
            expect(session!.messageCount).toBe(4);
        });
    });

    test('bumps updated_at without touching created_at', async () => {
        await withTestDb(async db => {
            const { store, id } = await seedSession(db);
            const before = (await store.loadSession(id))!;

            await new Promise(resolve => setTimeout(resolve, 5));
            await store.appendMessage(id, assistantMessage('m2'));

            const after = (await store.loadSession(id))!;
            expect(after.createdAt).toBe(before.createdAt);
            expect(after.updatedAt).toBeGreaterThan(before.updatedAt);
        });
    });

    test('throws SessionNotFoundError for an unknown session id', async () => {
        await withTestDb(async db => {
            const store = createSessionStore(db);
            await expect(store.appendMessage('missing', assistantMessage('m1'))).rejects.toThrow(SessionNotFoundError);
        });
    });

    test('stores an assistant message with usage, and one without it, correctly', async () => {
        await withTestDb(async db => {
            const { store, id } = await seedSession(db);
            await store.appendMessage(id, assistantMessage('m2', { usage: { inputTokens: 12, outputTokens: 4 } }));

            const session = await store.loadSession(id);
            const reply = session!.messages[1] as AssistantMessage;
            expect(reply.usage).toEqual({ inputTokens: 12, outputTokens: 4 });
        });
    });
});

describe('listSessions', () => {
    test('scopes to the given project and orders newest updated_at first', async () => {
        await withTestDb(async db => {
            const store = createSessionStore(db);

            const a = await store.createSession({
                project: '/repo-a',
                modelId: 'm',
                agentName: 'Build',
                firstMessage: userMessage('m1', 'session a'),
            });
            await new Promise(resolve => setTimeout(resolve, 5));
            const b = await store.createSession({
                project: '/repo-a',
                modelId: 'm',
                agentName: 'Build',
                firstMessage: userMessage('m2', 'session b'),
            });
            await store.createSession({
                project: '/repo-b',
                modelId: 'm',
                agentName: 'Build',
                firstMessage: userMessage('m3', 'a session in a different project'),
            });

            const listA = await store.listSessions('/repo-a');
            expect(listA.map(s => s.id)).toEqual([b, a]); // b is newer

            const listB = await store.listSessions('/repo-b');
            expect(listB.length).toBe(1);
        });
    });

    test('reports messageCount without loading the messages themselves', async () => {
        await withTestDb(async db => {
            const store = createSessionStore(db);
            const id = await store.createSession({
                project: '/repo',
                modelId: 'm',
                agentName: 'Build',
                firstMessage: userMessage('m1', 'hi'),
            });
            await store.appendMessage(id, assistantMessage('m2'));

            const [summary] = await store.listSessions('/repo');
            expect(summary!.messageCount).toBe(2);
            expect(summary).not.toHaveProperty('messages');
        });
    });

    test('returns an empty array for a project with no sessions', async () => {
        await withTestDb(async db => {
            const store = createSessionStore(db);
            expect(await store.listSessions('/nowhere')).toEqual([]);
        });
    });
});

describe('resolveApproval', () => {
    async function seedPendingApproval(db: Parameters<typeof createSessionStore>[0]) {
        const store = createSessionStore(db);
        const id = await store.createSession({
            project: '/repo',
            modelId: 'm',
            agentName: 'Build',
            firstMessage: userMessage('m1', 'edit the file'),
        });
        await store.appendMessage(
            id,
            assistantMessage('m2', {
                parts: [
                    {
                        type: 'tool-call',
                        toolCallId: 'call_1',
                        toolName: 'write_file',
                        args: {},
                        approvalId: 'approval_1',
                        approvalStatus: 'pending',
                    },
                ],
            }),
        );
        return { store, id };
    }

    test('flips a pending tool call to approved', async () => {
        await withTestDb(async db => {
            const { store, id } = await seedPendingApproval(db);
            await store.resolveApproval(id, 'call_1', true);

            const session = await store.loadSession(id);
            const reply = session!.messages[1] as AssistantMessage;
            expect(reply.parts[0]).toMatchObject({ approvalStatus: 'approved' });
        });
    });

    test('flips a pending tool call to denied', async () => {
        await withTestDb(async db => {
            const { store, id } = await seedPendingApproval(db);
            await store.resolveApproval(id, 'call_1', false);

            const session = await store.loadSession(id);
            const reply = session!.messages[1] as AssistantMessage;
            expect(reply.parts[0]).toMatchObject({ approvalStatus: 'denied' });
        });
    });

    test('bumps updated_at', async () => {
        await withTestDb(async db => {
            const { store, id } = await seedPendingApproval(db);
            const before = (await store.loadSession(id))!;

            await new Promise(resolve => setTimeout(resolve, 5));
            await store.resolveApproval(id, 'call_1', true);

            const after = (await store.loadSession(id))!;
            expect(after.updatedAt).toBeGreaterThan(before.updatedAt);
        });
    });

    test('throws ToolCallNotFoundError for an id no message carries', async () => {
        await withTestDb(async db => {
            const { store, id } = await seedPendingApproval(db);
            await expect(store.resolveApproval(id, 'call_does_not_exist', true)).rejects.toThrow(ToolCallNotFoundError);
        });
    });

    test('throws with session and seq context, not a raw SyntaxError, for a corrupted parts column', async () => {
        await withTestDb(async db => {
            const { store, id } = await seedPendingApproval(db);
            // Simulate corruption below the store's own writes - hand-write bad JSON
            // directly, the same way a real disk-level corruption would surface it.
            await db.execute({
                sql: `UPDATE messages SET parts = ? WHERE session_id = ? AND seq = 1`,
                args: ['{not valid json', id],
            });

            await expect(store.resolveApproval(id, 'call_1', true)).rejects.toThrow(/Malformed parts JSON/);
        });
    });

    test('throws SessionNotFoundError for an unknown session', async () => {
        await withTestDb(async db => {
            const store = createSessionStore(db);
            await expect(store.resolveApproval('missing', 'call_1', true)).rejects.toThrow(SessionNotFoundError);
        });
    });
});

describe('renameSession', () => {
    test('updates the title and bumps updated_at', async () => {
        await withTestDb(async db => {
            const store = createSessionStore(db);
            const id = await store.createSession({
                project: '/repo',
                modelId: 'm',
                agentName: 'Build',
                firstMessage: userMessage('m1', 'a forgettable prompt'),
            });
            const before = (await store.loadSession(id))!;

            await new Promise(resolve => setTimeout(resolve, 5));
            await store.renameSession(id, '  My renamed session  ');

            const after = (await store.loadSession(id))!;
            expect(after.title).toBe('My renamed session');
            expect(after.updatedAt).toBeGreaterThan(before.updatedAt);
        });
    });

    test('throws for an empty or whitespace-only title', async () => {
        await withTestDb(async db => {
            const store = createSessionStore(db);
            const id = await store.createSession({
                project: '/repo',
                modelId: 'm',
                agentName: 'Build',
                firstMessage: userMessage('m1', 'hi'),
            });
            await expect(store.renameSession(id, '   ')).rejects.toThrow(InvalidTitleError);
        });
    });

    test('throws SessionNotFoundError for an unknown id', async () => {
        await withTestDb(async db => {
            const store = createSessionStore(db);
            await expect(store.renameSession('missing', 'new title')).rejects.toThrow(SessionNotFoundError);
        });
    });
});

describe('deleteSession', () => {
    test('removes the session and cascades to its messages', async () => {
        await withTestDb(async db => {
            const store = createSessionStore(db);
            const id = await store.createSession({
                project: '/repo',
                modelId: 'm',
                agentName: 'Build',
                firstMessage: userMessage('m1', 'hi'),
            });
            await store.appendMessage(id, assistantMessage('m2'));

            await store.deleteSession(id);

            expect(await store.loadSession(id)).toBeNull();
            const rawMessages = await db.execute({ sql: 'SELECT * FROM messages WHERE session_id = ?', args: [id] });
            expect(rawMessages.rows.length).toBe(0);
        });
    });

    test('throws SessionNotFoundError for an unknown id', async () => {
        await withTestDb(async db => {
            const store = createSessionStore(db);
            await expect(store.deleteSession('missing')).rejects.toThrow(SessionNotFoundError);
        });
    });
});

describe('pruneSessions', () => {
    async function seedProjectWithAges(
        db: Parameters<typeof createSessionStore>[0],
        project: string,
        ages: { id: string; daysOld: number }[],
    ) {
        const store = createSessionStore(db);
        const now = Date.now();
        for (const { id: messageId, daysOld } of ages) {
            const id = await store.createSession({
                project,
                modelId: 'm',
                agentName: 'Build',
                firstMessage: userMessage(messageId, `session ${messageId}`),
            });
            const updatedAt = now - daysOld * 24 * 60 * 60 * 1000;
            await db.execute({ sql: 'UPDATE sessions SET updated_at = ? WHERE id = ?', args: [updatedAt, id] });
        }
        return store;
    }

    test('keeps only the newest N sessions when no age cap is given', async () => {
        await withTestDb(async db => {
            const store = await seedProjectWithAges(db, '/repo', [
                { id: 'm1', daysOld: 0 },
                { id: 'm2', daysOld: 1 },
                { id: 'm3', daysOld: 2 },
                { id: 'm4', daysOld: 3 },
            ]);

            const deleted = await store.pruneSessions({ project: '/repo', keepNewest: 2 });

            expect(deleted).toBe(2);
            const remaining = await store.listSessions('/repo');
            expect(remaining.map(s => s.title)).toEqual(['session m1', 'session m2']);
        });
    });

    test('also drops sessions older than olderThanDays, even within the count cap', async () => {
        await withTestDb(async db => {
            const store = await seedProjectWithAges(db, '/repo', [
                { id: 'm1', daysOld: 0 },
                { id: 'm2', daysOld: 40 }, // within top-10 by count, but stale
            ]);

            const deleted = await store.pruneSessions({ project: '/repo', keepNewest: 10, olderThanDays: 30 });

            expect(deleted).toBe(1);
            const remaining = await store.listSessions('/repo');
            expect(remaining.map(s => s.title)).toEqual(['session m1']);
        });
    });

    test('never deletes exceptSessionId, even if it is old and outside the count cap', async () => {
        await withTestDb(async db => {
            const store = await seedProjectWithAges(db, '/repo', [
                { id: 'm1', daysOld: 0 },
                { id: 'm2', daysOld: 60 },
            ]);
            const remainingBefore = await store.listSessions('/repo');
            const oldSessionId = remainingBefore.find(s => s.title === 'session m2')!.id;

            const deleted = await store.pruneSessions({
                project: '/repo',
                keepNewest: 1,
                olderThanDays: 30,
                exceptSessionId: oldSessionId,
            });

            expect(deleted).toBe(0);
            expect(await store.loadSession(oldSessionId)).not.toBeNull();
        });
    });

    test('only prunes within the given project', async () => {
        await withTestDb(async db => {
            const store = createSessionStore(db);
            await store.createSession({
                project: '/repo-a',
                modelId: 'm',
                agentName: 'Build',
                firstMessage: userMessage('m1', 'a'),
            });
            await store.createSession({
                project: '/repo-b',
                modelId: 'm',
                agentName: 'Build',
                firstMessage: userMessage('m2', 'b'),
            });

            const deleted = await store.pruneSessions({ project: '/repo-a', keepNewest: 0 });

            expect(deleted).toBe(1);
            expect((await store.listSessions('/repo-b')).length).toBe(1);
        });
    });

    test('returns 0 and touches nothing when everything is within both caps', async () => {
        await withTestDb(async db => {
            const store = await seedProjectWithAges(db, '/repo', [{ id: 'm1', daysOld: 0 }]);
            expect(await store.pruneSessions({ project: '/repo', keepNewest: 50, olderThanDays: 30 })).toBe(0);
        });
    });

});

describe('listProjects', () => {
    test('returns nothing for an empty store', async () => {
        await withTestDb(async db => {
            const store = createSessionStore(db);
            expect(await store.listProjects()).toEqual([]);
        });
    });

    test('returns every distinct project, once each, regardless of how many sessions it has', async () => {
        await withTestDb(async db => {
            const store = createSessionStore(db);
            await store.createSession({ project: '/repo-a', modelId: 'm', agentName: 'Build', firstMessage: userMessage('m1', 'a') });
            await store.createSession({ project: '/repo-a', modelId: 'm', agentName: 'Build', firstMessage: userMessage('m2', 'b') });
            await store.createSession({ project: '/repo-b', modelId: 'm', agentName: 'Build', firstMessage: userMessage('m3', 'c') });

            const projects = await store.listProjects();
            expect(projects.sort()).toEqual(['/repo-a', '/repo-b']);
        });
    });
});

describe('vacuum', () => {
    test('runs without error and leaves the store fully usable afterward', async () => {
        await withTestDb(async db => {
            const store = createSessionStore(db);
            const id = await store.createSession({
                project: '/repo',
                modelId: 'm',
                agentName: 'Build',
                firstMessage: userMessage('m1', 'hello'),
            });
            await store.deleteSession(id);

            await expect(store.vacuum()).resolves.toBeUndefined();

            // The connection still works normally after VACUUM - not left mid-transaction
            // or otherwise disturbed.
            expect(await store.listSessions('/repo')).toEqual([]);
        });
    });
});
