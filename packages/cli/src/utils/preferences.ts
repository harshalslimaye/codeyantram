import { readJsonFile, writeJsonFile, type EffortLevel } from '@codeyantram/shared';

const PREFERENCES_FILE = 'preferences.json';

export type Preferences = {
    themeName?: string;
    modelId?: string;
    agentName?: string;
    // Keyed by model id so switching models remembers each one's own effort choice.
    effortByModel?: Record<string, EffortLevel>;
    showThoughts?: boolean;
};

export function readPreferences(): Preferences {
    return readJsonFile<Preferences>(PREFERENCES_FILE) ?? {};
}

/** Merges `patch` over whatever is currently on disk, so one caller's save can never erase another's. */
export function writePreferences(patch: Partial<Preferences>): void {
    const current = readPreferences();
    writeJsonFile(PREFERENCES_FILE, { ...current, ...patch });
}

export function getEffortForModel(modelId: string): EffortLevel | undefined {
    return readPreferences().effortByModel?.[modelId];
}

/** Merges into the existing map so setting one model's effort can't erase another's. */
export function setEffortForModel(modelId: string, effort: EffortLevel): void {
    const current = readPreferences();
    writePreferences({
        effortByModel: { ...current.effortByModel, [modelId]: effort },
    });
}

export function getShowThoughts(): boolean | undefined {
    return readPreferences().showThoughts;
}

export function setShowThoughts(value: boolean): void {
    writePreferences({ showThoughts: value });
}
