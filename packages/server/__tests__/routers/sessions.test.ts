import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getOrCreateServerToken, type UserMessage } from '@codeyantram/shared';
import { resetDbForTests } from '@codeyantram/sessions';
import { app } from '../../src/index';
import { SERVER_TOKEN_HEADER } from '../../src/lib/server-auth';

const ORIGINAL_CONFIG_DIR_OVERRIDE = process.env.CODEYANTRAM_CONFIG_DIR;
let tempDir: string | null = null;
let token: string;

// Each test gets its own temp config dir and a freshly reset session-store singleton, so
// no test's data - or its token - can leak into another. Setting CODEYANTRAM_CONFIG_DIR
// (needed for a real, isolated sessions.db) also turns on token enforcement, since both
// gate on the exact same isRealIoEnabled() check - so every request below has to carry
// the real token, unlike server-auth.test.ts's own "enforcement off" cases.
beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'codeyantram-sessions-router-test-'));
    process.env.CODEYANTRAM_CONFIG_DIR = tempDir;
    resetDbForTests();
    token = getOrCreateServerToken();
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

/** app.request() with the auth token already attached - every real test call goes
 * through this rather than repeating the header at every call site. */
async function req(path: string, init?: RequestInit): Promise<Response> {
    return app.request(path, {
        ...init,
        headers: { ...init?.headers, [SERVER_TOKEN_HEADER]: token },
    });
}

function userMessage(id: string, text: string): UserMessage {
    return { id, role: 'user', parts: [{ type: 'text', text }] };
}

const createBody = {
    cwd: '/repo',
    model: 'claude-sonnet-5',
    agent: 'Build' as const,
    firstMessage: userMessage('m1', 'fix the socket handshake'),
};

async function createSession(overrides: Partial<typeof createBody> = {}): Promise<string> {
    const res = await req('/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...createBody, ...overrides }),
    });
    const { id } = (await res.json()) as { id: string };
    return id;
}

describe('POST /sessions', () => {
    test('creates a session and returns its new id and derived title', async () => {
        const res = await req('/sessions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(createBody),
        });

        expect(res.status).toBe(201);
        const body = (await res.json()) as { id: string; title: string };
        expect(typeof body.id).toBe('string');
        expect(body.id.length).toBeGreaterThan(0);
        // Derived from createBody.firstMessage's text (see the userMessage() call above) -
        // see @codeyantram/sessions' own title.ts for the derivation rule itself, tested
        // there in full.
        expect(body.title).toBe('fix the socket handshake');
    });

    test('rejects an unknown model', async () => {
        const res = await req('/sessions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...createBody, model: 'gpt-9' }),
        });
        expect(res.status).toBe(400);
    });

    test('rejects an effort the model does not support', async () => {
        const res = await req('/sessions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...createBody, model: 'gemini-3.5-flash', effort: 'max' }),
        });
        expect(res.status).toBe(400);
    });

    test('rejects a missing cwd', async () => {
        const { cwd: _cwd, ...withoutCwd } = createBody;
        const res = await req('/sessions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(withoutCwd),
        });
        expect(res.status).toBe(400);
    });

    test('rejects a firstMessage that is not a user message', async () => {
        const res = await req('/sessions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...createBody, firstMessage: { id: 'm1', role: 'assistant', parts: [] } }),
        });
        expect(res.status).toBe(400);
    });
});

describe('GET /sessions', () => {
    test('lists sessions for the given project, newest first', async () => {
        const older = await createSession({ cwd: '/repo-a', firstMessage: userMessage('m1', 'first') });
        await new Promise(resolve => setTimeout(resolve, 5));
        const newer = await createSession({ cwd: '/repo-a', firstMessage: userMessage('m2', 'second') });
        await createSession({ cwd: '/repo-b', firstMessage: userMessage('m3', 'a different project') });

        const res = await req('/sessions?project=/repo-a');
        expect(res.status).toBe(200);
        const body = (await res.json()) as { sessions: { id: string }[] };
        expect(body.sessions.map(s => s.id)).toEqual([newer, older]);
    });

    test('returns an empty list for a project with no sessions', async () => {
        const res = await req('/sessions?project=/nowhere');
        expect((await res.json())).toEqual({ sessions: [] });
    });

    test('rejects a missing project query param', async () => {
        const res = await req('/sessions');
        expect(res.status).toBe(400);
    });
});

describe('GET /sessions/:id', () => {
    test('returns the full session with its messages', async () => {
        const id = await createSession();
        const res = await req(`/sessions/${id}`);

        expect(res.status).toBe(200);
        const body = (await res.json()) as { session: { id: string; messages: unknown[] } };
        expect(body.session.id).toBe(id);
        expect(body.session.messages).toEqual([createBody.firstMessage]);
    });

    test('returns 404 for an unknown id', async () => {
        const res = await req('/sessions/does-not-exist');
        expect(res.status).toBe(404);
    });
});

describe('POST /sessions/:id/messages', () => {
    test('appends a message and it shows up on the next load', async () => {
        const id = await createSession();
        const reply = { id: 'm2', role: 'assistant' as const, parts: [{ type: 'text' as const, text: 'reply' }] };

        const appendRes = await req(`/sessions/${id}/messages`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: reply }),
        });
        expect(appendRes.status).toBe(200);
        expect(await appendRes.json()).toEqual({ ok: true });

        const loadRes = await req(`/sessions/${id}`);
        const body = (await loadRes.json()) as { session: { messages: { id: string }[] } };
        expect(body.session.messages.map(m => m.id)).toEqual(['m1', 'm2']);
    });

    test('returns 404 for an unknown session id', async () => {
        const res = await req('/sessions/does-not-exist/messages', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: userMessage('m2', 'hi') }),
        });
        expect(res.status).toBe(404);
    });

    test('rejects a body with no message', async () => {
        const id = await createSession();
        const res = await req(`/sessions/${id}/messages`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({}),
        });
        expect(res.status).toBe(400);
    });
});

describe('POST /sessions/:id/approvals', () => {
    async function createSessionWithPendingApproval(): Promise<string> {
        const id = await createSession();
        await req(`/sessions/${id}/messages`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                message: {
                    id: 'm2',
                    role: 'assistant',
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
                },
            }),
        });
        return id;
    }

    test('resolves a pending tool call', async () => {
        const id = await createSessionWithPendingApproval();

        const res = await req(`/sessions/${id}/approvals`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ toolCallId: 'call_1', approved: true }),
        });
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ ok: true });

        const loadRes = await req(`/sessions/${id}`);
        const body = (await loadRes.json()) as { session: { messages: { parts: { approvalStatus?: string }[] }[] } };
        expect(body.session.messages[1]?.parts[0]).toMatchObject({ approvalStatus: 'approved' });
    });

    test('returns 404 for an unknown session id', async () => {
        const res = await req('/sessions/does-not-exist/approvals', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ toolCallId: 'call_1', approved: true }),
        });
        expect(res.status).toBe(404);
    });

    test('returns 404 for a toolCallId no message carries', async () => {
        const id = await createSessionWithPendingApproval();
        const res = await req(`/sessions/${id}/approvals`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ toolCallId: 'call_does_not_exist', approved: true }),
        });
        expect(res.status).toBe(404);
    });
});

describe('PATCH /sessions/:id', () => {
    test('renames a session', async () => {
        const id = await createSession();
        const res = await req(`/sessions/${id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title: 'a better title' }),
        });
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ ok: true });

        const loadRes = await req(`/sessions/${id}`);
        const body = (await loadRes.json()) as { session: { title: string } };
        expect(body.session.title).toBe('a better title');
    });

    test('returns 404 for an unknown session id', async () => {
        const res = await req('/sessions/does-not-exist', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title: 'new title' }),
        });
        expect(res.status).toBe(404);
    });

    test('rejects a literally empty title at the schema layer', async () => {
        const id = await createSession();
        const res = await req(`/sessions/${id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title: '' }),
        });
        expect(res.status).toBe(400);
    });

    test('rejects a whitespace-only title via the store\'s InvalidTitleError, mapped to 400', async () => {
        const id = await createSession();
        const res = await req(`/sessions/${id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title: '   ' }),
        });
        expect(res.status).toBe(400);
    });
});

describe('DELETE /sessions/:id', () => {
    test('deletes a session', async () => {
        const id = await createSession();

        const res = await req(`/sessions/${id}`, { method: 'DELETE' });
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ ok: true });

        const loadRes = await req(`/sessions/${id}`);
        expect(loadRes.status).toBe(404);
    });

    test('returns 404 for an unknown session id', async () => {
        const res = await req('/sessions/does-not-exist', { method: 'DELETE' });
        expect(res.status).toBe(404);
    });
});

describe('a full session lifecycle through the router', () => {
    test('create, append, approve, rename, load, delete', async () => {
        const id = await createSession();

        await req(`/sessions/${id}/messages`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                message: {
                    id: 'm2',
                    role: 'assistant',
                    parts: [{ type: 'tool-call', toolCallId: 'call_1', toolName: 'bash', args: {}, approvalId: 'a1', approvalStatus: 'pending' }],
                },
            }),
        });

        await req(`/sessions/${id}/approvals`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ toolCallId: 'call_1', approved: true }),
        });

        await req(`/sessions/${id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title: 'renamed' }),
        });

        const loadRes = await req(`/sessions/${id}`);
        const body = (await loadRes.json()) as {
            session: { title: string; messageCount: number; messages: { parts: { approvalStatus?: string }[] }[] };
        };
        expect(body.session.title).toBe('renamed');
        expect(body.session.messageCount).toBe(2);
        expect(body.session.messages[1]?.parts[0]).toMatchObject({ approvalStatus: 'approved' });

        await req(`/sessions/${id}`, { method: 'DELETE' });
        expect((await req(`/sessions/${id}`)).status).toBe(404);
    });
});
