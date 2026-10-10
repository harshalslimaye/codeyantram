import {mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {getUserConfigPath} from '../../src/filesystem/paths.js';
import {readConfig, writeConfig} from '../../src/filesystem/config.js';

vi.mock('../../src/filesystem/paths.js', () => ({getUserConfigPath: vi.fn<typeof getUserConfigPath>()}));

let directory: string;
let configPath: string;

beforeEach(async () => {
	directory = await mkdtemp(path.join(tmpdir(), 'codeyantram-config-test-'));
	configPath = path.join(directory, 'nested', 'config.json');
	vi.mocked(getUserConfigPath).mockReturnValue(configPath);
});

afterEach(async () => {
	await rm(directory, {recursive: true, force: true});
});

describe('config persistence', () => {
	it('returns an empty object for a missing config', async () => {
		await expect(readConfig()).resolves.toEqual({});
	});

	it('creates parent directories and round-trips configuration', async () => {
		const config = {theme: 'konkan', providers: {openai: {apiKey: 'test-key'}}};
		await writeConfig(config);
		await expect(readConfig()).resolves.toEqual(config);
		expect(await readFile(configPath, 'utf8')).toBe(`${JSON.stringify(config, null, 2)}\n`);
		expect(await readdir(path.dirname(configPath))).toEqual(['config.json']);
	});

	it('replaces an existing config without leaving temporary files', async () => {
		await writeConfig({theme: 'konkan'});
		await writeConfig({theme: 'kaapi'});
		await expect(readConfig()).resolves.toEqual({theme: 'kaapi'});
		expect(await readdir(path.dirname(configPath))).toEqual(['config.json']);
	});

	it.skipIf(process.platform === 'win32')('restricts file permissions to the owner', async () => {
		await writeConfig({});
		expect((await stat(configPath)).mode & 0o777).toBe(0o600);
	});

	it.each(['null', '[]', '42', '"text"', 'false'])('rejects non-object JSON: %s', async contents => {
		await mkdir(path.dirname(configPath), {recursive: true});
		await writeFile(configPath, contents);
		await expect(readConfig()).rejects.toThrow('must contain a JSON object');
	});

	it('reports invalid JSON', async () => {
		await mkdir(path.dirname(configPath), {recursive: true});
		await writeFile(configPath, '{');
		await expect(readConfig()).rejects.toBeInstanceOf(SyntaxError);
	});

	it('propagates read errors other than a missing file', async () => {
		await mkdir(configPath, {recursive: true});
		await expect(readConfig()).rejects.toMatchObject({code: 'EISDIR'});
	});

	it('cleans up a temporary file when replacement fails', async () => {
		await mkdir(configPath, {recursive: true});
		await expect(writeConfig({theme: 'konkan'})).rejects.toBeInstanceOf(Error);
		expect(await readdir(path.dirname(configPath))).toEqual(['config.json']);
		expect((await stat(configPath)).isDirectory()).toBe(true);
	});

	it('preserves existing configuration if the new value cannot be serialized', async () => {
		const original = {theme: 'konkan', providers: {openai: {apiKey: 'test-key'}}};
		await writeConfig(original);
		const circular: Record<string, unknown> = {};
		circular.self = circular;

		await expect(writeConfig(circular)).rejects.toBeInstanceOf(TypeError);
		await expect(readConfig()).resolves.toEqual(original);
		expect(await readdir(path.dirname(configPath))).toEqual(['config.json']);
	});

	it('reports a blocked configuration directory without overwriting the blocking file', async () => {
		const blockedDirectory = path.dirname(configPath);
		await writeFile(blockedDirectory, 'keep this file');

		await expect(writeConfig({theme: 'konkan'})).rejects.toBeInstanceOf(Error);
		expect(await readFile(blockedDirectory, 'utf8')).toBe('keep this file');
		expect(await readdir(directory)).toEqual(['nested']);
	});

	it('keeps complete JSON and removes temporary files when writes overlap', async () => {
		const first = {theme: 'konkan', data: 'a'.repeat(4096)};
		const second = {theme: 'kaapi', data: 'b'.repeat(4096)};
		await Promise.all([writeConfig(first), writeConfig(second)]);

		expect([first, second]).toContainEqual(await readConfig());
		expect(await readdir(path.dirname(configPath))).toEqual(['config.json']);
	});
});
