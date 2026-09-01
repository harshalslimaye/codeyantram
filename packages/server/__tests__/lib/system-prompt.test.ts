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
