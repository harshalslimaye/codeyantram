import {describe, expect, it, vi} from 'vitest';
import {readProviderCredentials} from '../../src/providers/config.js';

describe('readProviderCredentials', () => {
  it.each([
    ['gpt-6.1-sol', 'openai'],
    ['claude-sonnet-5-5', 'anthropic'],
    ['gemini-3.8-flash', 'google'],
  ])('loads and trims only the provider key for %s', async (modelId, provider) => {
    expect(await readProviderCredentials(modelId, async () => ({providers: {
      openai: {apiKey: '  test-openai-key  ', extra: 'ignored'},
      anthropic: {apiKey: 'test-anthropic-key'},
      google: {apiKey: 'test-google-key'},
      unknown: {apiKey: 'ignored'},
    }}))).toEqual({[provider]: `test-${provider}-key`});
  });

  it('does not access other provider entries', async () => {
    const providers = {
      openai: {apiKey: 'test-openai-key'},
      get anthropic() {throw new Error('Unselected provider accessed');},
      get google() {throw new Error('Unselected provider accessed');},
    };
    expect(await readProviderCredentials('gpt-6.1-sol', async () => ({providers})))
      .toEqual({openai: 'test-openai-key'});
  });

  it('does not read configuration for an unsupported model', async () => {
    const readConfig = vi.fn(async () => ({}));
    expect(await readProviderCredentials('unsupported', readConfig)).toEqual({});
    expect(readConfig).not.toHaveBeenCalled();
  });

  it.each([
    {}, {providers: null}, {providers: []},
    {providers: {openai: {apiKey: '   '}}},
    {providers: {openai: {apiKey: 123}}},
    {providers: {openai: 'invalid'}},
    {providers: {anthropic: {apiKey: 'another-provider-key'}}},
  ])('ignores absent or malformed selected-provider entries', async config => {
    vi.stubEnv('OPENAI_API_KEY', 'environment-key');
    expect(await readProviderCredentials('gpt-6.1-sol', async () => config)).toEqual({});
  });

  it('propagates configuration read failures for the HTTP layer to handle', async () => {
    await expect(readProviderCredentials('gpt-6.1-sol', async () => {throw new Error('Failed to read config');}))
      .rejects.toThrow('Failed to read config');
  });
});
