import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

// Both the CLI's preferences (theme/model/agent) and the shared auth store
// (provider API keys) are flat JSON files here — this holds the read/write
// logic once so neither has to duplicate the test guard, directory creation,
// and merge-safe write pattern.
export const CONFIG_DIR = join(homedir(), '.codeyantram');

// Bun sets NODE_ENV=test automatically for `bun test`. Every store built on
// this module mounts in nearly every test across the CLI/server/shared
// suites, so without this guard a test run would read and write real files
// under ~/.codeyantram on whatever machine runs it.
export function isTestEnv(): boolean {
    return process.env.NODE_ENV === 'test';
}

export function readJsonFile<T>(filename: string): T | undefined {
    if (isTestEnv()) return undefined;

    try {
        return JSON.parse(readFileSync(join(CONFIG_DIR, filename), 'utf-8')) as T;
    } catch {
        return undefined;
    }
}

export function writeJsonFile(filename: string, data: unknown, options?: { mode?: number }): void {
    if (isTestEnv()) return;

    try {
        mkdirSync(CONFIG_DIR, { recursive: true });
        writeFileSync(join(CONFIG_DIR, filename), JSON.stringify(data), {
            encoding: 'utf-8',
            mode: options?.mode,
        });
    } catch (error) {
        console.error(`Failed to persist ${filename}:`, error);
    }
}
