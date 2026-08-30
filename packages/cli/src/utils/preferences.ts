import { readJsonFile, writeJsonFile } from '@codeyantram/shared';

const PREFERENCES_FILE = 'preferences.json';

export type Preferences = {
    themeName?: string;
    modelId?: string;
    agentName?: string;
};

export function readPreferences(): Preferences {
    return readJsonFile<Preferences>(PREFERENCES_FILE) ?? {};
}

/** Merges `patch` over whatever is currently on disk, so one caller's save can never erase another's. */
export function writePreferences(patch: Partial<Preferences>): void {
    const current = readPreferences();
    writeJsonFile(PREFERENCES_FILE, { ...current, ...patch });
}
