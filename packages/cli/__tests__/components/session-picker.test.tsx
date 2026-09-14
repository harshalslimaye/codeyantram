import { describe, test, expect } from 'bun:test';
import { testRender } from '@opentui/react/test-utils';
import { useKeyboard } from '@opentui/react';
import type { Session, SessionSummary } from '@codeyantram/shared';
import { SessionPicker } from '../../src/components/session-picker';
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

/** A minimal stand-in for the real /sessions router - keyed by id for GET /sessions/:id,
 * one flat list for GET /sessions, everything else (there shouldn't be anything else in
 * these tests) answered generically. */
function mockSessionsApi(sessions: SessionSummary[], sessionsById: Record<string, Session> = {}) {
    mockFetch(async input => {
        const url = String(input);
        const idMatch = /\/sessions\/([^/?]+)/.exec(url);
        if (idMatch) {
            const session = sessionsById[idMatch[1] as string];
            return session === undefined ? jsonResponse({ error: 'not found' }, 404) : jsonResponse({ session });
        }
        if (url.includes('/sessions')) return jsonResponse({ sessions });
        return jsonResponse({ ok: true });
    });
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

// "p" opens the real overlay with a real SessionPicker inside it, and a persisting
// `current:<id>` label outside the overlay makes chat.sessionId observable both during and
// after the picker is used - same shape as model-picker.test.tsx's own Harness.
function Harness() {
    const chat = useChat();
    const overlay = useOverlay();
    const layers = useLayerStack();

    useKeyboard(key => {
        if (key.name !== 'p') return;
        if (!layers.isOnTop(ROOT_LAYER)) return;
        overlay.show('Sessions', <SessionPicker />);
    });

    return <text>current:{chat.sessionId ?? 'none'}</text>;
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
