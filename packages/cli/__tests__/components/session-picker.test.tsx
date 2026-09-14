import { describe, test, expect, mock } from 'bun:test';
import { testRender } from '@opentui/react/test-utils';
import { useKeyboard } from '@opentui/react';
import type { Session, SessionSummary } from '@codeyantram/shared';
import { SessionPicker, SessionRenameForm } from '../../src/components/session-picker';
import { ThemeProvider } from '../../src/providers/theme';
import { ModelProvider } from '../../src/providers/model';
import { EffortProvider } from '../../src/providers/effort';
import { AgentProvider } from '../../src/providers/agent';
import { ToastProvider } from '../../src/providers/toast';
import { ChatProvider, useChat } from '../../src/providers/chat';
import { useOverlay, OverlayProvider } from '../../src/providers/overlay';
import { KeyboardProvider, useLayerStack } from '../../src/providers/keyboard';
import { createLayerStack, ROOT_LAYER } from '../../src/keyboard';
import { NO_BUILTIN_CTRL_C, tick } from '../support/mount';
import { mockFetch } from '../support/sse';

function jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

/** A minimal stand-in for the real /sessions router - keyed by id for GET/DELETE/PATCH
 * /sessions/:id, one flat list for GET /sessions, everything else (there shouldn't be
 * anything else in these tests) answered generically. `deleteCalls`/`renameCalls` record
 * every id (and, for rename, the new title) an actual request hit, for tests that care
 * whether one happened. */
function mockSessionsApi(sessions: SessionSummary[], sessionsById: Record<string, Session> = {}) {
    const deleteCalls: string[] = [];
    const renameCalls: { id: string; title: string }[] = [];
    mockFetch(async (input, init) => {
        const url = String(input);
        const idMatch = /\/sessions\/([^/?]+)/.exec(url);
        if (idMatch) {
            const id = idMatch[1] as string;
            if (init?.method === 'DELETE') {
                deleteCalls.push(id);
                return sessionsById[id] === undefined ? jsonResponse({ error: 'not found' }, 404) : jsonResponse({ ok: true });
            }
            if (init?.method === 'PATCH') {
                const { title } = JSON.parse(init.body as string) as { title: string };
                if (sessionsById[id] === undefined) return jsonResponse({ error: 'not found' }, 404);
                renameCalls.push({ id, title });
                return jsonResponse({ ok: true });
            }
            const session = sessionsById[id];
            return session === undefined ? jsonResponse({ error: 'not found' }, 404) : jsonResponse({ session });
        }
        if (url.includes('/sessions')) return jsonResponse({ sessions });
        return jsonResponse({ ok: true });
    });
    return { deleteCalls, renameCalls };
}

function summary(overrides: Partial<SessionSummary> = {}): SessionSummary {
    return {
        id: 's1',
        project: process.cwd(),
        title: 'A session',
        createdAt: 1,
        updatedAt: Date.now(),
        modelId: 'claude-sonnet-5',
        agentName: 'Talk',
        effort: null,
        messageCount: 2,
        ...overrides,
    };
}

function session(overrides: Partial<Session> = {}): Session {
    return {
        ...summary(),
        messages: [{ id: 'm1', role: 'user', parts: [{ type: 'text', text: 'hi' }] }],
        ...overrides,
    };
}

// "p" opens the real overlay with a real SessionPicker inside it, and persisting
// `current:<id>`/`messages:<n>` labels outside the overlay make chat.sessionId and the
// live conversation observable both during and after the picker is used - same shape as
// model-picker.test.tsx's own Harness.
function Harness() {
    const chat = useChat();
    const overlay = useOverlay();
    const layers = useLayerStack();

    useKeyboard(key => {
        if (key.name !== 'p') return;
        if (!layers.isOnTop(ROOT_LAYER)) return;
        overlay.show('Sessions', <SessionPicker />);
    });

    return (
        <box>
            <text>current:{chat.sessionId ?? 'none'}</text>
            <text>messages:{chat.messages.length}</text>
            <text>title:{chat.sessionTitle ?? 'none'}</text>
        </box>
    );
}

function mount(width = 60, height = 30) {
    const layers = createLayerStack();

    return testRender(
        <KeyboardProvider layers={layers}>
            <ThemeProvider>
                <ModelProvider>
                    <EffortProvider>
                        <AgentProvider>
                            <ToastProvider>
                                <ChatProvider>
                                    <OverlayProvider>
                                        <Harness />
                                    </OverlayProvider>
                                </ChatProvider>
                            </ToastProvider>
                        </AgentProvider>
                    </EffortProvider>
                </ModelProvider>
            </ThemeProvider>
        </KeyboardProvider>,
        { width, height, ...NO_BUILTIN_CTRL_C },
    ).then(setup => ({ ...setup, layers }));
}

describe('loading', () => {
    test('shows a loading indicator before the list resolves', async () => {
        mockFetch(() => new Promise<Response>(() => {}));
        const rendered = await mount();
        await rendered.waitForFrame(f => f.includes('current:'));

        rendered.mockInput.pressKey('p');
        const frame = await rendered.waitForFrame(f => f.includes('Sessions'));

        expect(frame).toContain('Loading sessions');
        rendered.renderer.destroy();
    });

    test('shows an error if the list request fails', async () => {
        mockFetch(async () => {
            throw new Error('offline');
        });
        const rendered = await mount();
        await rendered.waitForFrame(f => f.includes('current:'));

        rendered.mockInput.pressKey('p');
        await rendered.waitForFrame(f => f.includes('Sessions'));
        await tick(20);
        await rendered.renderOnce();

        expect(rendered.captureCharFrame()).toContain("Couldn't load sessions");
        rendered.renderer.destroy();
    });
});

describe('listing', () => {
    test('shows an empty message with no sessions', async () => {
        mockSessionsApi([]);
        const rendered = await mount();
        await rendered.waitForFrame(f => f.includes('current:'));

        rendered.mockInput.pressKey('p');
        await rendered.waitForFrame(f => f.includes('Sessions'));
        await tick(20);
        await rendered.renderOnce();

        expect(rendered.captureCharFrame()).toContain('No sessions yet');
        rendered.renderer.destroy();
    });

    test('lists sessions with their message count', async () => {
        mockSessionsApi([summary({ id: 's1', title: 'First conversation', messageCount: 4 })]);
        const rendered = await mount();
        await rendered.waitForFrame(f => f.includes('current:'));

        rendered.mockInput.pressKey('p');
        await rendered.waitForFrame(f => f.includes('Sessions'));
        const frame = await rendered.waitForFrame(f => f.includes('First conversation'));

        expect(frame).toContain('First conversation');
        expect(frame).toContain('4 msgs');
        rendered.renderer.destroy();
    });

    test('truncates a title long enough to collide with the message-count column', async () => {
        const longTitle = 'be brutally honest. Do you feel the server is getting bloated';
        mockSessionsApi([summary({ id: 's1', title: longTitle })]);

        // Wide enough for the Overlay panel to sit at its own natural (unshrunk) width -
        // the default 60-col mount used elsewhere in this file is narrower than the panel
        // itself, so even a correctly truncated title would still wrap there.
        const rendered = await mount(90, 30);
        await rendered.waitForFrame(f => f.includes('current:'));

        rendered.mockInput.pressKey('p');
        await rendered.waitForFrame(f => f.includes('Sessions'));
        const frame = await rendered.waitForFrame(f => f.includes('be brutally honest'));

        expect(frame).not.toContain(longTitle);
        expect(frame).toContain('…');
        expect(frame).toContain('2 msgs');
        rendered.renderer.destroy();
    });
});

describe('selecting a session', () => {
    test('loads the full session and resumes it, closing the overlay', async () => {
        const target = session({ id: 's1', title: 'Pick me' });
        mockSessionsApi([summary({ id: 's1', title: 'Pick me' })], { s1: target });

        const rendered = await mount();
        await rendered.waitForFrame(f => f.includes('current:'));

        rendered.mockInput.pressKey('p');
        await rendered.waitForFrame(f => f.includes('Sessions'));
        await rendered.waitForFrame(f => f.includes('Pick me'));

        rendered.mockInput.pressEnter();
        await tick(30);
        await rendered.renderOnce();

        const frame = rendered.captureCharFrame();
        expect(frame).not.toContain('Sessions');
        expect(frame).toContain('current:s1');
        rendered.renderer.destroy();
    });

    test('warns instead of resuming if the session was deleted between listing and selecting', async () => {
        mockSessionsApi([summary({ id: 'gone', title: 'Ghost session' })]);
        const rendered = await mount();
        await rendered.waitForFrame(f => f.includes('current:'));

        rendered.mockInput.pressKey('p');
        await rendered.waitForFrame(f => f.includes('Sessions'));
        await rendered.waitForFrame(f => f.includes('Ghost session'));

        rendered.mockInput.pressEnter();
        await tick(30);
        await rendered.renderOnce();

        // Still open (never resumed), and the toast fired.
        const frame = rendered.captureCharFrame();
        expect(frame).toContain('Sessions');
        expect(frame).toContain('no longer exists');
        rendered.renderer.destroy();
    });
});

describe('deleting a session', () => {
    test('ctrl+d deletes the highlighted session and removes it from the list', async () => {
        const target = session({ id: 's1', title: 'Delete me' });
        const { deleteCalls } = mockSessionsApi([summary({ id: 's1', title: 'Delete me' })], { s1: target });

        const rendered = await mount();
        await rendered.waitForFrame(f => f.includes('current:'));

        rendered.mockInput.pressKey('p');
        await rendered.waitForFrame(f => f.includes('Sessions'));
        await rendered.waitForFrame(f => f.includes('Delete me'));

        rendered.mockInput.pressKey('d', { ctrl: true });
        await tick(30);
        await rendered.renderOnce();

        expect(deleteCalls).toEqual(['s1']);
        const frame = rendered.captureCharFrame();
        // The row is gone (only the toast's own echo of the title remains) and the list
        // falls back to its empty state.
        expect(frame).toContain('No sessions yet');
        expect(frame).toContain('Deleted "Delete me"');
        rendered.renderer.destroy();
    });

    test('shows the ctrl+d hint', async () => {
        mockSessionsApi([summary({ id: 's1', title: 'A session' })]);
        const rendered = await mount();
        await rendered.waitForFrame(f => f.includes('current:'));

        rendered.mockInput.pressKey('p');
        await rendered.waitForFrame(f => f.includes('Sessions'));
        const frame = await rendered.waitForFrame(f => f.includes('A session'));

        expect(frame).toContain('ctrl+d delete');
        rendered.renderer.destroy();
    });

    test('reports a failure instead of removing the row if the delete request fails', async () => {
        mockSessionsApi([summary({ id: 'gone', title: 'Already gone' })]);
        const rendered = await mount();
        await rendered.waitForFrame(f => f.includes('current:'));

        rendered.mockInput.pressKey('p');
        await rendered.waitForFrame(f => f.includes('Sessions'));
        await rendered.waitForFrame(f => f.includes('Already gone'));

        rendered.mockInput.pressKey('d', { ctrl: true });
        await tick(30);
        await rendered.renderOnce();

        // The row survives - the store still has nothing named 'gone' to delete, so the
        // request comes back 404 and this reports the failure rather than pretending it
        // worked.
        const frame = rendered.captureCharFrame();
        expect(frame).toContain('Already gone');
        expect(frame).toContain('Failed to delete session');
        rendered.renderer.destroy();
    });

    test('deleting the session currently open in chat starts a new one, instead of leaving a stale transcript on screen', async () => {
        const target = session({ id: 's1', title: 'Currently open' });
        mockSessionsApi([summary({ id: 's1', title: 'Currently open' })], { s1: target });

        const rendered = await mount();
        await rendered.waitForFrame(f => f.includes('current:'));

        // Resume it first, so chat.sessionId/messages reflect a live conversation - the
        // exact state this test needs to prove gets cleared. A settle tick between the
        // list actually rendering and the next keypress, same as elsewhere in this file -
        // OverlayList's own keyboard handler needs a moment to register once it mounts.
        rendered.mockInput.pressKey('p');
        await rendered.waitForFrame(f => f.includes('Currently open'));
        await tick(20);
        rendered.mockInput.pressEnter();
        await tick(30);
        await rendered.renderOnce();
        expect(rendered.captureCharFrame()).toContain('current:s1');
        expect(rendered.captureCharFrame()).toContain('messages:1');

        // Reopening mounts a brand new SessionPicker, which re-fetches listSessions() -
        // an extra settle tick here (unlike the fresh-mount case above) gives that mocked
        // fetch round trip room to actually resolve before waitForFrame starts polling for
        // its result; without it, waitForFrame's own poll loop doesn't yield the event
        // loop enough for the promise chain to drain and times out.
        rendered.mockInput.pressKey('p');
        await tick(50);
        await rendered.waitForFrame(f => f.includes('Currently open'));
        await tick(20);
        rendered.mockInput.pressKey('d', { ctrl: true });
        await tick(30);
        await rendered.renderOnce();

        const frame = rendered.captureCharFrame();
        expect(frame).toContain('current:none');
        expect(frame).toContain('messages:0');
        rendered.renderer.destroy();
    });

    test('deleting a different session leaves the currently open one untouched', async () => {
        const open = session({ id: 's1', title: 'Stay open' });
        mockSessionsApi(
            [summary({ id: 's1', title: 'Stay open' }), summary({ id: 's2', title: 'Delete this one' })],
            { s1: open },
        );

        const rendered = await mount();
        await rendered.waitForFrame(f => f.includes('current:'));

        rendered.mockInput.pressKey('p');
        await rendered.waitForFrame(f => f.includes('Stay open'));
        await tick(20);
        rendered.mockInput.pressEnter();
        await tick(30);
        await rendered.renderOnce();
        expect(rendered.captureCharFrame()).toContain('current:s1');

        // See the settle-tick comment in the previous test - reopening re-fetches.
        rendered.mockInput.pressKey('p');
        await tick(50);
        await rendered.waitForFrame(f => f.includes('Delete this one'));
        await tick(20);
        // "Stay open" sorts first (mockSessionsApi preserves list order) - step down once
        // to land on "Delete this one" before deleting.
        rendered.mockInput.pressArrow('down');
        await tick(20);
        rendered.mockInput.pressKey('d', { ctrl: true });
        await tick(30);
        await rendered.renderOnce();

        const frame = rendered.captureCharFrame();
        expect(frame).toContain('current:s1');
        expect(frame).toContain('messages:1');
        rendered.renderer.destroy();
    });
});

describe('SessionRenameForm', () => {
    function mountForm(props: Partial<Parameters<typeof SessionRenameForm>[0]> = {}) {
        const target = summary({ id: 's1', title: 'Old title' });
        const onRenamed = mock((_title: string) => {});
        const onFailed = mock((_error: unknown) => {});
        const layers = createLayerStack();
        layers.push('overlay');

        const setup = testRender(
            <KeyboardProvider layers={layers}>
                <SessionRenameForm session={target} onRenamed={onRenamed} onFailed={onFailed} {...props} />
            </KeyboardProvider>,
            { width: 60, height: 20, ...NO_BUILTIN_CTRL_C },
        );
        return setup.then(rendered => ({ ...rendered, onRenamed, onFailed }));
    }

    test('renders the current title in a pre-filled input', async () => {
        const rendered = await mountForm();
        const frame = await rendered.waitForFrame(f => f.includes('Rename session'));

        expect(frame).toContain('Rename session');
        expect(frame).toContain('Old title');
        rendered.renderer.destroy();
    });

    test('submitting unchanged calls onRenamed with the original title, no API call', async () => {
        mockFetch(async () => {
            throw new Error('should not have called the API for an unchanged title');
        });
        const rendered = await mountForm();
        await rendered.waitForFrame(f => f.includes('Rename session'));

        rendered.mockInput.pressEnter();
        await rendered.waitFor(() => rendered.onRenamed.mock.calls.length > 0);

        expect(rendered.onRenamed).toHaveBeenCalledWith('Old title');
        expect(rendered.onFailed).not.toHaveBeenCalled();
        rendered.renderer.destroy();
    });

    test('a non-blank edit renames via the API and calls onRenamed with the new title', async () => {
        const patchBodies: unknown[] = [];
        mockFetch(async (_input, init) => {
            patchBodies.push(JSON.parse(init?.body as string));
            return jsonResponse({ ok: true });
        });
        const rendered = await mountForm();
        await rendered.waitForFrame(f => f.includes('Rename session'));

        await rendered.mockInput.typeText(' updated', 15);
        await tick(20);
        rendered.mockInput.pressEnter();
        await rendered.waitFor(() => rendered.onRenamed.mock.calls.length > 0);

        expect(rendered.onRenamed).toHaveBeenCalledWith('Old title updated');
        expect(patchBodies).toEqual([{ title: 'Old title updated' }]);
        rendered.renderer.destroy();
    });

    test('reports a failure via onFailed rather than calling onRenamed', async () => {
        mockFetch(async () => jsonResponse({ error: 'bad title' }, 400));
        const rendered = await mountForm();
        await rendered.waitForFrame(f => f.includes('Rename session'));

        await rendered.mockInput.typeText(' updated', 15);
        await tick(20);
        rendered.mockInput.pressEnter();
        await rendered.waitFor(() => rendered.onFailed.mock.calls.length > 0);

        expect(rendered.onRenamed).not.toHaveBeenCalled();
        rendered.renderer.destroy();
    });
});

describe('renaming a session via the picker', () => {
    test('ctrl+r drops into the rename form for the highlighted session', async () => {
        mockSessionsApi([summary({ id: 's1', title: 'A session' })]);
        const rendered = await mount();
        await rendered.waitForFrame(f => f.includes('current:'));

        rendered.mockInput.pressKey('p');
        await rendered.waitForFrame(f => f.includes('A session'));
        await tick(20);
        rendered.mockInput.pressKey('r', { ctrl: true });
        await tick(50);
        const frame = await rendered.waitForFrame(f => f.includes('Rename session'));

        expect(frame).toContain('Rename session');
        expect(frame).toContain('A session');
        rendered.renderer.destroy();
    });

    test('a completed rename updates the row and shows a toast', async () => {
        const target = session({ id: 's1', title: 'Old name' });
        mockSessionsApi([summary({ id: 's1', title: 'Old name' })], { s1: target });
        const rendered = await mount();
        await rendered.waitForFrame(f => f.includes('current:'));

        rendered.mockInput.pressKey('p');
        await rendered.waitForFrame(f => f.includes('Old name'));
        await tick(20);
        rendered.mockInput.pressKey('r', { ctrl: true });
        await tick(50);
        await rendered.waitForFrame(f => f.includes('Rename session'));

        await rendered.mockInput.typeText(' updated', 15);
        await tick(20);
        rendered.mockInput.pressEnter();
        await tick(30);
        await rendered.renderOnce();

        const frame = rendered.captureCharFrame();
        expect(frame).toContain('Old name updated');
        expect(frame).toContain('Renamed to "Old name updated"');
        rendered.renderer.destroy();
    });

    test('submitting unchanged returns to the list without a toast or an API call', async () => {
        const { renameCalls } = mockSessionsApi([summary({ id: 's1', title: 'Same name' })]);
        const rendered = await mount();
        await rendered.waitForFrame(f => f.includes('current:'));

        rendered.mockInput.pressKey('p');
        await rendered.waitForFrame(f => f.includes('Same name'));
        await tick(20);
        rendered.mockInput.pressKey('r', { ctrl: true });
        await tick(50);
        await rendered.waitForFrame(f => f.includes('Rename session'));

        rendered.mockInput.pressEnter();
        await tick(30);
        await rendered.renderOnce();

        const frame = rendered.captureCharFrame();
        expect(frame).toContain('Same name');
        expect(frame).not.toContain('Renamed to');
        expect(renameCalls).toEqual([]);
        rendered.renderer.destroy();
    });

    test('renaming the session currently open in chat updates the Session screen\'s own title too', async () => {
        const target = session({ id: 's1', title: 'Currently open' });
        mockSessionsApi([summary({ id: 's1', title: 'Currently open' })], { s1: target });

        // Wider than the default 60 cols - the header/toast text otherwise wraps the
        // `title:...` label across lines in a way captureCharFrame's flat string can't
        // reliably match with a simple substring check.
        const rendered = await mount(100, 30);
        await rendered.waitForFrame(f => f.includes('current:'));

        // Resume it first, so it's the session currently open in chat.
        rendered.mockInput.pressKey('p');
        await rendered.waitForFrame(f => f.includes('Currently open'));
        await tick(20);
        rendered.mockInput.pressEnter();
        await tick(30);
        await rendered.renderOnce();
        expect(rendered.captureCharFrame()).toContain('title:Currently open');

        // See the settle-tick comment on the delete tests above - reopening re-fetches.
        rendered.mockInput.pressKey('p');
        await tick(50);
        await rendered.waitForFrame(f => f.includes('Currently open'));
        await tick(20);
        rendered.mockInput.pressKey('r', { ctrl: true });
        await tick(50);
        await rendered.waitForFrame(f => f.includes('Rename session'));

        await rendered.mockInput.typeText(' renamed', 15);
        await tick(20);
        rendered.mockInput.pressEnter();
        await tick(30);
        await rendered.renderOnce();

        expect(rendered.captureCharFrame()).toContain('title:Currently open renamed');
        rendered.renderer.destroy();
    });
});
