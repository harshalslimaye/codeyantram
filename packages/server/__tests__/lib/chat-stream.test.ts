import { describe, expect, test } from 'bun:test';
import type { RequestMessage } from '@codeyantram/shared';
import { toModelMessages } from '../../src/lib/chat-stream';

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
});
