import { describe, expect, test } from 'bun:test';
import { testRender } from '@opentui/react/test-utils';
import { MockTreeSitterClient } from '@opentui/core/testing';
import type { ChatMessage } from '@codeyantram/shared';
import { MessageList } from '../../src/components/message-list';
import { ThemeProvider } from '../../src/providers/theme';
import { NO_BUILTIN_CTRL_C } from '../support/mount';

// A fresh MockTreeSitterClient per mount, rather than the real singleton -
// the real one spins up an actual WASM worker (slow, and needs
// OTUI_ASSET_ROOT wired correctly, see ../../src/tree-sitter-client.ts),
// which is unnecessary weight for a unit test that only cares that content
// ends up on screen. autoResolveTimeout keeps highlight requests resolving
// without each test having to call resolveHighlightOnce() itself.
function mount(messages: ChatMessage[], height = 20) {
    const treeSitterClient = new MockTreeSitterClient({ autoResolveTimeout: 10 });

    return testRender(
        <ThemeProvider>
            <MessageList messages={messages} treeSitterClient={treeSitterClient} />
        </ThemeProvider>,
        { width: 60, height, ...NO_BUILTIN_CTRL_C },
    );
}

describe('MessageList', () => {
    test('renders a user message and an assistant text reply, in order', async () => {
        const messages: ChatMessage[] = [
            { id: '1', role: 'user', parts: [{ type: 'text', text: 'hello there' }] },
            { id: '2', role: 'assistant', parts: [{ type: 'text', text: 'hi, how can I help' }] },
        ];

        const rendered = await mount(messages);
        const frame = await rendered.waitForFrame(f => f.includes('hi, how can I help'));

        expect(frame).toContain('hello there');
        expect(frame).toContain('hi, how can I help');
        expect(frame.indexOf('hello there')).toBeLessThan(frame.indexOf('hi, how can I help'));

        rendered.renderer.destroy();
    });

    test('joins consecutive text parts and renders a reasoning part alongside them', async () => {
        const messages: ChatMessage[] = [
            {
                id: '1',
                role: 'assistant',
                parts: [
                    { type: 'reasoning', text: 'thinking it through' },
                    { type: 'text', text: 'here is the answer' },
                ],
            },
        ];

        const rendered = await mount(messages);
        const frame = await rendered.waitForFrame(f => f.includes('here is the answer'));

        expect(frame).toContain('thinking it through');
        expect(frame).toContain('here is the answer');

        rendered.renderer.destroy();
    });

    test('shows a placeholder for an assistant message with no parts yet', async () => {
        const messages: ChatMessage[] = [{ id: '1', role: 'assistant', parts: [] }];

        const rendered = await mount(messages);
        const frame = await rendered.waitForFrame(f => f.includes('…'));

        expect(frame).toContain('…');

        rendered.renderer.destroy();
    });

    test('renders a tool-call part without crashing, before and after it resolves', async () => {
        const messages: ChatMessage[] = [
            {
                id: '1',
                role: 'assistant',
                parts: [
                    { type: 'tool-call', toolCallId: 'call-1', toolName: 'search', args: {} },
                    {
                        type: 'tool-call',
                        toolCallId: 'call-2',
                        toolName: 'read_file',
                        args: {},
                        result: 'contents',
                    },
                ],
            },
        ];

        const rendered = await mount(messages);
        const frame = await rendered.waitForFrame(f => f.includes('read_file'));

        expect(frame).toContain('search');
        expect(frame).toContain('running…');
        expect(frame).toContain('read_file');
        expect(frame).toContain('done');

        rendered.renderer.destroy();
    });

    test('renders a fenced code block inside an assistant reply', async () => {
        const messages: ChatMessage[] = [
            {
                id: '1',
                role: 'assistant',
                parts: [{ type: 'text', text: 'Here you go:\n\n```typescript\nconst x = 1;\n```' }],
            },
        ];

        const rendered = await mount(messages, 30);
        const frame = await rendered.waitForFrame(f => f.includes('Here you go:') && f.includes('const x = 1;'));

        expect(frame).toContain('Here you go:');
        expect(frame).toContain('const x = 1;');

        rendered.renderer.destroy();
    });
});
