import {describe, expect, it, vi} from 'vitest';
import {ChatError, resolveChatModel} from '@codeyantram/core';

describe('resolveChatModel', () => {
  it('does not fall back to environment credentials when caller credentials are missing', () => {
    vi.stubEnv('OPENAI_API_KEY', 'environment-key');
    expect(() => resolveChatModel({modelId: 'gpt-6.1-sol', credentials: {openai: '   '}}))
      .toThrow(new ChatError('missing_credentials', 'No API key is configured for openai.'));
  });

  it('rejects unsupported effort when used independently of request validation', () => {
    expect(() => resolveChatModel({
      modelId: 'gemma-4-31b-it', effort: 'high', credentials: {google: 'test-key'},
    })).toThrow(new ChatError('invalid_request', 'This model does not support the requested effort level.'));
  });

  it.each([
    ['gpt-6.1-sol', {openai: 'test-key'}],
    ['claude-sonnet-5-5', {anthropic: 'test-key'}],
    ['gemini-3.8-flash', {google: 'test-key'}],
    ['claude-haiku-4-5-20251001', {anthropic: 'test-key'}],
    ['gemma-4-31b-it', {google: 'test-key'}],
  ])('preserves provider defaults when effort is omitted for %s', (modelId, credentials) => {
    const resolved = resolveChatModel({modelId, credentials});
    if (modelId.startsWith('claude-')) {
      expect(resolved.providerOptions).toEqual({anthropic: {cacheControl: {type: 'ephemeral'}}});
    } else {
      expect(resolved.providerOptions).toBeUndefined();
    }
    expect(resolved.reasoning).toBeUndefined();
    expect(typeof resolved.model).toBe('object');
  });
});
