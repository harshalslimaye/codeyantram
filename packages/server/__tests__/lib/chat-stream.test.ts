import { describe, expect, test } from 'bun:test';
import { streamText } from 'ai';
import { MockLanguageModelV4, simulateReadableStream } from 'ai/test';
import type { RequestMessage } from '@codeyantram/shared';
import { toModelMessages } from '../../src/lib/chat-stream';
import { buildProjectTools } from '../../src/tools';

describe('toModelMessages', () => {
    test('joins a user message\'s text parts into one user message', () => {
        const messages: RequestMessage[] = [
            { id: '1', role: 'user', parts: [{ type: 'text', text: 'hello' }] },
        ];

        expect(toModelMessages(messages)).toEqual([{ role: 'user', content: 'hello' }]);
    });

    test('joins an assistant message\'s text parts into one assistant message', () => {
        const messages: RequestMessage[] = [
            {
                id: '2',
                role: 'assistant',
                parts: [
                    { type: 'text', text: 'Hel' },
                    { type: 'text', text: 'lo' },
                ],
            },
        ];

        expect(toModelMessages(messages)).toEqual([{ role: 'assistant', content: 'Hello' }]);
    });

    test('a text-only conversation round-trips as user/assistant pairs', () => {
        const messages: RequestMessage[] = [
            { id: '1', role: 'user', parts: [{ type: 'text', text: 'hi' }] },
            { id: '2', role: 'assistant', parts: [{ type: 'text', text: 'hello there' }] },
            { id: '3', role: 'user', parts: [{ type: 'text', text: 'how are you' }] },
        ];

        expect(toModelMessages(messages)).toEqual([
            { role: 'user', content: 'hi' },
            { role: 'assistant', content: 'hello there' },
            { role: 'user', content: 'how are you' },
        ]);
    });

    test('an unresolved tool call becomes an assistant tool-call message with no matching tool message', () => {
        const messages: RequestMessage[] = [
            {
                id: '2',
                role: 'assistant',
                parts: [{ type: 'tool-call', toolCallId: 'call-1', toolName: 'search', args: { query: 'x' } }],
            },
        ];

        expect(toModelMessages(messages)).toEqual([
            {
                role: 'assistant',
                content: [{ type: 'tool-call', toolCallId: 'call-1', toolName: 'search', input: { query: 'x' } }],
            },
        ]);
    });

    test('a resolved tool call also emits a paired tool-result message', () => {
        const messages: RequestMessage[] = [
            {
                id: '2',
                role: 'assistant',
                parts: [
                    {
                        type: 'tool-call',
                        toolCallId: 'call-1',
                        toolName: 'search',
                        args: { query: 'x' },
                        result: 'found it',
                    },
                ],
            },
        ];

        expect(toModelMessages(messages)).toEqual([
            {
                role: 'assistant',
                content: [{ type: 'tool-call', toolCallId: 'call-1', toolName: 'search', input: { query: 'x' } }],
            },
            {
                role: 'tool',
                content: [
                    {
                        type: 'tool-result',
                        toolCallId: 'call-1',
                        toolName: 'search',
                        output: { type: 'text', value: 'found it' },
                    },
                ],
            },
        ]);
    });

    test('an assistant message mixing text and tool calls emits both a text message and the tool-call message', () => {
        const messages: RequestMessage[] = [
            {
                id: '2',
                role: 'assistant',
                parts: [
                    { type: 'text', text: 'Let me check.' },
                    { type: 'tool-call', toolCallId: 'call-1', toolName: 'search', args: {} },
                ],
            },
        ];

        expect(toModelMessages(messages)).toEqual([
            { role: 'assistant', content: 'Let me check.' },
            {
                role: 'assistant',
                content: [{ type: 'tool-call', toolCallId: 'call-1', toolName: 'search', input: {} }],
            },
        ]);
    });

    test('a pending approval adds a tool-approval-request to the assistant message and no tool message', () => {
        const messages: RequestMessage[] = [
            {
                id: '2',
                role: 'assistant',
                parts: [
                    {
                        type: 'tool-call',
                        toolCallId: 'call-1',
                        toolName: 'bash',
                        args: { command: 'rm -rf x' },
                        approvalId: 'appr-1',
                        approvalStatus: 'pending',
                    },
                ],
            },
        ];

        expect(toModelMessages(messages)).toEqual([
            {
                role: 'assistant',
                content: [
                    { type: 'tool-call', toolCallId: 'call-1', toolName: 'bash', input: { command: 'rm -rf x' } },
                    { type: 'tool-approval-request', approvalId: 'appr-1', toolCallId: 'call-1' },
                ],
            },
        ]);
    });

    test('a decided-but-not-yet-executed approval emits a tool-approval-response with no tool-result', () => {
        const messages: RequestMessage[] = [
            {
                id: '2',
                role: 'assistant',
                parts: [
                    {
                        type: 'tool-call',
                        toolCallId: 'call-1',
                        toolName: 'bash',
                        args: {},
                        approvalId: 'appr-1',
                        approvalStatus: 'approved',
                    },
                ],
            },
        ];

        expect(toModelMessages(messages)).toEqual([
            {
                role: 'assistant',
                content: [
                    { type: 'tool-call', toolCallId: 'call-1', toolName: 'bash', input: {} },
                    { type: 'tool-approval-request', approvalId: 'appr-1', toolCallId: 'call-1' },
                ],
            },
            {
                role: 'tool',
                content: [{ type: 'tool-approval-response', approvalId: 'appr-1', approved: true }],
            },
        ]);
    });

    test('an approved and executed call emits both the approval response and the tool-result, in that order', () => {
        const messages: RequestMessage[] = [
            {
                id: '2',
                role: 'assistant',
                parts: [
                    {
                        type: 'tool-call',
                        toolCallId: 'call-1',
                        toolName: 'bash',
                        args: {},
                        approvalId: 'appr-1',
                        approvalStatus: 'approved',
                        result: 'ok',
                    },
                ],
            },
        ];

        expect(toModelMessages(messages)[1]).toEqual({
            role: 'tool',
            content: [
                { type: 'tool-approval-response', approvalId: 'appr-1', approved: true },
                {
                    type: 'tool-result',
                    toolCallId: 'call-1',
                    toolName: 'bash',
                    output: { type: 'text', value: 'ok' },
                },
            ],
        });
    });

    test('a denied approval emits approved: false', () => {
        const messages: RequestMessage[] = [
            {
                id: '2',
                role: 'assistant',
                parts: [
                    {
                        type: 'tool-call',
                        toolCallId: 'call-1',
                        toolName: 'bash',
                        args: {},
                        approvalId: 'appr-1',
                        approvalStatus: 'denied',
                    },
                ],
            },
        ];

        expect(toModelMessages(messages)[1]).toEqual({
            role: 'tool',
            content: [{ type: 'tool-approval-response', approvalId: 'appr-1', approved: false }],
        });
    });
});

// Exercises the exact call streamChatResponse makes - streamText with the tool
// set buildProjectTools returns - against a mocked model that calls a mutating
// tool, without going through HTTP or model resolution. The AI SDK decides
// whether to emit "tool-approval-request" purely from each tool's own
// needsApproval (see buildProjectTools' skipApproval), so this is a real
// exercise of that mechanism, not a re-assertion of what tools.test.ts already
// checks statically.
describe('approval bypass (Yolo) through streamText', () => {
    function mutatingToolCallModel() {
        return new MockLanguageModelV4({
            doStream: async () => ({
                stream: simulateReadableStream({
                    chunks: [
                        { type: 'stream-start', warnings: [] },
                        {
                            type: 'tool-call',
                            toolCallId: 'call-1',
                            toolName: 'write_file',
                            input: JSON.stringify({ path: 'x.txt', content: 'hi' }),
                        },
                        {
                            type: 'finish',
                            finishReason: { unified: 'tool-calls' as const, raw: undefined },
                            usage: {
                                inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined },
                                outputTokens: { total: 1, text: 1, reasoning: undefined },
                            },
                        },
                    ],
                }),
            }),
        });
    }

    async function partTypes(skipApproval: boolean): Promise<string[]> {
        const tools = buildProjectTools('/tmp', false, true, skipApproval);
        const result = streamText({
            model: mutatingToolCallModel(),
            tools,
            messages: [{ role: 'user', content: 'write a file' }],
        });

        const types: string[] = [];
        for await (const part of result.stream) types.push(part.type);
        return types;
    }

    test('skipApproval: true (Yolo) never emits tool-approval-request for a mutating call', async () => {
        const types = await partTypes(true);
        expect(types).toContain('tool-call');
        expect(types).not.toContain('tool-approval-request');
    });

    test('skipApproval: false (Build) still emits tool-approval-request for the same call', async () => {
        const types = await partTypes(false);
        expect(types).toContain('tool-call');
        expect(types).toContain('tool-approval-request');
    });
});
