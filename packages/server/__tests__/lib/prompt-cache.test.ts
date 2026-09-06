import { describe, expect, test } from 'bun:test';
import type { ModelMessage } from 'ai';
import type { RequestMessage } from '@codeyantram/shared';
import { toModelMessages } from '../../src/lib/chat-stream';
import {
    CONVERSATION_CACHE_CONTROL,
    rollConversationCache,
    supportsCacheControl,
    withConversationCache,
} from '../../src/lib/prompt-cache';

/** Index of every message carrying an Anthropic cache breakpoint. */
function markedIndexes(messages: ModelMessage[]): number[] {
    return messages.flatMap((message, index) =>
        message.providerOptions?.anthropic?.cacheControl !== undefined ? [index] : [],
    );
}

describe('supportsCacheControl', () => {
    test('only Anthropic takes explicit breakpoints', () => {
        expect(supportsCacheControl('anthropic')).toBe(true);
        expect(supportsCacheControl('openai')).toBe(false);
        expect(supportsCacheControl('google')).toBe(false);
        expect(supportsCacheControl('deepseek')).toBe(false);
    });
});

describe('withConversationCache', () => {
    test('hands back the very same array for a provider without explicit breakpoints', () => {
        const messages: ModelMessage[] = [{ role: 'user', content: 'hello' }];

        // Identity, not just equality - nothing is copied for the three providers that
        // cache automatically.
        expect(withConversationCache(messages, 'openai')).toBe(messages);
    });

    test('marks the trailing user message', () => {
        const messages: ModelMessage[] = [
            { role: 'user', content: 'hi' },
            { role: 'assistant', content: 'hello there' },
            { role: 'user', content: 'and now?' },
        ];

        const marked = withConversationCache(messages, 'anthropic');

        expect(markedIndexes(marked)).toEqual([2]);
        expect(marked[2]?.providerOptions).toEqual(CONVERSATION_CACHE_CONTROL);
    });

    test('marks exactly one message', () => {
        const messages: ModelMessage[] = [
            { role: 'user', content: 'hi' },
            { role: 'assistant', content: 'one' },
            { role: 'user', content: 'more' },
            { role: 'assistant', content: 'two' },
        ];

        expect(markedIndexes(withConversationCache(messages, 'anthropic'))).toHaveLength(1);
    });

    test('anchors on a tool message carrying a real tool result', () => {
        const messages: ModelMessage[] = toModelMessages([
            { id: '1', role: 'user', parts: [{ type: 'text', text: 'read it' }] },
            {
                id: '2',
                role: 'assistant',
                parts: [
                    {
                        type: 'tool-call',
                        toolCallId: 'c1',
                        toolName: 'read_file',
                        args: { path: 'a.ts' },
                        result: '1\tconst a = 1;',
                    },
                ],
            },
        ] satisfies RequestMessage[]);

        const marked = withConversationCache(messages, 'anthropic');

        expect(marked[marked.length - 1]?.role).toBe('tool');
        expect(markedIndexes(marked)).toEqual([marked.length - 1]);
    });

    test('skips a tool message that is only an approval response, the approval round trip', () => {
        // An approved-but-not-yet-run call replays as assistant [tool-call,
        // tool-approval-request] + tool [tool-approval-response]. The Anthropic converter
        // renders neither approval part, so a breakpoint on that trailing tool message
        // would be dropped without any error - it belongs on the tool call instead.
        const messages: ModelMessage[] = toModelMessages([
            { id: '1', role: 'user', parts: [{ type: 'text', text: 'delete it' }] },
            {
                id: '2',
                role: 'assistant',
                parts: [
                    {
                        type: 'tool-call',
                        toolCallId: 'c1',
                        toolName: 'bash',
                        args: { command: 'rm x' },
                        approvalId: 'appr-1',
                        approvalStatus: 'approved',
                    },
                ],
            },
        ] satisfies RequestMessage[]);

        const marked = withConversationCache(messages, 'anthropic');

        expect(marked[marked.length - 1]?.role).toBe('tool');
        expect(markedIndexes(marked)).toEqual([marked.length - 2]);
        expect(marked[marked.length - 2]?.role).toBe('assistant');
    });

    test('skips an empty assistant message left by a cancelled turn', () => {
        const messages: ModelMessage[] = [
            { role: 'user', content: 'hi' },
            { role: 'assistant', content: '' },
        ];

        expect(markedIndexes(withConversationCache(messages, 'anthropic'))).toEqual([0]);
    });

    test('marks nothing rather than throwing when there is nothing to anchor on', () => {
        expect(withConversationCache([], 'anthropic')).toEqual([]);
        expect(markedIndexes(withConversationCache([{ role: 'assistant', content: '' }], 'anthropic'))).toEqual([]);
    });

    test('adds a second breakpoint once the conversation outgrows the lookback window', () => {
        // 20 rendering messages: the tail, plus one 15 positions back from it.
        const messages: ModelMessage[] = Array.from({ length: 20 }, (_, index) => ({
            role: index % 2 === 0 ? ('user' as const) : ('assistant' as const),
            content: `message ${index}`,
        }));

        const marked = markedIndexes(withConversationCache(messages, 'anthropic'));

        expect(marked).toEqual([4, 19]);
        expect(marked[1]! - marked[0]!).toBe(15);
    });

    test('never marks more than the two breakpoints Anthropic has left after the system prompt', () => {
        const messages: ModelMessage[] = Array.from({ length: 60 }, (_, index) => ({
            role: index % 2 === 0 ? ('user' as const) : ('assistant' as const),
            content: `message ${index}`,
        }));

        expect(markedIndexes(withConversationCache(messages, 'anthropic'))).toHaveLength(2);
    });

    test('keeps the two markers within the lookback window across a full 15-step tool loop', () => {
        // What MAX_TOOL_STEPS actually produces: an assistant tool-call message and a tool
        // result message per step, i.e. 30 rendering positions appended in one turn - more
        // than the 20-position window, which is the case this second marker exists for.
        const history: RequestMessage[] = [
            { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'go' }] },
            ...Array.from({ length: 15 }, (_, step) => ({
                id: `a${step}`,
                role: 'assistant' as const,
                parts: [
                    {
                        type: 'tool-call' as const,
                        toolCallId: `c${step}`,
                        toolName: 'read_file',
                        args: { path: `f${step}.ts` },
                        result: 'ok',
                    },
                ],
            })),
        ];

        const marked = markedIndexes(withConversationCache(toModelMessages(history), 'anthropic'));

        expect(marked).toHaveLength(2);
        expect(marked[1]! - marked[0]!).toBeLessThanOrEqual(20);
    });

    test('counts only rendering messages toward the lookback margin', () => {
        // Empty assistant messages are invisible to the provider, so they must not push
        // the second marker further back than 15 real positions.
        const messages: ModelMessage[] = Array.from({ length: 40 }, (_, index) =>
            index % 2 === 0
                ? { role: 'user' as const, content: `message ${index}` }
                : { role: 'assistant' as const, content: '' },
        );

        const marked = markedIndexes(withConversationCache(messages, 'anthropic'));

        expect(marked).toHaveLength(2);
        // 20 rendering messages at even indexes: the tail at 38, and 15 back at 8.
        expect(marked).toEqual([8, 38]);
    });

    test('moves the breakpoints instead of accumulating them when re-run', () => {
        const first = withConversationCache([{ role: 'user', content: 'hi' }], 'anthropic');

        // What a later step sees: the already-marked messages plus what the turn produced.
        const grown: ModelMessage[] = [...first, { role: 'assistant', content: 'a reply' }];
        const second = withConversationCache(grown, 'anthropic');

        expect(markedIndexes(second)).toEqual([1]);
        expect(second[0]?.providerOptions).toBeUndefined();
    });

    test('re-marking the same array is a no-op beyond copying it', () => {
        const messages: ModelMessage[] = [
            { role: 'user', content: 'hi' },
            { role: 'assistant', content: 'hello' },
        ];

        const once = withConversationCache(messages, 'anthropic');
        const twice = withConversationCache(once, 'anthropic');

        expect(twice).toEqual(once);
    });

    test('clearing a breakpoint leaves the rest of the message\'s provider options alone', () => {
        const messages: ModelMessage[] = [
            { role: 'user', content: 'hi', providerOptions: { anthropic: { cacheControl: { type: 'ephemeral' } } } },
            { role: 'user', content: 'there', providerOptions: { openai: { x: 1 }, anthropic: { somethingElse: true } } },
        ];

        const marked = withConversationCache(messages, 'anthropic');

        expect(marked[0]?.providerOptions).toBeUndefined();
        expect(marked[1]?.providerOptions).toEqual({ openai: { x: 1 }, anthropic: { somethingElse: true, cacheControl: { type: 'ephemeral' } } });
    });

    test('never touches a system message, whose breakpoints belong to the system prompt', () => {
        const messages: ModelMessage[] = [
            { role: 'system', content: 'you are a coding assistant', providerOptions: CONVERSATION_CACHE_CONTROL },
            { role: 'user', content: 'hi' },
        ];

        const marked = withConversationCache(messages, 'anthropic');

        expect(marked[0]).toBe(messages[0]!);
        expect(markedIndexes(marked)).toEqual([0, 1]);
    });

    test('leaves the caller\'s array and messages untouched', () => {
        const messages: ModelMessage[] = [{ role: 'user', content: 'hi' }];

        withConversationCache(messages, 'anthropic');

        expect(messages[0]?.providerOptions).toBeUndefined();
    });

    test('keeps another provider\'s options on the message it marks', () => {
        const messages: ModelMessage[] = [{ role: 'user', content: 'hi', providerOptions: { openai: { x: 1 } } }];

        const marked = withConversationCache(messages, 'anthropic');

        expect(marked[0]?.providerOptions).toEqual({ openai: { x: 1 }, ...CONVERSATION_CACHE_CONTROL });
    });
});

describe('rollConversationCache', () => {
    test('leaves a step alone for a provider without explicit breakpoints', () => {
        expect(rollConversationCache([{ role: 'user', content: 'hi' }], 'openai')).toBeUndefined();
    });

    test('re-anchors on what the turn has produced so far', () => {
        // Step 0's view: the request as it arrived, already marked at the call site.
        const initial = withConversationCache(
            toModelMessages([{ id: 'u1', role: 'user', parts: [{ type: 'text', text: 'go' }] }]),
            'anthropic',
        );
        expect(markedIndexes(initial)).toEqual([0]);

        // Step 3's view: three tool calls and their results appended by earlier steps.
        const stepThree: ModelMessage[] = [
            ...initial,
            ...toModelMessages(
                Array.from({ length: 3 }, (_, step) => ({
                    id: `a${step}`,
                    role: 'assistant' as const,
                    parts: [
                        {
                            type: 'tool-call' as const,
                            toolCallId: `c${step}`,
                            toolName: 'read_file',
                            args: { path: `f${step}.ts` },
                            result: 'ok',
                        },
                    ],
                })) satisfies RequestMessage[],
            ),
        ];

        const rolled = rollConversationCache(stepThree, 'anthropic');

        expect(rolled).toBeDefined();
        // One breakpoint, on the newest tool result - the turn's own output is now inside
        // the cached prefix, and the stale marker from step 0 is gone.
        expect(markedIndexes(rolled!.messages)).toEqual([stepThree.length - 1]);
        expect(rolled!.messages[0]?.providerOptions).toBeUndefined();
    });

    test('still spends at most the two breakpoints left after the system prompt', () => {
        const longTurn: ModelMessage[] = Array.from({ length: 40 }, (_, index) => ({
            role: index % 2 === 0 ? ('user' as const) : ('assistant' as const),
            content: `message ${index}`,
        }));

        const rolled = rollConversationCache(longTurn, 'anthropic');

        expect(markedIndexes(rolled!.messages)).toHaveLength(2);
    });
});
