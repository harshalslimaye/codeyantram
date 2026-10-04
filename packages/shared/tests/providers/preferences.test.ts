import {describe, expect, it, vi} from 'vitest';
import {DEFAULT_CHAT_MODEL_ID, readModelPreferences, resolveModelPreferences, saveModelPreference} from '../../src/providers/index.js';
import {readConfig, writeConfig} from '../../src/filesystem/config.js';

vi.mock('../../src/filesystem/config.js', () => ({
	readConfig: vi.fn(),
	writeConfig: vi.fn(),
}));

describe('model preferences', () => {
	it('saves a model without effort while retaining other saved efforts', async () => {
		const config = {theme: 'konkan', effortByModel: {'gpt-6.1-sol': 'high'}};
		vi.mocked(readConfig).mockResolvedValueOnce(config);
		vi.mocked(writeConfig).mockResolvedValueOnce(undefined);
		await expect(saveModelPreference('gemma-4-31b-it')).resolves.toEqual({modelId: 'gemma-4-31b-it', effortByModel: config.effortByModel});
		expect(writeConfig).toHaveBeenCalledExactlyOnceWith({...config, model: 'gemma-4-31b-it'});
	});
	it.each([{}, {model: 'missing'}, {model: 42}])('defaults an absent or invalid model: %j', config => {
		expect(resolveModelPreferences(config)).toEqual({modelId: DEFAULT_CHAT_MODEL_ID, effortByModel: {}});
	});

	it('keeps supported efforts and discards invalid saved entries', () => {
		expect(resolveModelPreferences({
			model: 'gpt-6.1-sol',
			effortByModel: {
				'gpt-6.1-sol': 'high',
				'claude-sonnet-5-5': 'none',
				'claude-haiku-4-5-20251001': 'high',
				'gemini-3.8-flash': 'invalid',
				missing: 'high',
			},
		})).toEqual({modelId: 'gpt-6.1-sol', effortByModel: {'gpt-6.1-sol': 'high'}});
	});

	it.each([null, [], 'high'])('ignores malformed effort preferences: %j', effortByModel => {
		expect(resolveModelPreferences({effortByModel}).effortByModel).toEqual({});
	});

	it('returns defaults if reading config fails', async () => {
		vi.mocked(readConfig).mockRejectedValueOnce(new Error('Invalid JSON'));
		await expect(readModelPreferences()).resolves.toEqual({modelId: DEFAULT_CHAT_MODEL_ID, effortByModel: {}});
	});

	it('saves a selection while preserving unrelated configuration and existing efforts', async () => {
		const config = {theme: 'konkan', effortByModel: {'claude-sonnet-5-5': 'medium'}};
		vi.mocked(readConfig).mockResolvedValueOnce(config);
		vi.mocked(writeConfig).mockResolvedValueOnce(undefined);
		const effortByModel = {...config.effortByModel, 'gpt-6.1-sol': 'high'};
		await expect(saveModelPreference('gpt-6.1-sol', 'high')).resolves.toEqual({modelId: 'gpt-6.1-sol', effortByModel});
		expect(writeConfig).toHaveBeenCalledExactlyOnceWith({...config, model: 'gpt-6.1-sol', effortByModel});
	});

	it('rejects an unknown model before accessing configuration', async () => {
		await expect(saveModelPreference('missing')).rejects.toThrow('is not available');
		expect(readConfig).not.toHaveBeenCalled();
		expect(writeConfig).not.toHaveBeenCalled();
	});

	it('rejects an unsupported effort before accessing configuration', async () => {
		await expect(saveModelPreference('claude-haiku-4-5-20251001', 'high')).rejects.toThrow('does not support effort');
		expect(readConfig).not.toHaveBeenCalled();
		expect(writeConfig).not.toHaveBeenCalled();
	});
});
