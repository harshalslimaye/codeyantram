import {homedir} from 'node:os';
import path from 'node:path';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {getUserConfigDirectory, getUserConfigPath, getUserGraphDirectory, getUserThemeDirectory} from '../../src/filesystem/paths.js';

vi.mock('node:os', async importOriginal => ({
	...await importOriginal<typeof import('node:os')>(),
	homedir: vi.fn(),
}));

const platformDescriptor = Object.getOwnPropertyDescriptor(process, 'platform')!;
const homeDirectory = path.resolve('test-home');

beforeEach(() => {
	vi.mocked(homedir).mockReturnValue(homeDirectory);
	vi.stubEnv('APPDATA', undefined);
});

afterEach(() => {
	Object.defineProperty(process, 'platform', platformDescriptor);
});

function setPlatform(platform: NodeJS.Platform): void {
	Object.defineProperty(process, 'platform', {...platformDescriptor, value: platform});
}

describe.each(['darwin', 'linux'] as const)('filesystem paths on %s', platform => {
	beforeEach(() => {
		setPlatform(platform);
	});

	it('uses the home configuration directory and ignores APPDATA', () => {
		vi.stubEnv('APPDATA', path.resolve('other-config'));
		expect(getUserConfigDirectory()).toBe(path.join(homeDirectory, '.config', 'codeyantram'));
	});

	it('locates the theme folder under the configuration directory', () => {
		expect(getUserThemeDirectory()).toBe(path.join(homeDirectory, '.config', 'codeyantram', 'themes'));
	});

	it('locates config.json under the configuration directory', () => {
		expect(getUserConfigPath()).toBe(path.join(homeDirectory, '.config', 'codeyantram', 'config.json'));
	});

	it('locates graph storage under the configuration directory', () => {
		expect(getUserGraphDirectory()).toBe(path.join(homeDirectory, '.config', 'codeyantram', 'graphs'));
	});
});

describe('filesystem paths on Windows', () => {
	beforeEach(() => {
		setPlatform('win32');
	});

	it('uses APPDATA for all configuration paths when available', () => {
		const roamingDirectory = path.resolve('custom-roaming');
		vi.stubEnv('APPDATA', roamingDirectory);
		const configDirectory = path.join(roamingDirectory, 'codeyantram');
		expect(getUserConfigDirectory()).toBe(configDirectory);
		expect(getUserThemeDirectory()).toBe(path.join(configDirectory, 'themes'));
		expect(getUserGraphDirectory()).toBe(path.join(configDirectory, 'graphs'));
		expect(getUserConfigPath()).toBe(path.join(configDirectory, 'config.json'));
		expect(homedir).not.toHaveBeenCalled();
	});

	it('falls back to AppData/Roaming under the home directory when APPDATA is absent', () => {
		const configDirectory = path.join(homeDirectory, 'AppData', 'Roaming', 'codeyantram');
		expect(getUserConfigDirectory()).toBe(configDirectory);
		expect(getUserThemeDirectory()).toBe(path.join(configDirectory, 'themes'));
		expect(getUserGraphDirectory()).toBe(path.join(configDirectory, 'graphs'));
		expect(getUserConfigPath()).toBe(path.join(configDirectory, 'config.json'));
	});
});
