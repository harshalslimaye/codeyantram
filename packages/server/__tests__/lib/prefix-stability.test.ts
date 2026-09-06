import { describe, expect, test } from 'bun:test';
import { z } from 'zod';
import type { ModelMessage } from 'ai';
import { TOOL_CATALOG, isTalkTool, type AgentName, type RequestMessage } from '@codeyantram/shared';
import { toModelMessages } from '../../src/lib/chat-stream';
import { withConversationCache } from '../../src/lib/prompt-cache';
import { getSystemMessages } from '../../src/lib/system-prompt';
import { buildProjectTools } from '../../src/tools';
import type { PromptInstructions } from '../../src/lib/project-instructions';

// Every provider's caching is a prefix match: one byte different anywhere ahead of a
// breakpoint and everything after it is re-billed. Anthropic reads its markers, the other
// three match prefixes on their own, but all four depend on the same thing - that the
// bytes we send this turn reappear unchanged next turn.
//
// The failure this guards against is silent. Nothing errors, no test goes red, the
// requests keep succeeding; only the bill changes, and usually months after the change
// that caused it. So these tests pin the *rendered request*, not the helpers that build
// it: a tool description that starts interpolating the project path, a history-trimming
// feature, a tool set built from an unordered collection.

const INSTRUCTIONS: PromptInstructions = {
    global: null,
    project: { filename: 'AGENTS.md', text: 'Prefer bun over npm.', bytes: 20, truncated: false },
};

/** The message with every cache breakpoint of ours removed. The marker moves by design as
 * the conversation grows (see withConversationCache), so it is the one difference between
 * two adjacent requests that must be ignored when diffing them - a previously marked block
 * is still a cache hit. */
function withoutMarkers(message: ModelMessage): unknown {
    const { providerOptions: _dropped, ...rest } = message;
    return rest;
}

/**
 * Everything a request puts in front of the model, in render order (tools, then system,
 * then messages), as one array of comparable blocks. Anthropic renders tools at position
 * 0, so a change there invalidates every cache tier on every provider.
 */
function renderedPrefix(agent: AgentName, cwd: string, messages: RequestMessage[]): string[] {
    const tools = buildProjectTools(cwd, agent === 'Talk', true);

    return [
        ...Object.entries(tools).map(([name, definition]) =>
            JSON.stringify({
                name,
                description: definition.description,
                // The schema as the provider sees it, not the Zod object - a reordered key
                // is a different prefix even when the type is identical.
                schema: z.toJSONSchema(definition.inputSchema as z.ZodType),
            }),
        ),
        ...getSystemMessages(agent, INSTRUCTIONS, true).map(message => JSON.stringify(withoutMarkers(message))),
        ...withConversationCache(toModelMessages(messages), 'anthropic').map(message =>
            JSON.stringify(withoutMarkers(message)),
        ),
    ];
}

// Long enough to have teeth: a history-rewriting regression (trimming, summarising,
// stubbing out an old tool result) only changes bytes if there are bytes to lose, so a
// fixture of short messages would let one through unnoticed.
const body = (text: string): string => `${text} ${'Some further detail the user typed out at length.'.repeat(6)}`;

const ask = (id: string, text: string): RequestMessage => ({
    id,
    role: 'user',
    parts: [{ type: 'text', text: body(text) }],
});
const reply = (id: string, text: string): RequestMessage => ({
    id,
    role: 'assistant',
    parts: [{ type: 'text', text: body(text) }],
});

describe('prefix stability', () => {
    test('a turn\'s rendered prefix reappears byte-identical in the next turn', () => {
        const turnOne = [ask('u1', 'what does this project do?')];
        const turnTwo = [...turnOne, reply('a1', 'it is a terminal assistant'), ask('u2', 'and the server?')];

        const before = renderedPrefix('Build', '/projects/demo', turnOne);
        const after = renderedPrefix('Build', '/projects/demo', turnTwo);

        // Not just "contains" - the earlier request must be a literal prefix of the later
        // one, block for block, which is what the provider's cache key requires.
        expect(after.slice(0, before.length)).toEqual(before);
        expect(after.length).toBeGreaterThan(before.length);
    });

    test('a turn that ran tools still leaves the earlier prefix untouched', () => {
        const turnOne = [ask('u1', 'read the readme')];
        const turnTwo: RequestMessage[] = [
            ...turnOne,
            {
                id: 'a1',
                role: 'assistant',
                parts: [
                    {
                        type: 'tool-call',
                        toolCallId: 'c1',
                        toolName: 'read_file',
                        args: { path: 'README.md' },
                        result: '1\t# Demo',
                    },
                ],
            },
            ask('u2', 'now summarise it'),
        ];

        const before = renderedPrefix('Build', '/projects/demo', turnOne);
        const after = renderedPrefix('Build', '/projects/demo', turnTwo);

        expect(after.slice(0, before.length)).toEqual(before);
    });

    test('rebuilding the same request twice renders the same bytes', () => {
        const messages = [ask('u1', 'hello')];

        expect(renderedPrefix('Build', '/projects/demo', messages)).toEqual(
            renderedPrefix('Build', '/projects/demo', messages),
        );
    });

    test('the tool set renders in catalog order, the same order every build', () => {
        const build = Object.keys(buildProjectTools('/projects/demo'));
        const talk = Object.keys(buildProjectTools('/projects/demo', true));

        expect(build).toEqual(TOOL_CATALOG.map(tool => tool.name));
        expect(talk).toEqual(TOOL_CATALOG.filter(tool => isTalkTool(tool.name)).map(tool => tool.name));
        expect(Object.keys(buildProjectTools('/projects/demo'))).toEqual(build);
    });

    test('the project root binds executors only - it never reaches the rendered prefix', () => {
        // A cwd interpolated into a description or schema would give every project its own
        // cache namespace, and nothing would announce it.
        const here = renderedPrefix('Build', '/projects/demo', [ask('u1', 'hello')]);
        const elsewhere = renderedPrefix('Build', '/somewhere/else', [ask('u1', 'hello')]);

        expect(elsewhere).toEqual(here);
    });
});
