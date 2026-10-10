import type * as SharedModule from '@codeyantram/shared';
import {mkdtemp, mkdir, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {getUserThemeDirectory, readConfig, writeConfig} from '@codeyantram/shared';
import {loadThemes, readThemePreference, saveThemePreference} from '../../../src/theme/utils/index.js';
import {BUILTIN_THEMES, konkanTheme} from '../../../src/theme/builtins/index.js';

vi.mock('@codeyantram/shared', async importOriginal => ({
	...await importOriginal<typeof SharedModule>(),
	getUserThemeDirectory: vi.fn<typeof getUserThemeDirectory>(), readConfig: vi.fn<typeof readConfig>(), writeConfig: vi.fn<typeof writeConfig>(),
}));

let directory: string;
beforeEach(async () => {
	directory = await mkdtemp(path.join(tmpdir(), 'codeyantram-theme-test-'));
	vi.mocked(getUserThemeDirectory).mockReturnValue(directory);
});
afterEach(async () => {await rm(directory, {recursive: true, force: true});});

describe('theme loading', () => {
	it('uses builtin themes when the user directory is missing', async () => {
		vi.mocked(getUserThemeDirectory).mockReturnValue(path.join(directory, 'missing'));
		const registry = await loadThemes();
		expect(registry.list()).toHaveLength(BUILTIN_THEMES.length);
		for (const theme of BUILTIN_THEMES) expect(registry.get(theme.id)).toEqual({source: 'builtin', theme});
	});

	it('loads JSON themes, skips malformed files and directories, and applies sorted user overrides', async () => {
		const custom = {...konkanTheme, id: 'custom', name: 'My theme'};
		const first = {...konkanTheme, name: 'First override'};
		const last = {...konkanTheme, name: 'Last override'};
		await Promise.all([
			writeFile(path.join(directory, 'custom.JSON'), JSON.stringify(custom)),
			writeFile(path.join(directory, 'a.json'), JSON.stringify(first)),
			writeFile(path.join(directory, 'z.json'), JSON.stringify(last)),
			writeFile(path.join(directory, 'broken.json'), '{'),
			writeFile(path.join(directory, 'invalid.json'), JSON.stringify({id: 'invalid'})),
			writeFile(path.join(directory, 'ignored.txt'), JSON.stringify({...custom, id: 'ignored'})),
			mkdir(path.join(directory, 'directory.json')),
		]);
		const registry = await loadThemes();
		expect(registry.list()).toHaveLength(BUILTIN_THEMES.length + 1);
		expect(registry.get('custom')).toEqual({source: 'user', theme: custom, filePath: path.join(directory, 'custom.JSON')});
		expect(registry.get('konkan')).toEqual({source: 'user', theme: last, filePath: path.join(directory, 'z.json')});
		expect(registry.get('ignored')).toBeUndefined();
		expect(registry.get('invalid')).toBeUndefined();
	});
});

describe('theme preferences', () => {
	it.each([{}, {theme: null}, {theme: 42}, {theme: ''}, {theme: '   '}])('ignores an absent or malformed preference: %j', async config => {
		vi.mocked(readConfig).mockResolvedValueOnce(config);
		await expect(readThemePreference()).resolves.toBeUndefined();
	});
	it('trims a saved theme identifier', async () => {
		vi.mocked(readConfig).mockResolvedValueOnce({theme: '  konkan  '});
		await expect(readThemePreference()).resolves.toBe('konkan');
	});
	it('falls back when configuration cannot be read', async () => {
		vi.mocked(readConfig).mockRejectedValueOnce(new Error('bad JSON'));
		await expect(readThemePreference()).resolves.toBeUndefined();
	});
	it('saves the preference without replacing unrelated configuration', async () => {
		const config = {providers: {openai: {apiKey: 'keep'}}, model: 'keep', theme: 'old'};
		vi.mocked(readConfig).mockResolvedValueOnce(config);
		vi.mocked(writeConfig).mockResolvedValueOnce(undefined);
		await expect(saveThemePreference('konkan')).resolves.toBe('konkan');
		expect(writeConfig).toHaveBeenCalledExactlyOnceWith({...config, theme: 'konkan'});
	});
	it('propagates read and write failures so the picker can report them', async () => {
		vi.mocked(readConfig).mockRejectedValueOnce(new Error('read failed'));
		await expect(saveThemePreference('konkan')).rejects.toThrow('read failed');
		expect(writeConfig).not.toHaveBeenCalled();
		vi.mocked(readConfig).mockResolvedValueOnce({});
		vi.mocked(writeConfig).mockRejectedValueOnce(new Error('write failed'));
		await expect(saveThemePreference('konkan')).rejects.toThrow('write failed');
	});
});
