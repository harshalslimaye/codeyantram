import { describe, expect, test } from 'bun:test';
import type { UserMessage } from '@codeyantram/shared';
import { deriveTitle, deriveTitleFromMessage } from '../src/title';

describe('deriveTitle', () => {
    test('returns short text unchanged', () => {
        expect(deriveTitle('fix the socket handshake')).toBe('fix the socket handshake');
    });

    test('collapses whitespace, including newlines from a multi-line prompt', () => {
        expect(deriveTitle('  fix   the\n\nsocket   handshake  ')).toBe('fix the socket handshake');
    });

    test('drops a leading slash-command token', () => {
        expect(deriveTitle('/init generate docs for this repo')).toBe('generate docs for this repo');
    });

    test('keeps the text as-is when the slash-command has nothing after it', () => {
        expect(deriveTitle('/init')).toBe('/init');
    });

    test('falls back to a fixed title for empty input', () => {
        expect(deriveTitle('')).toBe('Untitled session');
    });

    test('falls back to a fixed title for whitespace-only input', () => {
        expect(deriveTitle('   \n\t  ')).toBe('Untitled session');
    });

    test('caps at 60 characters on a word boundary, marking the cut with an ellipsis', () => {
        const text = 'one two three four five six seven eight nine ten eleven twelve thirteen';
        expect(text.length).toBeGreaterThan(60);
        expect(deriveTitle(text)).toBe('one two three four five six seven eight nine ten eleven…');
    });

    test('hard-cuts at the length cap when there is no word boundary to use', () => {
        const text = 'a'.repeat(65);
        expect(deriveTitle(text)).toBe(`${'a'.repeat(60)}…`);
    });
});

describe('deriveTitleFromMessage', () => {
    function userMessage(...texts: string[]): UserMessage {
        return {
            id: 'msg-1',
            role: 'user',
            parts: texts.map(text => ({ type: 'text' as const, text })),
        };
    }

    test('derives from a single text part', () => {
        expect(deriveTitleFromMessage(userMessage('fix the socket handshake'))).toBe('fix the socket handshake');
    });

    test('joins multiple text parts before deriving', () => {
        expect(deriveTitleFromMessage(userMessage('fix the', 'socket handshake'))).toBe('fix the socket handshake');
    });
});
