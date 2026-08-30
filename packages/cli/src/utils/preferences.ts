import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const CONFIG_DIR = join(homedir(), '.codeyantram');
const PREFERENCES_PATH = join(CONFIG_DIR, 'preferences.json');

export type Preferences = {
    themeName?: string;
    modelId?: string;
};

// Bun sets NODE_ENV=test automatically for `bun test`. Providers that store
// preferences here mount in nearly every test in the suite, so without this
// guard a test run would read and write the real file at ~/.codeyantram on
// whatever machine runs it.
function isTestEnv(): boolean {
    return process.env.NODE_ENV === 'test';
}

export function readPreferences(): Preferences {
    if (isTestEnv()) return {};

    try {
        return JSON.parse(readFileSync(PREFERENCES_PATH, 'utf-8')) as Preferences;
    } catch {
        return {};
    }
}

/** Merges `patch` over whatever is currently on disk, so one caller's save can never erase another's. */
export function writePreferences(patch: Partial<Preferences>): void {
    if (isTestEnv()) return;

    try {
        const current = readPreferences();
        mkdirSync(CONFIG_DIR, { recursive: true });
        writeFileSync(PREFERENCES_PATH, JSON.stringify({ ...current, ...patch }), 'utf-8');
    } catch (error) {
        console.error('Failed to persist preferences:', error);
    }
}
