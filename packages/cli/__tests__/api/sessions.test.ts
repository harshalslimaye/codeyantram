import { afterEach, describe, expect, test } from 'bun:test';
import type { AssistantMessage, CreateSessionRequest, UserMessage } from '@codeyantram/shared';
import {
    appendMessage,
    createSession,
    deleteSession,
    loadSession,
    listSessions,
    renameSession,
    resolveApproval,
    SessionApiError,
} from '../../src/api/sessions';
import { mockFetch } from '../support/sse';

const originalFetch = global.fetch;

afterEach(() => {
    global.fetch = originalFetch;
});

function jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

const userMessage: UserMessage = { id: 'm1', role: 'user', parts: [{ type: 'text', text: 'hi' }] };

const createBody: CreateSessionRequest = {
    cwd: '/repo',
    model: 'claude-sonnet-5',
    agent: 'Build',
    firstMessage: userMessage,
};

const summary = {
    id: 's1',
    project: '/repo',
    title: 'hello',
    createdAt: 1,
    updatedAt: 2,
    modelId: 'claude-sonnet-5',
    agentName: 'Build',
    effort: null,
    messageCount: 1,
};

describe('createSession', () => {
    test('returns the new id on success', async () => {
        mockFetch(async () => jsonResponse({ id: 's1' }, 201));
        expect(await createSession(createBody)).toBe('s1');
    });

    test('throws SessionApiError with the status for a non-ok response', async () => {
        mockFetch(async () => jsonResponse({ error: 'bad model' }, 400));
        await expect(createSession(createBody)).rejects.toThrow(SessionApiError);
        try {
            await createSession(createBody);
            throw new Error('should have thrown');
        } catch (error) {
            expect(error).toBeInstanceOf(SessionApiError);
            expect((error as SessionApiError).status).toBe(400);
        }
    });

    test('throws SessionApiError for a response that does not match the schema', async () => {
        mockFetch(async () => jsonResponse({ notAnId: true }, 201));
        await expect(createSession(createBody)).rejects.toThrow(SessionApiError);
    });

    test('throws SessionApiError with no status for a network-level failure', async () => {
        mockFetch(async () => {
            throw new Error('ECONNREFUSED');
        });
        try {
            await createSession(createBody);
            throw new Error('should have thrown');
        } catch (error) {
            expect(error).toBeInstanceOf(SessionApiError);
            expect((error as SessionApiError).status).toBeUndefined();
            expect((error as Error).message).toContain('ECONNREFUSED');
        }
    });
});

describe('listSessions', () => {
    test('returns the session list', async () => {
        mockFetch(async () => jsonResponse({ sessions: [summary] }));
        expect(await listSessions('/repo')).toEqual([summary]);
    });

    test('returns an empty array', async () => {
        mockFetch(async () => jsonResponse({ sessions: [] }));
        expect(await listSessions('/repo')).toEqual([]);
    });

    test('throws for a non-ok response', async () => {
        mockFetch(async () => jsonResponse({ error: 'unauthorized' }, 401));
        await expect(listSessions('/repo')).rejects.toThrow(SessionApiError);
    });
});

describe('loadSession', () => {
    test('returns the session on success', async () => {
        mockFetch(async () => jsonResponse({ session: { ...summary, messages: [userMessage] } }));
        const session = await loadSession('s1');
        expect(session?.id).toBe('s1');
        expect(session?.messages).toEqual([userMessage]);
    });

    test('returns null for a 404 - not found is a legitimate answer, not a thrown error', async () => {
        mockFetch(async () => jsonResponse({ error: 'no such session' }, 404));
        expect(await loadSession('missing')).toBeNull();
    });

    test('still throws for a non-404 non-ok response', async () => {
        mockFetch(async () => jsonResponse({ error: 'boom' }, 500));
        await expect(loadSession('s1')).rejects.toThrow(SessionApiError);
    });
});

describe('appendMessage', () => {
    const reply: AssistantMessage = { id: 'm2', role: 'assistant', parts: [{ type: 'text', text: 'hi' }] };

    test('resolves on success', async () => {
        mockFetch(async () => jsonResponse({ ok: true }));
        await expect(appendMessage('s1', reply)).resolves.toBeUndefined();
    });

    test('throws (not null) for a 404 - appending is a command, not a query', async () => {
        mockFetch(async () => jsonResponse({ error: 'no such session' }, 404));
        await expect(appendMessage('missing', reply)).rejects.toThrow(SessionApiError);
    });
});

describe('resolveApproval', () => {
    test('resolves on success', async () => {
        mockFetch(async () => jsonResponse({ ok: true }));
        await expect(resolveApproval('s1', 'call_1', true)).resolves.toBeUndefined();
    });

    test('throws for a 404', async () => {
        mockFetch(async () => jsonResponse({ error: 'no such tool call' }, 404));
        await expect(resolveApproval('s1', 'call_x', true)).rejects.toThrow(SessionApiError);
    });
});

describe('renameSession', () => {
    test('resolves on success', async () => {
        mockFetch(async () => jsonResponse({ ok: true }));
        await expect(renameSession('s1', 'new title')).resolves.toBeUndefined();
    });

    test('throws for a 400 (whitespace-only title, say)', async () => {
        mockFetch(async () => jsonResponse({ error: 'title cannot be empty' }, 400));
        await expect(renameSession('s1', '   ')).rejects.toThrow(SessionApiError);
    });
});

describe('deleteSession', () => {
    test('resolves on success', async () => {
        mockFetch(async () => jsonResponse({ ok: true }));
        await expect(deleteSession('s1')).resolves.toBeUndefined();
    });

    test('throws for a 404', async () => {
        mockFetch(async () => jsonResponse({ error: 'no such session' }, 404));
        await expect(deleteSession('missing')).rejects.toThrow(SessionApiError);
    });
});
