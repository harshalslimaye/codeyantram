import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getOrCreateServerToken, isServerTokenEnforced, readServerToken } from '../src/server-token';

const ORIGINAL_CONFIG_DIR_OVERRIDE = process.env.CODEYANTRAM_CONFIG_DIR;

beforeEach(() => {
    delete process.env.CODEYANTRAM_CONFIG_DIR;
});

afterEach(() => {
    if (ORIGINAL_CONFIG_DIR_OVERRIDE === undefined) delete process.env.CODEYANTRAM_CONFIG_DIR;
    else process.env.CODEYANTRAM_CONFIG_DIR = ORIGINAL_CONFIG_DIR_OVERRIDE;
});

function withTempConfigDir<T>(run: (dir: string) => T): T {
    const dir = mkdtempSync(join(tmpdir(), 'codeyantram-server-token-test-'));
    try {
        return run(dir);
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
}

// Full guard coverage (empty read, no real-file writes) lives in local-store.test.ts;
// this confirms server-token.ts actually delegates to it, and specifically that under
// bare `bun test` (no override) the guard's "nothing is really persisted" behavior means
// getOrCreateServerToken() cannot be used as a stable value - each call mints its own,
// unobservable to anything else. isServerTokenEnforced() existing is exactly what keeps
// that fact from becoming a footgun (see server-auth.test.ts for the consequence).
describe('under bare NODE_ENV=test (no override)', () => {
    test('readServerToken returns undefined - nothing was ever really written', () => {
        expect(readServerToken()).toBeUndefined();
    });

    test('getOrCreateServerToken mints a value but cannot persist it - two calls disagree', () => {
        const first = getOrCreateServerToken();
        const second = getOrCreateServerToken();
        expect(typeof first).toBe('string');
        expect(first).not.toBe(second);
    });

    test('isServerTokenEnforced is false', () => {
        expect(isServerTokenEnforced()).toBe(false);
    });
});

describe('with CODEYANTRAM_CONFIG_DIR set (real persistence)', () => {
    test('getOrCreateServerToken mints once and persists it - later calls agree', () => {
        withTempConfigDir(dir => {
            process.env.CODEYANTRAM_CONFIG_DIR = dir;

            const first = getOrCreateServerToken();
            const second = getOrCreateServerToken();
            expect(second).toBe(first);
            expect(readServerToken()).toBe(first);
        });
    });

    test('writes server-token.json at 0600', () => {
        withTempConfigDir(dir => {
            process.env.CODEYANTRAM_CONFIG_DIR = dir;
            getOrCreateServerToken();

            const filePath = join(dir, 'server-token.json');
            expect(existsSync(filePath)).toBe(true);
            expect(statSync(filePath).mode & 0o777).toBe(0o600);
            expect(JSON.parse(readFileSync(filePath, 'utf-8'))).toHaveProperty('token');
        });
    });

    test('isServerTokenEnforced is true', () => {
        withTempConfigDir(dir => {
            process.env.CODEYANTRAM_CONFIG_DIR = dir;
            expect(isServerTokenEnforced()).toBe(true);
        });
    });

    test('readServerToken sees a token written by a separate call, matching how the CLI and server processes actually share it', () => {
        withTempConfigDir(dir => {
            process.env.CODEYANTRAM_CONFIG_DIR = dir;
            const minted = getOrCreateServerToken();

            expect(readServerToken()).toBe(minted);
        });
    });
});
