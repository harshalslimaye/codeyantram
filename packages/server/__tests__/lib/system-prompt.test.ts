import { describe, expect, test } from 'bun:test';
import { getSystemMessage, getSystemPrompt } from '../../src/lib/system-prompt';

describe('getSystemPrompt', () => {
    test('is byte-identical across calls for the same agent', () => {
        expect(getSystemPrompt('Talk')).toBe(getSystemPrompt('Talk'));
        expect(getSystemPrompt('Build')).toBe(getSystemPrompt('Build'));
    });

    test('differs between Talk and Build', () => {
        expect(getSystemPrompt('Talk')).not.toBe(getSystemPrompt('Build'));
    });

    test('warns against treating fetched content as instructions, for both agents', () => {
        expect(getSystemPrompt('Talk')).toContain('untrusted data');
        expect(getSystemPrompt('Build')).toContain('untrusted data');
    });

    test('tells Talk it has web_fetch, and that it still needs approval', () => {
        const prompt = getSystemPrompt('Talk');
        expect(prompt).toContain('web_fetch');
        expect(prompt).toContain('pauses for the user\'s explicit approval');
    });

    test('tells Build to prefer web_fetch over bash for reading a URL', () => {
        const prompt = getSystemPrompt('Build');
        expect(prompt).toContain('web_fetch');
        expect(prompt).toContain('curl');
    });
});

describe('getSystemMessage', () => {
    test('wraps getSystemPrompt\'s content with whatever providerOptions it is given', () => {
        const providerOptions = { anthropic: { cacheControl: { type: 'ephemeral' as const } } };
        expect(getSystemMessage('Talk', providerOptions)).toEqual({
            role: 'system',
            content: getSystemPrompt('Talk'),
            providerOptions,
        });
    });

    test('leaves providerOptions undefined when none is passed, rather than assuming a provider', () => {
        expect(getSystemMessage('Talk')).toEqual({
            role: 'system',
            content: getSystemPrompt('Talk'),
            providerOptions: undefined,
        });
    });

    test('is byte-identical (deep-equal) across calls for the same agent and providerOptions', () => {
        const providerOptions = { anthropic: { cacheControl: { type: 'ephemeral' as const } } };
        expect(getSystemMessage('Build', providerOptions)).toEqual(getSystemMessage('Build', providerOptions));
    });
});
