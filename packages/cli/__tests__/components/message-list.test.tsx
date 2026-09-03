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

    test('summarizes a tool call\'s arguments - path, pattern, or command depending on the tool', async () => {
        const messages: ChatMessage[] = [
            {
                id: '1',
                role: 'assistant',
                parts: [
                    { type: 'tool-call', toolCallId: 'c1', toolName: 'read_file', args: { path: 'src/a.ts' } },
                    { type: 'tool-call', toolCallId: 'c2', toolName: 'grep', args: { pattern: 'TODO', path: 'src' } },
                    { type: 'tool-call', toolCallId: 'c3', toolName: 'bash', args: { command: 'ls -la' } },
                ],
            },
        ];

        const rendered = await mount(messages);
        const frame = await rendered.waitForFrame(f => f.includes('ls -la'));

        expect(frame).toContain('src/a.ts');
        expect(frame).toContain('TODO in src');
        expect(frame).toContain('ls -la');

        rendered.renderer.destroy();
    });

    test('summarizes a web_fetch call as host+path, dropping the query string', async () => {
        const messages: ChatMessage[] = [
            {
                id: '1',
                role: 'assistant',
                parts: [{ type: 'tool-call', toolCallId: 'c1', toolName: 'web_fetch', args: { url: 'https://example.com/docs/guide?query=1' } }],
            },
        ];

        const rendered = await mount(messages);
        const frame = await rendered.waitForFrame(f => f.includes('example.com'));

        expect(frame).toContain('example.com/docs/guide');
        expect(frame).not.toContain('query=1');

        rendered.renderer.destroy();
    });

    test('notes paging and refresh on a web_fetch call', async () => {
        const messages: ChatMessage[] = [
            {
                id: '1',
                role: 'assistant',
                parts: [
                    { type: 'tool-call', toolCallId: 'c1', toolName: 'web_fetch', args: { url: 'https://example.com/page', offset: 10, limit: 5 } },
                    { type: 'tool-call', toolCallId: 'c2', toolName: 'web_fetch', args: { url: 'https://example.com/page', refresh: true } },
                ],
            },
        ];

        const rendered = await mount(messages);
        const frame = await rendered.waitForFrame(f => f.includes('refresh'));

        expect(frame).toContain('lines 10-14');
        expect(frame).toContain('(refresh)');

        rendered.renderer.destroy();
    });

    test('falls back to the raw string for a web_fetch call with an unparseable url', async () => {
        const messages: ChatMessage[] = [
            { id: '1', role: 'assistant', parts: [{ type: 'tool-call', toolCallId: 'c1', toolName: 'web_fetch', args: { url: 'not a url' } }] },
        ];

        const rendered = await mount(messages);
        const frame = await rendered.waitForFrame(f => f.includes('not a url'));

        expect(frame).toContain('not a url');

        rendered.renderer.destroy();
    });

    test('omits the summary line for a tool with no recognized argument to show', async () => {
        const messages: ChatMessage[] = [
            { id: '1', role: 'assistant', parts: [{ type: 'tool-call', toolCallId: 'c1', toolName: 'search', args: {} }] },
        ];

        const rendered = await mount(messages);
        const frame = await rendered.waitForFrame(f => f.includes('search'));

        expect(frame).toContain('search');
        expect(frame).toContain('running…');

        rendered.renderer.destroy();
    });

    test('shows needs-approval and denied states', async () => {
        const messages: ChatMessage[] = [
            {
                id: '1',
                role: 'assistant',
                parts: [
                    {
                        type: 'tool-call',
                        toolCallId: 'c1',
                        toolName: 'bash',
                        args: { command: 'rm -rf x' },
                        approvalId: 'a1',
                        approvalStatus: 'pending',
                    },
                    {
                        type: 'tool-call',
                        toolCallId: 'c2',
                        toolName: 'bash',
                        args: { command: 'rm -rf y' },
                        approvalId: 'a2',
                        approvalStatus: 'denied',
                    },
                ],
            },
        ];

        const rendered = await mount(messages);
        const frame = await rendered.waitForFrame(f => f.includes('denied'));

        expect(frame).toContain('needs approval');
        expect(frame).toContain('denied');

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

    describe('per-turn cost summary', () => {
        test('shows input/output token counts under a reply', async () => {
            const messages: ChatMessage[] = [
                {
                    id: '1',
                    role: 'assistant',
                    parts: [{ type: 'text', text: 'hi' }],
                    usage: { inputTokens: 1200, outputTokens: 45 },
                },
            ];

            const rendered = await mount(messages);
            const frame = await rendered.waitForFrame(f => f.includes('1.2k in'));

            expect(frame).toContain('1.2k in');
            expect(frame).toContain('45 out');
            rendered.renderer.destroy();
        });

        test('shows the instruction filename and size alongside token usage when that turn loaded one', async () => {
            const messages: ChatMessage[] = [
                {
                    id: '1',
                    role: 'assistant',
                    parts: [{ type: 'text', text: 'hi' }],
                    usage: { inputTokens: 100, outputTokens: 10 },
                    projectInstructions: { filename: 'AGENTS.md', bytes: 2048, truncated: false },
                },
            ];

            const rendered = await mount(messages);
            const frame = await rendered.waitForFrame(f => f.includes('AGENTS.md'));

            expect(frame).toContain('100 in');
            expect(frame).toContain('AGENTS.md 2.0KB');
            expect(frame).not.toContain('(cut)');
            rendered.renderer.destroy();
        });

        test('flags a truncated instruction file', async () => {
            const messages: ChatMessage[] = [
                {
                    id: '1',
                    role: 'assistant',
                    parts: [{ type: 'text', text: 'hi' }],
                    projectInstructions: { filename: 'AGENTS.md', bytes: 32000, truncated: true },
                },
            ];

            const rendered = await mount(messages);
            const frame = await rendered.waitForFrame(f => f.includes('(cut)'));

            expect(frame).toContain('AGENTS.md');
            expect(frame).toContain('(cut)');
            rendered.renderer.destroy();
        });

        test('shows bytes under a kilobyte without the KB suffix', async () => {
            const messages: ChatMessage[] = [
                {
                    id: '1',
                    role: 'assistant',
                    parts: [{ type: 'text', text: 'hi' }],
                    projectInstructions: { filename: 'AGENTS.md', bytes: 42, truncated: false },
                },
            ];

            const rendered = await mount(messages);
            const frame = await rendered.waitForFrame(f => f.includes('AGENTS.md'));

            expect(frame).toContain('AGENTS.md 42B');
            rendered.renderer.destroy();
        });

        test('shows nothing when a turn has neither usage nor instructions', async () => {
            const messages: ChatMessage[] = [{ id: '1', role: 'assistant', parts: [{ type: 'text', text: 'hi' }] }];

            const rendered = await mount(messages);
            const frame = await rendered.waitForFrame(f => f.includes('hi'));

            expect(frame).not.toContain('in ·');
            expect(frame).not.toContain('AGENTS.md');
            rendered.renderer.destroy();
        });
    });
});
