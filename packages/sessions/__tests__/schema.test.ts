import { describe, expect, test } from 'bun:test';
import type { AssistantMessage, UserMessage } from '@codeyantram/shared';
import {
    chatMessageToRowFields,
    messageRowSchema,
    parseMessageRow,
    parseSessionRow,
    rowToChatMessage,
    sessionRowSchema,
    type MessageRow,
} from '../src/schema';

const VALID_SESSION_ROW = {
    id: 's1',
    project: '/repo',
    title: 'hello',
    created_at: 1,
    updated_at: 2,
    model_id: 'claude-sonnet-5',
    agent_name: 'Build',
    effort: 'high',
};

describe('parseSessionRow', () => {
    test('accepts a well-formed row', () => {
        expect(parseSessionRow(VALID_SESSION_ROW)).toEqual(sessionRowSchema.parse(VALID_SESSION_ROW));
    });

    test('accepts a null effort', () => {
        const row = { ...VALID_SESSION_ROW, effort: null };
        expect(parseSessionRow(row).effort).toBeNull();
    });

    test('silently drops unknown extra columns (e.g. a joined message_count)', () => {
        const row = { ...VALID_SESSION_ROW, message_count: 4 };
        expect(parseSessionRow(row)).not.toHaveProperty('message_count');
    });

    test('does not validate model_id/agent_name/effort against any catalog - a row for a since-removed model must still parse', () => {
        const row = { ...VALID_SESSION_ROW, model_id: 'some-retired-model', agent_name: 'SomeRetiredAgent' };
        expect(() => parseSessionRow(row)).not.toThrow();
    });

    test('throws, naming the row id, for a row missing a required column', () => {
        const { title, ...withoutTitle } = VALID_SESSION_ROW;
        expect(() => parseSessionRow(withoutTitle)).toThrow(/id: s1/);
    });

    test('throws for a row of the wrong shape entirely', () => {
        expect(() => parseSessionRow(null)).toThrow();
        expect(() => parseSessionRow('not a row')).toThrow();
    });
});

const VALID_MESSAGE_ROW: MessageRow = {
    session_id: 's1',
    seq: 0,
    message_id: 'm1',
    role: 'user',
    parts: '[]',
    usage: null,
    instructions: null,
};

describe('parseMessageRow', () => {
    test('accepts a well-formed row', () => {
        expect(parseMessageRow(VALID_MESSAGE_ROW)).toEqual(VALID_MESSAGE_ROW);
    });

    test('throws, naming session and seq, for an invalid role', () => {
        const row = { ...VALID_MESSAGE_ROW, role: 'system' };
        expect(() => parseMessageRow(row)).toThrow(/session: s1, seq: 0/);
    });
});

describe('rowToChatMessage', () => {
    test('reconstructs a user message', () => {
        const row: MessageRow = {
            session_id: 's1',
            seq: 0,
            message_id: 'm1',
            role: 'user',
            parts: JSON.stringify([{ type: 'text', text: 'hello' }]),
            usage: null,
            instructions: null,
        };
        expect(rowToChatMessage(row)).toEqual({
            id: 'm1',
            role: 'user',
            parts: [{ type: 'text', text: 'hello' }],
        });
    });

    test('reconstructs an assistant message with usage and instructions', () => {
        const row: MessageRow = {
            session_id: 's1',
            seq: 1,
            message_id: 'm2',
            role: 'assistant',
            parts: JSON.stringify([{ type: 'text', text: 'hi there' }]),
            usage: JSON.stringify({ inputTokens: 10, outputTokens: 5 }),
            instructions: JSON.stringify({ filename: 'AGENTS.md', bytes: 100, truncated: false }),
        };
        expect(rowToChatMessage(row)).toEqual({
            id: 'm2',
            role: 'assistant',
            parts: [{ type: 'text', text: 'hi there' }],
            usage: { inputTokens: 10, outputTokens: 5 },
            projectInstructions: { filename: 'AGENTS.md', bytes: 100, truncated: false },
        });
    });

    test('reconstructs an assistant message with neither usage nor instructions (a turn still short of "done")', () => {
        const row: MessageRow = {
            session_id: 's1',
            seq: 1,
            message_id: 'm2',
            role: 'assistant',
            parts: JSON.stringify([{ type: 'text', text: 'hi' }]),
            usage: null,
            instructions: null,
        };
        const message = rowToChatMessage(row) as AssistantMessage;
        expect(message.usage).toBeUndefined();
        expect(message.projectInstructions).toBeUndefined();
    });

    test('throws for malformed parts JSON', () => {
        const row: MessageRow = { ...VALID_MESSAGE_ROW, parts: '{not json' };
        expect(() => rowToChatMessage(row)).toThrow(/Malformed parts JSON/);
    });

    test('throws when a "user" row does not actually satisfy userMessageSchema (empty parts array)', () => {
        const row: MessageRow = { ...VALID_MESSAGE_ROW, parts: '[]' };
        expect(() => rowToChatMessage(row)).toThrow(/does not satisfy ChatMessage/);
    });
});

describe('chatMessageToRowFields', () => {
    test('a user message never carries usage or instructions', () => {
        const message: UserMessage = { id: 'm1', role: 'user', parts: [{ type: 'text', text: 'hi' }] };
        const fields = chatMessageToRowFields(message);
        expect(fields.role).toBe('user');
        expect(fields.usage).toBeNull();
        expect(fields.instructions).toBeNull();
        expect(JSON.parse(fields.parts)).toEqual(message.parts);
    });

    test('an assistant message with usage serializes it', () => {
        const message: AssistantMessage = {
            id: 'm2',
            role: 'assistant',
            parts: [{ type: 'text', text: 'hi' }],
            usage: { inputTokens: 3 },
        };
        const fields = chatMessageToRowFields(message);
        expect(JSON.parse(fields.usage!)).toEqual({ inputTokens: 3 });
        expect(fields.instructions).toBeNull();
    });

    test('round-trips through a row and back to an equivalent message', () => {
        const original: AssistantMessage = {
            id: 'm3',
            role: 'assistant',
            parts: [{ type: 'reasoning', text: 'thinking...' }, { type: 'text', text: 'done' }],
            usage: { inputTokens: 20, outputTokens: 8, cacheReadTokens: 4 },
        };
        const fields = chatMessageToRowFields(original);
        const row: MessageRow = {
            session_id: 's1',
            seq: 2,
            message_id: original.id,
            ...fields,
        };
        expect(rowToChatMessage(row)).toEqual(original);
    });
});
