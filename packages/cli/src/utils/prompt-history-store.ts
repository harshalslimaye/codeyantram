import { readJsonFile, writeJsonFile } from '@codeyantram/shared';

const PROMPT_HISTORY_FILE = 'prompt-history.json';

/**
 * Prompt history keyed by project (cwd) - a separate file from preferences.json, not a
 * new field on it. Two reasons: this is a genuinely different kind of data (a log of what
 * was typed, not a setting), and unlike theme/model/agent it must never bleed across
 * projects - the same conversation history recalled in one repo showing up in an
 * unrelated one would be actively confusing, not a convenience.
 */
export function getPromptHistory(project: string): string[] {
    return readJsonFile<Record<string, string[]>>(PROMPT_HISTORY_FILE)?.[project] ?? [];
}

/** Overwrites this project's own entry, leaving every other project's history untouched -
 * same merge-over-existing shape as preferences.ts' setEffortForModel. */
export function setPromptHistory(project: string, entries: string[]): void {
    const current = readJsonFile<Record<string, string[]>>(PROMPT_HISTORY_FILE) ?? {};
    writeJsonFile(PROMPT_HISTORY_FILE, { ...current, [project]: entries });
}
