import {randomUUID} from 'node:crypto';
import {mkdir, readFile, rename, unlink, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {getUserConfigPath} from './paths.js';

const JSON_INDENT_SPACES = 2;

export async function readConfig(): Promise<Record<string, unknown>> {
	const filePath = getUserConfigPath();
	let contents: string;
	try {
		contents = await readFile(filePath, 'utf8'); // oxlint-disable-line security/detect-non-literal-fs-filename -- The path is the application user-config location or an exclusive temporary file in that directory.
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {};
		throw error;
	}

	const value: unknown = JSON.parse(contents);
	if (typeof value !== 'object' || value === null || Array.isArray(value)) {
		throw new Error(`Config at ${filePath} must contain a JSON object.`);
	}
	return value as Record<string, unknown>;
}

export async function writeConfig(value: Record<string, unknown>): Promise<void> {
	const filePath = getUserConfigPath();
	const directory = path.dirname(filePath);
	await mkdir(directory, {recursive: true}); // oxlint-disable-line security/detect-non-literal-fs-filename -- The path is the application user-config location or an exclusive temporary file in that directory.
	const temporaryPath = path.join(directory, `.config-${randomUUID()}.tmp`);
	try {
		await writeFile(temporaryPath, `${JSON.stringify(value, null, JSON_INDENT_SPACES)}\n`, {flag: 'wx', mode: 0o600}); // oxlint-disable-line security/detect-non-literal-fs-filename -- The path is the application user-config location or an exclusive temporary file in that directory.
		await rename(temporaryPath, filePath); // oxlint-disable-line security/detect-non-literal-fs-filename -- The path is the application user-config location or an exclusive temporary file in that directory.
	} catch (error) {
		try {
			await unlink(temporaryPath); // oxlint-disable-line security/detect-non-literal-fs-filename -- The path is the application user-config location or an exclusive temporary file in that directory.
		} catch {
			// The temporary file may not have been created or may already be renamed.
		}
		throw error;
	}
}
