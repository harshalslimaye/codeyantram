import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {readConfig, writeConfig} from '../../src/filesystem/config.js';
import {getUserConfigPath} from '../../src/filesystem/paths.js';
import {JevNotConfiguredError, readJevConfiguration, resolveJevConfiguration, toggleJevUsage} from '../../src/integrations/jev.js';
import {readConfiguredProviders, readProviderCredentials, saveProviderApiKey} from '../../src/providers/helpers/index.js';
import {SUPPORTED_CHAT_MODELS} from '../../src/providers/config/index.js';

vi.mock('../../src/filesystem/paths.js', () => ({getUserConfigPath: vi.fn()}));

let directory: string;
beforeEach(async () => {
	directory = await mkdtemp(path.join(tmpdir(), 'codeyantram-jev-config-test-'));
	vi.mocked(getUserConfigPath).mockReturnValue(path.join(directory, 'config.json'));
});
afterEach(async () => { await rm(directory, {recursive: true, force: true}); });

describe('JEV configuration', () => {
	it('saves an evaluation key without enabling usage or adding a coding model', async () => {
		await expect(readJevConfiguration()).resolves.toEqual({enabled: false, configured: false});
		await saveProviderApiKey('typesafe', '  test-jev-key  ');
		await expect(readConfig()).resolves.toEqual({providers: {typesafe: {apiKey: 'test-jev-key'}}});
		await expect(readJevConfiguration()).resolves.toEqual({enabled: false, configured: true});
		await expect(readConfiguredProviders()).resolves.toEqual([]);
		await expect(readProviderCredentials('jev-latest')).resolves.toEqual({});
		expect(SUPPORTED_CHAT_MODELS.some(model => /jev|typesafe/i.test(`${model.id} ${model.provider}`))).toBe(false);
	});

	it('persists both toggle directions while retaining the key and unrelated settings', async () => {
		const config = {
			model: 'gpt-6.1-sol', theme: 'konkan',
			providers: {typesafe: {apiKey: 'test-jev-key'}, openai: {apiKey: 'test-openai-key'}},
			integrations: {other: {enabled: true}, jev: {custom: 'keep'}},
		};
		await writeConfig(config);
		await expect(toggleJevUsage()).resolves.toEqual({enabled: true, configured: true});
		await expect(readConfig()).resolves.toEqual({
			...config, integrations: {...config.integrations, jev: {custom: 'keep', enabled: true}},
		});
		await expect(readJevConfiguration()).resolves.toEqual({enabled: true, configured: true});
		await expect(toggleJevUsage()).resolves.toEqual({enabled: false, configured: true});
		await expect(readConfig()).resolves.toEqual({
			...config, integrations: {...config.integrations, jev: {custom: 'keep', enabled: false}},
		});
	});

	it.each([undefined, '   ', 123])('rejects enablement without a nonblank key: %j', async apiKey => {
		const config = {theme: 'konkan', providers: {typesafe: {apiKey}}};
		await writeConfig(config);
		const original = await readConfig();
		await expect(toggleJevUsage()).rejects.toBeInstanceOf(JevNotConfiguredError);
		await expect(readConfig()).resolves.toEqual(original);
	});

	it('allows disabling an enabled integration after its key has been removed', async () => {
		await writeConfig({integrations: {jev: {enabled: true}}});
		await expect(toggleJevUsage()).resolves.toEqual({enabled: false, configured: false});
		await expect(readConfig()).resolves.toEqual({integrations: {jev: {enabled: false}}});
	});

	it.each([{}, {integrations: null}, {integrations: []}, {integrations: {jev: 'invalid'}}, {integrations: {jev: {enabled: 'true'}}}])
	('defaults malformed or absent preferences to disabled: %j', config => {
		expect(resolveJevConfiguration(config)).toEqual({enabled: false, configured: false});
	});

	it('replaces malformed integration containers when enabling', async () => {
		await writeConfig({providers: {typesafe: {apiKey: 'test-key'}}, integrations: []});
		await toggleJevUsage();
		await expect(readJevConfiguration()).resolves.toEqual({enabled: true, configured: true});
	});

	it('propagates read and write failures without reporting success', async () => {
		vi.mocked(getUserConfigPath).mockReturnValue(directory);
		await expect(readJevConfiguration()).rejects.toThrow();
		await expect(toggleJevUsage()).rejects.toThrow();
		vi.mocked(getUserConfigPath).mockReturnValue(path.join(directory, 'config.json'));
		await writeConfig({providers: {typesafe: {apiKey: 'test-key'}}});
		vi.mocked(getUserConfigPath).mockReturnValueOnce(path.join(directory, 'config.json')).mockReturnValueOnce(directory);
		await expect(toggleJevUsage()).rejects.toThrow();
		vi.mocked(getUserConfigPath).mockReturnValue(path.join(directory, 'config.json'));
		await expect(readJevConfiguration()).resolves.toEqual({enabled: false, configured: true});
	});
});
