import { afterEach, describe, expect, test } from 'bun:test';
import { testRender } from '@opentui/react/test-utils';
import type { AssistantMessage, UserMessage } from '@codeyantram/shared';
import { useSessionAutosave, type SessionAutosave, type SessionAutosaveContext } from '../../src/providers/session-autosave';
import { ToastContext, type ToastContextValue } from '../../src/providers/toast';
import { NO_BUILTIN_CTRL_C, tick } from '../support/mount';
import { mockFetch } from '../support/sse';

const originalFetch = global.fetch;
const originalConsoleError = console.error;

afterEach(() => {
    global.fetch = originalFetch;
    console.error = originalConsoleError;
});

let captured: SessionAutosave | null = null;

function Harness() {
    captured = useSessionAutosave();
    return (
        <box>
            <text>session:{captured.sessionId ?? 'none'}</text>
        </box>
    );
}

/** A minimal, precisely-countable stand-in for ToastProvider - the real provider (used
 * elsewhere, e.g. chat.test.tsx) only lets a test check rendered text, which can't tell
 * "one toast fired" from "three identical toasts fired", exactly the distinction the
 * throttle tests below need. */
function mockToast(): { value: ToastContextValue; warnCalls: string[] } {
    const warnCalls: string[] = [];
    const value: ToastContextValue = {
        info: () => '',
        warn: message => {
            warnCalls.push(message);
            return '';
        },
        error: () => '',
        dismiss: () => {},
    };
    return { value, warnCalls };
}

// Every test destroys its own renderer once done (matching chat.test.tsx's own
// convention) - without it, opentui's terminal console cache accumulates a listener per
// mount across a file with this many test cases, surfacing as a real
// "possible EventTarget memory leak" warning, not just noise.
function mount(toastValue: ToastContextValue) {
    captured = null;
    return testRender(
        <ToastContext.Provider value={toastValue}>
            <Harness />
        </ToastContext.Provider>,
        { width: 40, height: 5, ...NO_BUILTIN_CTRL_C },
    );
}

function jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function deferredResponse(): { promise: Promise<Response>; resolve: (res: Response) => void } {
    let resolve!: (res: Response) => void;
    const promise = new Promise<Response>(r => {
        resolve = r;
    });
    return { promise, resolve };
}

const context: SessionAutosaveContext = {
    project: '/repo',
    modelId: 'claude-sonnet-5',
    agentName: 'Build',
    effort: undefined,
};

const userMessage: UserMessage = { id: 'm1', role: 'user', parts: [{ type: 'text', text: 'hi' }] };
const reply: AssistantMessage = { id: 'm2', role: 'assistant', parts: [{ type: 'text', text: 'hello' }] };

type Call = { method: string; url: string; body?: unknown };

function trackCalls(handler: (call: Call, index: number) => Response | Promise<Response>) {
    const calls: Call[] = [];
    mockFetch(async (url, init) => {
        const call: Call = {
            method: init?.method ?? 'GET',
            url: String(url),
            body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
        };
        calls.push(call);
        return handler(call, calls.length - 1);
    });
    return calls;
}

describe('saveUserMessage', () => {
    test('creates a session on the first call', async () => {
        const calls = trackCalls(() => jsonResponse({ id: 's1' }, 201));
        const { value } = mockToast();
        const rendered = await mount(value);

        captured!.saveUserMessage(userMessage, context);
        await tick(20);

        expect(captured!.sessionId).toBe('s1');
        expect(calls).toHaveLength(1);
        expect(calls[0]).toMatchObject({ method: 'POST', url: expect.stringContaining('/sessions') });
        expect(calls[0]!.body).toMatchObject({ cwd: '/repo', model: 'claude-sonnet-5', agent: 'Build', firstMessage: userMessage });

        rendered.renderer.destroy();
    });

    test('appends, rather than creating again, once a session exists', async () => {
        const calls = trackCalls((_call, index) => (index === 0 ? jsonResponse({ id: 's1' }, 201) : jsonResponse({ ok: true })));
        const { value } = mockToast();
        const rendered = await mount(value);

        captured!.saveUserMessage(userMessage, context);
        await tick(20);
        captured!.saveUserMessage({ id: 'm3', role: 'user', parts: [{ type: 'text', text: 'a follow-up' }] }, context);
        await tick(20);

        expect(calls).toHaveLength(2);
        expect(calls[1]).toMatchObject({ method: 'POST', url: expect.stringContaining('/sessions/s1/messages') });

        rendered.renderer.destroy();
    });

    test('a failed create leaves sessionId null, and the next message retries it', async () => {
        console.error = () => {}; // expected - this test deliberately triggers the logged failure
        const calls = trackCalls((_call, index) => {
            if (index === 0) throw new Error('ECONNREFUSED');
            return jsonResponse({ id: 's1' }, 201);
        });
        const { value } = mockToast();
        const rendered = await mount(value);

        captured!.saveUserMessage(userMessage, context);
        await tick(20);
        expect(captured!.sessionId).toBeNull();

        captured!.saveUserMessage(userMessage, context);
        await tick(20);
        expect(captured!.sessionId).toBe('s1');
        expect(calls).toHaveLength(2);

        rendered.renderer.destroy();
    });
});

describe('saveAssistantMessage', () => {
    test('appends once a session exists', async () => {
        const calls = trackCalls((_call, index) => (index === 0 ? jsonResponse({ id: 's1' }, 201) : jsonResponse({ ok: true })));
        const { value } = mockToast();
        const rendered = await mount(value);

        captured!.saveUserMessage(userMessage, context);
        await tick(20);
        captured!.saveAssistantMessage(reply);
        await tick(20);

        expect(calls).toHaveLength(2);
        expect(calls[1]).toMatchObject({ method: 'POST', url: expect.stringContaining('/sessions/s1/messages') });
        expect(calls[1]!.body).toEqual({ message: reply });

        rendered.renderer.destroy();
    });

    test('reports a failure (does not throw to the caller) when no session exists yet', async () => {
        console.error = () => {};
        const calls = trackCalls(() => jsonResponse({ ok: true }));
        const { value, warnCalls } = mockToast();
        const rendered = await mount(value);

        expect(() => captured!.saveAssistantMessage(reply)).not.toThrow();
        await tick(20);

        expect(calls).toHaveLength(0);
        expect(warnCalls).toHaveLength(1);
        expect(warnCalls[0]).toContain("isn't being saved");

        rendered.renderer.destroy();
    });
});

describe('saveApproval', () => {
    test('resolves an approval once a session exists', async () => {
        const calls = trackCalls((_call, index) => (index === 0 ? jsonResponse({ id: 's1' }, 201) : jsonResponse({ ok: true })));
        const { value } = mockToast();
        const rendered = await mount(value);

        captured!.saveUserMessage(userMessage, context);
        await tick(20);
        captured!.saveApproval('call_1', true);
        await tick(20);

        expect(calls).toHaveLength(2);
        expect(calls[1]).toMatchObject({ method: 'POST', url: expect.stringContaining('/sessions/s1/approvals') });
        expect(calls[1]!.body).toEqual({ toolCallId: 'call_1', approved: true });

        rendered.renderer.destroy();
    });

    test('reports a failure when no session exists yet', async () => {
        console.error = () => {};
        const calls = trackCalls(() => jsonResponse({ ok: true }));
        const { value, warnCalls } = mockToast();
        const rendered = await mount(value);

        expect(() => captured!.saveApproval('call_1', true)).not.toThrow();
        await tick(20);

        expect(calls).toHaveLength(0);
        expect(warnCalls).toHaveLength(1);

        rendered.renderer.destroy();
    });
});

describe('the "not saved" toast', () => {
    test('fires once per failure streak, not once per failed save', async () => {
        console.error = () => {};
        trackCalls(() => {
            throw new Error('ECONNREFUSED');
        });
        const { value, warnCalls } = mockToast();
        const rendered = await mount(value);

        captured!.saveUserMessage(userMessage, context);
        await tick(20);
        captured!.saveUserMessage(userMessage, context); // still fails - same streak
        await tick(20);
        captured!.saveUserMessage(userMessage, context); // still fails - same streak
        await tick(20);

        expect(warnCalls).toHaveLength(1);

        rendered.renderer.destroy();
    });

    test('fires again after a streak is broken by a success', async () => {
        console.error = () => {};
        const calls = trackCalls((_call, index) => {
            if (index === 1) return jsonResponse({ id: 's1' }, 201); // the second attempt succeeds
            throw new Error('ECONNREFUSED');
        });
        const { value, warnCalls } = mockToast();
        const rendered = await mount(value);

        captured!.saveUserMessage(userMessage, context); // fails - warns (1st)
        await tick(20);
        captured!.saveUserMessage(userMessage, context); // succeeds - resets the throttle
        await tick(20);
        expect(captured!.sessionId).toBe('s1');

        captured!.saveAssistantMessage(reply); // this one fails again (call index 2)
        await tick(20);

        expect(calls.length).toBeGreaterThanOrEqual(3);
        expect(warnCalls).toHaveLength(2); // one for the initial failure, one for the new one after recovery

        rendered.renderer.destroy();
    });
});

describe('reset', () => {
    test('clears sessionId, so the next saveUserMessage creates a new session', async () => {
        const calls = trackCalls((_call, index) => (index === 0 ? jsonResponse({ id: 's1' }, 201) : jsonResponse({ id: 's2' }, 201)));
        const { value } = mockToast();
        const rendered = await mount(value);

        captured!.saveUserMessage(userMessage, context);
        await tick(20);
        expect(captured!.sessionId).toBe('s1');

        captured!.reset();
        await tick(20);
        expect(captured!.sessionId).toBeNull();

        captured!.saveUserMessage(userMessage, context);
        await tick(20);

        expect(captured!.sessionId).toBe('s2');
        expect(calls).toHaveLength(2);
        expect(calls.every(call => call.method === 'POST' && call.url.endsWith('/sessions'))).toBe(true);

        rendered.renderer.destroy();
    });

    test('does not resurrect the old session id if its own create call resolves after reset', async () => {
        const deferred = deferredResponse();
        const calls = trackCalls((_call, index) => (index === 0 ? deferred.promise : jsonResponse({ id: 's2' }, 201)));
        const { value } = mockToast();
        const rendered = await mount(value);

        // Fires a create for the old conversation, then abandons it (via reset) before
        // that create's own response has come back - the exact race reset's own queuing
        // (see session-autosave.ts) exists to guard against.
        captured!.saveUserMessage(userMessage, context);
        captured!.reset();
        captured!.saveUserMessage({ id: 'm3', role: 'user', parts: [{ type: 'text', text: 'a follow-up' }] }, context);

        deferred.resolve(jsonResponse({ id: 's1' }, 201));
        await tick(30);

        // If reset had raced ahead of the pending create, its `.then` handler
        // would have overwritten the reset back to 's1' once it finally resolved.
        expect(captured!.sessionId).toBe('s2');
        expect(calls).toHaveLength(2);

        rendered.renderer.destroy();
    });
});

describe('attach', () => {
    test('points the next save at an already-existing session instead of creating one', async () => {
        const calls = trackCalls(() => jsonResponse({ ok: true }));
        const { value } = mockToast();
        const rendered = await mount(value);

        captured!.attach('existing-session');
        await tick(20);
        expect(captured!.sessionId).toBe('existing-session');

        captured!.saveAssistantMessage(reply);
        await tick(20);

        expect(calls).toHaveLength(1);
        expect(calls[0]).toMatchObject({ method: 'POST', url: expect.stringContaining('/sessions/existing-session/messages') });

        rendered.renderer.destroy();
    });
});

describe('serialisation', () => {
    test('an assistant-message save waits for the same session\'s create call to finish first', async () => {
        const deferred = deferredResponse();
        const calls = trackCalls((_call, index) => (index === 0 ? deferred.promise : jsonResponse({ ok: true })));
        const { value } = mockToast();
        const rendered = await mount(value);

        captured!.saveUserMessage(userMessage, context);
        captured!.saveAssistantMessage(reply); // fired immediately after, before create has resolved

        await tick(20);
        expect(calls).toHaveLength(1); // the append must not have run yet
        expect(captured!.sessionId).toBeNull();

        deferred.resolve(jsonResponse({ id: 's1' }, 201));
        await tick(20);

        expect(calls).toHaveLength(2);
        expect(calls[1]).toMatchObject({ url: expect.stringContaining('/sessions/s1/messages') });

        rendered.renderer.destroy();
    });

    test('a failed save does not block the next enqueued save', async () => {
        console.error = () => {};
        const calls = trackCalls((_call, index) => {
            if (index === 0) return jsonResponse({ id: 's1' }, 201);
            if (index === 1) throw new Error('network blip'); // the assistant-message save fails
            return jsonResponse({ ok: true }); // the approval save after it must still run
        });
        const { value } = mockToast();
        const rendered = await mount(value);

        captured!.saveUserMessage(userMessage, context);
        captured!.saveAssistantMessage(reply);
        captured!.saveApproval('call_1', true);
        await tick(30);

        expect(calls).toHaveLength(3);

        rendered.renderer.destroy();
    });
});
