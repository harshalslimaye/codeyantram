import { afterEach, describe, expect, test } from 'bun:test';
import { useKeyboard } from '@opentui/react';
import { testRender } from '@opentui/react/test-utils';
import { ThemeProvider } from '../../src/providers/theme';
import { ModelProvider } from '../../src/providers/model';
import { EffortProvider } from '../../src/providers/effort';
import { AgentProvider } from '../../src/providers/agent';
import { ToastProvider } from '../../src/providers/toast';
import { ChatProvider, useChat } from '../../src/providers/chat';
import { KeyboardProvider } from '../../src/providers/keyboard';
import { ApprovalOverlay } from '../../src/components/approval-overlay';
import { createLayerStack } from '../../src/keyboard';
import { NO_BUILTIN_CTRL_C, tick } from '../support/mount';
import { mockFetch, sseResponse } from '../support/sse';

const originalFetch = global.fetch;

afterEach(() => {
    global.fetch = originalFetch;
});

let captured: ReturnType<typeof useChat> | null = null;

function Harness() {
    const chat = useChat();
    captured = chat;

    useKeyboard(key => {
        if (key.name === 's') chat.sendMessage('hello');
    });

    return <text>streaming:{String(chat.isStreaming)}</text>;
}

function mount() {
    captured = null;
    const layers = createLayerStack();

    return testRender(
        <KeyboardProvider layers={layers}>
            <ThemeProvider>
                <ModelProvider>
                    <EffortProvider>
                        <AgentProvider>
                            <ToastProvider>
                                <ChatProvider>
                                    <Harness />
                                    <ApprovalOverlay />
                                </ChatProvider>
                            </ToastProvider>
                        </AgentProvider>
                    </EffortProvider>
                </ModelProvider>
            </ThemeProvider>
        </KeyboardProvider>,
        { width: 60, height: 20, ...NO_BUILTIN_CTRL_C },
    ).then(setup => ({ ...setup, layers }));
}

const APPROVAL_REQUEST_STREAM = [
    'data: {"type":"start","messageId":"m1"}\n\n',
    'data: {"type":"tool-call","toolCallId":"c1","toolName":"bash","args":{"command":"rm x"}}\n\n',
    'data: {"type":"tool-approval-request","toolCallId":"c1","approvalId":"a1"}\n\n',
    'data: {"type":"done","durationMs":5}\n\n',
];

describe('rendering', () => {
    test('shows the tool name and its arguments once approval is pending', async () => {
        mockFetch(async () => sseResponse(APPROVAL_REQUEST_STREAM));

        const rendered = await mount();
        await rendered.waitForFrame(f => f.includes('streaming:false'));
        rendered.mockInput.pressKey('s');

        const frame = await rendered.waitForFrame(f => f.includes('Approve tool call'));
        expect(frame).toContain('bash');
        expect(frame).toContain('command: rm x');

        rendered.renderer.destroy();
    });

    test('does not render while nothing is pending', async () => {
        const rendered = await mount();
        await rendered.waitForFrame(f => f.includes('streaming:false'));

        expect(rendered.captureCharFrame()).not.toContain('Approve tool call');

        rendered.renderer.destroy();
    });
});

describe('deciding', () => {
    test('pressing y approves, closes the overlay, and starts a follow-up turn', async () => {
        let call = 0;
        mockFetch(async () => {
            call++;
            return call === 1
                ? sseResponse(APPROVAL_REQUEST_STREAM)
                : sseResponse([
                      'data: {"type":"start","messageId":"m2"}\n\n',
                      'data: {"type":"tool-result","toolCallId":"c1","result":"ok"}\n\n',
                      'data: {"type":"done","durationMs":5}\n\n',
                  ]);
        });

        const rendered = await mount();
        await rendered.waitForFrame(f => f.includes('streaming:false'));
        rendered.mockInput.pressKey('s');
        await rendered.waitForFrame(f => f.includes('Approve tool call'));

        rendered.mockInput.pressKey('y');
        await tick(50);
        await rendered.renderOnce();

        expect(rendered.captureCharFrame()).not.toContain('Approve tool call');
        expect(call).toBe(2);
        expect(captured?.pendingApproval).toBeNull();

        rendered.renderer.destroy();
    });

    test('pressing n denies without a second request executing the tool', async () => {
        let call = 0;
        mockFetch(async () => {
            call++;
            return call === 1
                ? sseResponse(APPROVAL_REQUEST_STREAM)
                : sseResponse([
                      'data: {"type":"start","messageId":"m2"}\n\n',
                      'data: {"type":"tool-result","toolCallId":"c1","result":"Denied by user."}\n\n',
                      'data: {"type":"done","durationMs":5}\n\n',
                  ]);
        });

        const rendered = await mount();
        await rendered.waitForFrame(f => f.includes('streaming:false'));
        rendered.mockInput.pressKey('s');
        await rendered.waitForFrame(f => f.includes('Approve tool call'));

        rendered.mockInput.pressKey('n');
        await tick(50);
        await rendered.renderOnce();

        expect(rendered.captureCharFrame()).not.toContain('Approve tool call');
        expect(call).toBe(2);

        rendered.renderer.destroy();
    });

    test('escape denies rather than leaving the overlay stuck open', async () => {
        let call = 0;
        mockFetch(async () => {
            call++;
            return call === 1
                ? sseResponse(APPROVAL_REQUEST_STREAM)
                : sseResponse([
                      'data: {"type":"start","messageId":"m2"}\n\n',
                      'data: {"type":"tool-result","toolCallId":"c1","result":"Denied by user."}\n\n',
                      'data: {"type":"done","durationMs":5}\n\n',
                  ]);
        });

        const rendered = await mount();
        await rendered.waitForFrame(f => f.includes('streaming:false'));
        rendered.mockInput.pressKey('s');
        await rendered.waitForFrame(f => f.includes('Approve tool call'));

        rendered.mockInput.pressEscape();
        await tick(50);
        await rendered.renderOnce();

        expect(rendered.captureCharFrame()).not.toContain('Approve tool call');
        expect(call).toBe(2);

        rendered.renderer.destroy();
    });
});
