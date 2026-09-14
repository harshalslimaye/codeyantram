import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, basename } from 'node:path';

// Both the CLI's preferences (theme/model/agent) and the shared auth store
// (provider API keys) are flat JSON files here — this holds the read/write
// logic once so neither has to duplicate the test guard, directory creation,
// and merge-safe write pattern.
//
// A function rather than a constant, and resolved on every call rather than
// once at module load: CODEYANTRAM_CONFIG_DIR (see below) has to be able to
// change the answer for a test that sets it after this module is already
// imported - a value captured once at load time could never see that.
export function configDir(): string {
    return process.env.CODEYANTRAM_CONFIG_DIR ?? join(homedir(), '.codeyantram');
}

// Bun sets NODE_ENV=test automatically for `bun test`. Every store built on
// this module mounts in nearly every test across the CLI/server/shared
// suites, so without this guard a test run would read and write real files
// under ~/.codeyantram on whatever machine runs it.
export function isTestEnv(): boolean {
    return process.env.NODE_ENV === 'test';
}

// CODEYANTRAM_CONFIG_DIR is the one thing allowed to defeat isTestEnv() above: a store
// that only ever no-ops under test (auth.json, preferences.json) never needed real I/O
// to be testable, but a store with listing, retention, or corrupt-input recovery does -
// and isTestEnv() alone would make all of that permanently unreachable in a test run.
// Setting the override is an explicit, deliberate act (a test pointing at its own
// mkdtemp directory), so it takes precedence over the blanket test guard; leaving it
// unset keeps every existing store's no-op-under-test behavior exactly as it was.
//
// Exported (not just used internally) because it's the one thing a caller outside this
// file needs to know before persisting something whose *absence* under test would be
// unsafe to treat as "just not there yet" - the server's auth token (see
// server-token.ts) is real I/O gated by this exact rule: with persistence disabled, a
// value read back would never match one just "written", so enforcing a comparison against
// it would 401 every one of the server's own route tests that don't opt into the
// override. One predicate, used everywhere something needs to ask "is real persistence
// actually happening right now", rather than a second copy of this same condition
// drifting out of sync with it.
export function isRealIoEnabled(): boolean {
    return process.env.CODEYANTRAM_CONFIG_DIR !== undefined || !isTestEnv();
}

// The config directory holds nothing but secrets and a per-user database (API keys,
// server auth token, and now sessions.db - full chat transcripts) - created at 0700
// rather than mkdirSync's own default. One constant so every caller that creates it
// (writeJsonFile below, and @codeyantram/sessions' getDb()) agrees on the exact value.
export const CONFIG_DIR_MODE = 0o700;

export function readJsonFile<T>(filename: string): T | undefined {
    if (!isRealIoEnabled()) return undefined;

    try {
        return JSON.parse(readFileSync(join(configDir(), filename), 'utf-8')) as T;
    } catch {
        return undefined;
    }
}

export function writeJsonFile(filename: string, data: unknown, options?: { mode?: number }): void {
    if (!isRealIoEnabled()) return;

    try {
        ensureDir(configDir(), CONFIG_DIR_MODE);
        writeFileSync(join(configDir(), filename), JSON.stringify(data), {
            encoding: 'utf-8',
            mode: options?.mode,
        });
    } catch (error) {
        console.error(`Failed to persist ${filename}:`, error);
    }
}

/**
 * The existing `mkdirSync(CONFIG_DIR, { recursive: true })` call this replaces never
 * passed a `mode` at all, so every directory it created landed at Node's default (0o777
 * minus umask) no matter what a caller needed. This makes the mode explicit, for callers
 * (the sessions database's directory, in particular) that need 0700 rather than whatever
 * the umask happens to leave. Still subject to umask, same as the `mode` already passed
 * to `writeFileSync` for auth.json elsewhere in this file - not a guarantee of the exact
 * bits, just no longer silently ignored.
 */
export function ensureDir(path: string, mode?: number): void {
    mkdirSync(path, { recursive: true, mode });
}

/** Returns the name of the current working directory (root folder). */
export function getRootFolderName(): string {
    return basename(process.cwd());
}
