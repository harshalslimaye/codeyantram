import { afterEach, describe, expect, test } from 'bun:test';
import { useKeyboard } from '@opentui/react';
import { testRender } from '@opentui/react/test-utils';
import { ThemeProvider } from '../../src/providers/theme';
import { ModelProvider } from '../../src/providers/model';
import { AgentProvider } from '../../src/providers/agent';
import { ToastProvider } from '../../src/providers/toast';
import { ChatProvider, useChat } from '../../src/providers/chat';
import { NO_BUILTIN_CTRL_C, tick } from '../support/mount';
import { mockFetch, pendingSseResponse, sseResponse } from '../support/sse';

const originalFetch = global.fetch;

afterEach(() => {
    global.fetch = originalFetch;
});

// Captures the live context value on every render so tests can call
// sendMessage/cancel directly and read state back, the same way a
// renderHook-style test would - ChatProvider has no keyboard of its own to
// drive through mockInput, so 's'/'c' here are test-only triggers.
let captured: ReturnType<typeof useChat> | null = null;

function Harness() {
    const chat = useChat();
    captured = chat;

    useKeyboard(key => {
        if (key.name === 's') chat.sendMessage('hello');
        if (key.name === 'c') chat.cancel();
        if (key.name === 'y') chat.respondToApproval(true);
        if (key.name === 'n') chat.respondToApproval(false);
    });

    return (
        <box>
            <text>streaming:{String(chat.isStreaming)}</text>
            <text>pending:{chat.pendingApproval?.toolName ?? 'none'}</text>
            {chat.messages.map(message => (
                <text key={message.id}>
                    {message.role}:
                    {message.parts.map(part => (part.type === 'text' ? part.text : '')).join('')}
                </text>
            ))}
        </box>
    );
}

function mount() {
    captured = null;
    // ThemeProvider is required here even though nothing in Harness reads
    // theme colors directly - a shown toast renders <Toast>, which does.
    return testRender(
        <ThemeProvider>
            <ModelProvider>
                <AgentProvider>
                    <ToastProvider>
                        <ChatProvider>
                            <Harness />
                        </ChatProvider>
                    </ToastProvider>
                </AgentProvider>
            </ModelProvider>
        </ThemeProvider>,
        { width: 60, height: 20, ...NO_BUILTIN_CTRL_C },
    );
}

describe('sendMessage', () => {
    test('appends the user message and streams deltas into a new assistant message', async () => {
        mockFetch(async () =>
            sseResponse([
                'data: {"type":"start","messageId":"m1"}\n\n',
                'data: {"type":"text-delta","text":"Hi "}\n\n',
                'data: {"type":"text-delta","text":"there"}\n\n',
                'data: {"type":"done","durationMs":5}\n\n',
            ]),
        );

        const rendered = await mount();
        await rendered.waitForFrame(f => f.includes('streaming:false'));

        rendered.mockInput.pressKey('s');
        await tick(50);

        expect(captured?.isStreaming).toBe(false);
        expect(captured?.messages).toEqual([
            { id: expect.any(String), role: 'user', parts: [{ type: 'text', text: 'hello' }] },
            { id: 'm1', role: 'assistant', parts: [{ type: 'text', text: 'Hi there' }] },
        ]);

        rendered.renderer.destroy();
    });

    test('a blank message is ignored', async () => {
        const rendered = await mount();
        await rendered.waitForFrame(f => f.includes('streaming:false'));

        captured?.sendMessage('   ');
        await tick(20);

        expect(captured?.messages).toEqual([]);
        expect(captured?.isStreaming).toBe(false);

        rendered.renderer.destroy();
    });

    test('a second call while one is already streaming is ignored (single-flight)', async () => {
        const pending = pendingSseResponse();
        let fetchCalls = 0;
        mockFetch(async () => {
            fetchCalls++;
            return pending.response;
        });

        const rendered = await mount();
        await rendered.waitForFrame(f => f.includes('streaming:false'));

        rendered.mockInput.pressKey('s');
        await tick(50);
        expect(captured?.isStreaming).toBe(true);

        rendered.mockInput.pressKey('s');
        await tick(20);

        expect(fetchCalls).toBe(1);
        expect(captured?.messages.filter(m => m.role === 'user')).toHaveLength(1);

        pending.push('data: {"type":"start","messageId":"m1"}\n\n');
        pending.push('data: {"type":"done","durationMs":1}\n\n');
        pending.close();
        await tick(50);

        expect(captured?.isStreaming).toBe(false);

        rendered.renderer.destroy();
    });
});

describe('error handling', () => {
    test('missing_credentials shows a toast and drops the empty assistant message', async () => {
        mockFetch(async () =>
            sseResponse([
                'data: {"type":"start","messageId":"m1"}\n\n',
                'data: {"type":"error","code":"missing_credentials","message":"No API key for anthropic."}\n\n',
            ]),
        );

        const rendered = await mount();
        await rendered.waitForFrame(f => f.includes('streaming:false'));

        rendered.mockInput.pressKey('s');
        await tick(50);

        expect(captured?.isStreaming).toBe(false);
        // Only the user message survives - the empty assistant bubble was dropped.
        expect(captured?.messages).toEqual([
            { id: expect.any(String), role: 'user', parts: [{ type: 'text', text: 'hello' }] },
        ]);

        await rendered.renderOnce();
        expect(rendered.captureCharFrame()).toContain('No API key for anthropic');

        rendered.renderer.destroy();
    });
});

describe('tool approval', () => {
    test('a pending tool call surfaces as pendingApproval once the turn ends', async () => {
        mockFetch(async () =>
            sseResponse([
                'data: {"type":"start","messageId":"m1"}\n\n',
                'data: {"type":"tool-call","toolCallId":"c1","toolName":"bash","args":{"command":"rm x"}}\n\n',
                'data: {"type":"tool-approval-request","toolCallId":"c1","approvalId":"a1"}\n\n',
                'data: {"type":"done","durationMs":5}\n\n',
            ]),
        );

        const rendered = await mount();
        await rendered.waitForFrame(f => f.includes('streaming:false'));

        rendered.mockInput.pressKey('s');
        await rendered.waitForFrame(f => f.includes('pending:bash'));

        expect(captured?.pendingApproval).toEqual({
            type: 'tool-call',
            toolCallId: 'c1',
            toolName: 'bash',
            args: { command: 'rm x' },
            approvalId: 'a1',
            approvalStatus: 'pending',
        });

        rendered.renderer.destroy();
    });

    test('approving sends a follow-up request carrying the decision, with no new user message', async () => {
        const requests: unknown[] = [];
        let call = 0;
        mockFetch(async (_url, init) => {
            requests.push(JSON.parse(init?.body as string));
            call++;
            return call === 1
                ? sseResponse([
                      'data: {"type":"start","messageId":"m1"}\n\n',
                      'data: {"type":"tool-call","toolCallId":"c1","toolName":"bash","args":{}}\n\n',
                      'data: {"type":"tool-approval-request","toolCallId":"c1","approvalId":"a1"}\n\n',
                      'data: {"type":"done","durationMs":5}\n\n',
                  ])
                : sseResponse([
                      'data: {"type":"start","messageId":"m2"}\n\n',
                      'data: {"type":"tool-result","toolCallId":"c1","result":"done"}\n\n',
                      'data: {"type":"text-delta","text":"finished"}\n\n',
                      'data: {"type":"done","durationMs":5}\n\n',
                  ]);
        });

        const rendered = await mount();
        await rendered.waitForFrame(f => f.includes('streaming:false'));

        rendered.mockInput.pressKey('s');
        await rendered.waitForFrame(f => f.includes('pending:bash'));

        rendered.mockInput.pressKey('y');
        await rendered.waitForFrame(f => f.includes('finished'));

        expect(call).toBe(2);
        expect(captured?.pendingApproval).toBeNull();
        expect(captured?.messages.filter(m => m.role === 'user')).toHaveLength(1);

        const secondRequest = requests[1] as { messages: unknown[] };
        expect(secondRequest.messages).toContainEqual({
            id: 'm1',
            role: 'assistant',
            parts: [
                {
                    type: 'tool-call',
                    toolCallId: 'c1',
                    toolName: 'bash',
                    args: {},
                    approvalId: 'a1',
                    approvalStatus: 'approved',
                },
            ],
        });

        rendered.renderer.destroy();
    });

    test('denying sends the decision and never executes the tool', async () => {
        let call = 0;
        mockFetch(async () => {
            call++;
            return call === 1
                ? sseResponse([
                      'data: {"type":"start","messageId":"m1"}\n\n',
                      'data: {"type":"tool-call","toolCallId":"c1","toolName":"bash","args":{}}\n\n',
                      'data: {"type":"tool-approval-request","toolCallId":"c1","approvalId":"a1"}\n\n',
                      'data: {"type":"done","durationMs":5}\n\n',
                  ])
                : sseResponse([
                      'data: {"type":"start","messageId":"m2"}\n\n',
                      'data: {"type":"tool-result","toolCallId":"c1","result":"Denied by user."}\n\n',
                      'data: {"type":"done","durationMs":5}\n\n',
                  ]);
        });

        const rendered = await mount();
        await rendered.waitForFrame(f => f.includes('streaming:false'));

        rendered.mockInput.pressKey('s');
        await rendered.waitForFrame(f => f.includes('pending:bash'));

        rendered.mockInput.pressKey('n');
        await rendered.waitForFrame(f => f.includes('pending:none') && f.includes('streaming:false'));

        expect(call).toBe(2);

        const resolvedCall = captured?.messages
            .flatMap(m => m.parts)
            .find((part): part is Extract<typeof part, { type: 'tool-call' }> => part.type === 'tool-call');
        expect(resolvedCall?.approvalStatus).toBe('denied');
        expect(resolvedCall?.result).toBe('Denied by user.');

        rendered.renderer.destroy();
    });
});

describe('cancel', () => {
    test('stops an in-flight stream without leaving isStreaming stuck true', async () => {
        const pending = pendingSseResponse();
        mockFetch(async (_url, init) => {
            pending.abortOn(init?.signal);
            return pending.response;
        });

        const rendered = await mount();
        await rendered.waitForFrame(f => f.includes('streaming:false'));

        rendered.mockInput.pressKey('s');
        await tick(50);
        expect(captured?.isStreaming).toBe(true);

        rendered.mockInput.pressKey('c');
        await tick(50);

        expect(captured?.isStreaming).toBe(false);

        rendered.renderer.destroy();
    });
});
