import { readJsonFile, writeJsonFile, type EffortLevel } from '@codeyantram/shared';

const PREFERENCES_FILE = 'preferences.json';

export type Preferences = {
    themeName?: string;
    modelId?: string;
    // Which model subagent workers run on (see the explore tool). Chosen independently of
    // modelId above and stored beside it rather than inside it - the two are separate
    // choices the user makes separately, and either may be any model in the catalog.
    workerModelId?: string;
    agentName?: string;
    // Keyed by model id so switching models remembers each one's own effort choice. Shared
    // by both roles on purpose: effort is a property of the model, not of what it is being
    // used for, so an orchestrator and a worker set to the same model share one value.
    effortByModel?: Record<string, EffortLevel>;
    // Off-switch for loading the project's AGENTS.md/CLAUDE.md into every turn - undefined
    // (nothing ever saved) means enabled, the default.
    projectInstructionsEnabled?: boolean;
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
