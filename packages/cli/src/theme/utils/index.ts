import {readdir, readFile} from 'node:fs/promises';
import path from 'node:path';
import {getUserThemeDirectory, readConfig, writeConfig} from '@codeyantram/shared';
import {BUILTIN_THEMES} from '../builtins/index.js';
import {validateTheme} from '../registry/schema.js';
import {createThemeRegistry, type RegisteredTheme, type ThemeRegistry} from '../registry/registry.js';

async function loadThemeDirectory(
	directory: string,
	source: 'user'
): Promise<RegisteredTheme[]> {
	let files;
	try {
		files = await readdir(directory, {withFileTypes: true}); // oxlint-disable-line security/detect-non-literal-fs-filename -- Paths come from the user-theme directory and JSON files enumerated inside it.
	} catch {
		return [];
	}

	const entries: RegisteredTheme[] = [];
	const themeFiles = files
		.filter(file => file.isFile() && file.name.toLowerCase().endsWith('.json'))
		.sort((left, right) => left.name.localeCompare(right.name));

	for (const file of themeFiles) {
		const filePath = path.join(directory, file.name);
		let parsed: unknown;
		try {
			parsed = JSON.parse(await readFile(filePath, 'utf8')); // oxlint-disable-line security/detect-non-literal-fs-filename -- Paths come from the user-theme directory and JSON files enumerated inside it.
		} catch {
			continue;
		}

		const validation = validateTheme(parsed);
		if (!validation.success || !validation.data) {
			continue;
		}

		entries.push({theme: validation.data, source, filePath});
	}

	return entries;
}

function builtinEntries(): RegisteredTheme[] {
	return BUILTIN_THEMES.map(theme => ({theme, source: 'builtin'}));
}

export async function loadThemes(): Promise<ThemeRegistry> {
	const userThemes = await loadThemeDirectory(getUserThemeDirectory(), 'user');

	return createThemeRegistry([
		{source: 'builtin', themes: builtinEntries()},
		{source: 'user', themes: userThemes},
	]);
}

export async function readThemePreference(): Promise<string | undefined> {
	let config: Record<string, unknown>;
	try {
		config = await readConfig();
	} catch {
		return undefined;
	}

	const theme = config.theme;

	if (theme === undefined) return undefined;
	if (typeof theme !== 'string') return undefined;
	if (theme.trim().length === 0) return undefined;

	return theme.trim();
}

export async function saveThemePreference(id: string): Promise<string> {
	const config = await readConfig();
	await writeConfig({...config, theme: id});

	return id;
}
