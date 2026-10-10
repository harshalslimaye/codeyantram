import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {readConfig, writeConfig} from '../../src/filesystem/config.js';
import {getUserConfigPath} from '../../src/filesystem/paths.js';
import {readConfiguredProviders, readProviderCredentials, saveProviderApiKey} from '../../src/providers/helpers/index.js';
import type {SupportedProvider} from '../../src/providers/config/index.js';

vi.mock('../../src/filesystem/paths.js', () => ({getUserConfigPath: vi.fn<typeof getUserConfigPath>()}));

let directory: string;

beforeEach(async () => {
	directory = await mkdtemp(path.join(tmpdir(), 'codeyantram-provider-config-test-'));
	vi.mocked(getUserConfigPath).mockReturnValue(path.join(directory, 'config.json'));
});

afterEach(async () => {
	await rm(directory, {recursive: true, force: true});
});

describe('provider configuration', () => {
	it('makes a saved key available to both provider selection and model credentials', async () => {
		await expect(readConfiguredProviders()).resolves.toEqual([]);
		await saveProviderApiKey('openai', '  test-key  ');
		await expect(readConfiguredProviders()).resolves.toEqual(['openai']);
		await expect(readProviderCredentials('gpt-6.1-sol')).resolves.toEqual({openai: 'test-key'});
		await expect(readProviderCredentials('gemini-3.8-flash')).resolves.toEqual({});
	});

	it('updates a key while preserving other settings and provider entries', async () => {
		const config = {
			theme: 'konkan',
			providers: {
				openai: {apiKey: 'old-key', extra: 'keep'},
				google: {apiKey: 'google-key'},
				unknown: {custom: true},
			},
		};
		await writeConfig(config);
		await saveProviderApiKey('openai', '  new-key  ');
		await expect(readConfig()).resolves.toEqual({
			...config,
			providers: {...config.providers, openai: {apiKey: 'new-key', extra: 'keep'}},
		});
		await expect(readConfiguredProviders()).resolves.toEqual(['openai', 'google']);
	});

	it('lists only supported providers with nonblank string keys', async () => {
		await writeConfig({providers: {
			anthropic: {apiKey: '   '},
			openai: {apiKey: 123},
			google: {apiKey: '  google-key  '},
			unknown: {apiKey: 'unknown-key'},
		}});
		await expect(readConfiguredProviders()).resolves.toEqual(['google']);
	});

	it.each([null, [], 'invalid'])('can configure a provider when the saved container is malformed: %j', async providers => {
		await writeConfig({theme: 'konkan', providers});
		await expect(readConfiguredProviders()).resolves.toEqual([]);
		await saveProviderApiKey('openai', 'test-key');
		await expect(readConfig()).resolves.toEqual({theme: 'konkan', providers: {openai: {apiKey: 'test-key'}}});
		await expect(readConfiguredProviders()).resolves.toEqual(['openai']);
	});

	it('rejects blank keys and unsupported providers without changing saved configuration', async () => {
		const config = {theme: 'konkan', providers: {openai: {apiKey: 'keep-key'}}};
		await writeConfig(config);
		await expect(saveProviderApiKey('openai', '   ')).rejects.toThrow('An API key is required.');
		await expect(saveProviderApiKey('unsupported' as SupportedProvider, 'test-key')).rejects.toThrow('Unsupported provider.');
		await expect(readConfig()).resolves.toEqual(config);
	});
});
