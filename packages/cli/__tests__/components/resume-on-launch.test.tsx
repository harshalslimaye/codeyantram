import { describe, test, expect } from 'bun:test';
import { testRender } from '@opentui/react/test-utils';
import type { Session, SessionSummary } from '@codeyantram/shared';
import { ResumeOnLaunch } from '../../src/components/resume-on-launch';
import { ThemeProvider } from '../../src/providers/theme';
import { ModelProvider } from '../../src/providers/model';
import { EffortProvider } from '../../src/providers/effort';
import { AgentProvider } from '../../src/providers/agent';
import { ToastProvider } from '../../src/providers/toast';
import { ChatProvider, useChat } from '../../src/providers/chat';
import { NO_BUILTIN_CTRL_C } from '../support/mount';
import { mockFetch } from '../support/sse';
import type { ResumeTarget } from '../../src/resume';

function jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

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
        updatedAt: 2,
        modelId: 'claude-sonnet-5',
        agentName: 'Talk',
        effort: null,
        messageCount: 1,
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

function Harness({ target }: { target: ResumeTarget }) {
    const chat = useChat();
    return (
        <box>
            <ResumeOnLaunch target={target} />
            <text>messages:{chat.messages.length}</text>
            <text>session:{chat.sessionId ?? 'none'}</text>
        </box>
    );
}

function mount(target: ResumeTarget) {
    return testRender(
        <ThemeProvider>
            <ModelProvider>
                <EffortProvider>
                    <AgentProvider>
                        <ToastProvider>
                            <ChatProvider>
                                <Harness target={target} />
                            </ChatProvider>
                        </ToastProvider>
                    </AgentProvider>
                </EffortProvider>
            </ModelProvider>
        </ThemeProvider>,
        { width: 60, height: 20, ...NO_BUILTIN_CTRL_C },
    );
}

describe('--continue', () => {
    test('resumes the most recently updated session', async () => {
        const target = session({ id: 's-recent', title: 'Recent' });
        mockSessionsApi(
            [summary({ id: 's-recent', title: 'Recent' }), summary({ id: 's-older', title: 'Older' })],
            { 's-recent': target },
        );

        const rendered = await mount({ mode: 'continue' });
        await rendered.waitFor(() => rendered.captureCharFrame().includes('session:s-recent'));

        expect(rendered.captureCharFrame()).toContain('messages:1');
        rendered.renderer.destroy();
    });

    test('shows an info toast and starts fresh when there is nothing to continue', async () => {
        mockSessionsApi([]);

        const rendered = await mount({ mode: 'continue' });
        await rendered.waitFor(() => rendered.captureCharFrame().includes('No previous session'));

        expect(rendered.captureCharFrame()).toContain('messages:0');
        rendered.renderer.destroy();
    });

    test('warns and starts fresh if the most recent session was deleted out from under it', async () => {
        mockSessionsApi([summary({ id: 'gone' })]);

        const rendered = await mount({ mode: 'continue' });
        await rendered.waitFor(() => rendered.captureCharFrame().includes('no longer exists'));

        expect(rendered.captureCharFrame()).toContain('messages:0');
        rendered.renderer.destroy();
    });
});

describe('--resume <id>', () => {
    test('resumes that specific session', async () => {
        const target = session({ id: 'specific', title: 'The one I want' });
        mockSessionsApi([], { specific: target });

        const rendered = await mount({ mode: 'resume', id: 'specific' });
        await rendered.waitFor(() => rendered.captureCharFrame().includes('session:specific'));

        expect(rendered.captureCharFrame()).toContain('messages:1');
        rendered.renderer.destroy();
    });

    test('warns and starts fresh if no session has that id', async () => {
        mockSessionsApi([]);

        const rendered = await mount({ mode: 'resume', id: 'missing' });
        await rendered.waitFor(() => rendered.captureCharFrame().includes('No session found with id missing'));

        expect(rendered.captureCharFrame()).toContain('messages:0');
        rendered.renderer.destroy();
    });
});

describe('failure', () => {
    test('an unreachable server shows an error toast rather than crashing', async () => {
        mockFetch(async () => {
            throw new Error('ECONNREFUSED');
        });

        const rendered = await mount({ mode: 'continue' });
        await rendered.waitFor(() => rendered.captureCharFrame().includes('Failed to resume'));

        expect(rendered.captureCharFrame()).toContain('messages:0');
        rendered.renderer.destroy();
    });
});
