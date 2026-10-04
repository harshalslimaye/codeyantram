import {homedir} from 'node:os';
import path from 'node:path';

export function getUserConfigDirectory(): string {
	if (process.platform === 'win32') {
		const roamingDirectory = process.env.APPDATA ?? path.join(homedir(), 'AppData', 'Roaming');
		return path.join(roamingDirectory, 'codeyantram');
	}

	return path.join(homedir(), '.config', 'codeyantram');
}

export function getUserThemeDirectory(): string {
	return path.join(getUserConfigDirectory(), 'themes');
}

export function getUserGraphDirectory(): string {
	return path.join(getUserConfigDirectory(), 'graphs');
}

export function getUserConfigPath(): string {
	return path.join(getUserConfigDirectory(), 'config.json');
}
