import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { configDir, ensureDir, readJsonFile, writeJsonFile } from '../src/local-store';

const ORIGINAL_CONFIG_DIR_OVERRIDE = process.env.CODEYANTRAM_CONFIG_DIR;

// Every test in this file runs with the override unset unless it sets one itself, and
// nothing leaks into the next test file - bun test shares one process across files, so an
// override left set here would otherwise change configDir()'s answer for suites that
// never asked for it (see auth.test.ts, preferences.test.ts - both mount on this module).
beforeEach(() => {
    delete process.env.CODEYANTRAM_CONFIG_DIR;
});

afterEach(() => {
    if (ORIGINAL_CONFIG_DIR_OVERRIDE === undefined) delete process.env.CODEYANTRAM_CONFIG_DIR;
    else process.env.CODEYANTRAM_CONFIG_DIR = ORIGINAL_CONFIG_DIR_OVERRIDE;
});

function withTempDir(run: (dir: string) => void): void {
    const dir = mkdtempSync(join(tmpdir(), 'codeyantram-test-'));
    try {
        run(dir);
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
}

// Bun sets NODE_ENV=test automatically, which readJsonFile/writeJsonFile both
// check — without that guard, every store built on this module (CLI
// preferences, shared auth) would read and write real files under
// ~/.codeyantram on whatever machine runs the suite.
describe('test-environment guard', () => {
    test('readJsonFile returns undefined rather than reading a real file', () => {
        expect(readJsonFile('preferences.json')).toBeUndefined();
        expect(readJsonFile('auth.json')).toBeUndefined();
    });

    test('writeJsonFile does not touch a real file', () => {
        const filePath = join(configDir(), 'local-store-guard-test.json');
        const existedBefore = existsSync(filePath);
        const contentBefore = existedBefore ? readFileSync(filePath, 'utf-8') : null;

        writeJsonFile('local-store-guard-test.json', { touched: true });

        expect(existsSync(filePath)).toBe(existedBefore);
        if (existedBefore) {
            expect(readFileSync(filePath, 'utf-8')).toBe(contentBefore!);
        }
    });
});

// CODEYANTRAM_CONFIG_DIR is the one thing that may defeat the guard above. A store with
// listing, retention, or corrupt-input recovery (the sessions database) needs to be
// testable against a real filesystem, which the blanket guard alone would make
// permanently unreachable - setting the override is what makes that an explicit, opt-in
// act instead of a general loosening of the guard for every store built on this module.
describe('CODEYANTRAM_CONFIG_DIR override', () => {
    test('configDir() reflects the override', () => {
        withTempDir(dir => {
            process.env.CODEYANTRAM_CONFIG_DIR = dir;
            expect(configDir()).toBe(dir);
        });
    });

    test('configDir() is resolved per call, not cached at import time', () => {
        withTempDir(first => {
            withTempDir(second => {
                process.env.CODEYANTRAM_CONFIG_DIR = first;
                expect(configDir()).toBe(first);

                process.env.CODEYANTRAM_CONFIG_DIR = second;
                expect(configDir()).toBe(second);
            });
        });
    });

    test('readJsonFile and writeJsonFile perform real I/O once set, even under NODE_ENV=test', () => {
        withTempDir(dir => {
            process.env.CODEYANTRAM_CONFIG_DIR = dir;

            // Nothing written yet - still a real (missed) read, not the blanket undefined
            // the guard above returns.
            expect(readJsonFile('example.json')).toBeUndefined();

            writeJsonFile('example.json', { hello: 'world' });

            const filePath = join(dir, 'example.json');
            expect(existsSync(filePath)).toBe(true);
            expect(JSON.parse(readFileSync(filePath, 'utf-8'))).toEqual({ hello: 'world' });
            expect(readJsonFile<{ hello: string }>('example.json')).toEqual({ hello: 'world' });
        });
    });

    test('writeJsonFile creates the override directory (at 0700) if it does not exist yet', () => {
        withTempDir(parent => {
            const dir = join(parent, 'nested', 'config');
            process.env.CODEYANTRAM_CONFIG_DIR = dir;

            writeJsonFile('example.json', { created: true });

            expect(existsSync(join(dir, 'example.json'))).toBe(true);
            expect(statSync(dir).mode & 0o777).toBe(0o700);
        });
    });
});

describe('ensureDir', () => {
    test('creates nested directories that do not exist yet', () => {
        withTempDir(parent => {
            const target = join(parent, 'a', 'b', 'c');
            ensureDir(target);
            expect(existsSync(target)).toBe(true);
        });
    });

    test('applies an explicit mode, unlike the plain mkdirSync call this replaces', () => {
        withTempDir(parent => {
            const target = join(parent, 'restricted');
            ensureDir(target, 0o700);
            expect(statSync(target).mode & 0o777).toBe(0o700);
        });
    });

    test('is a no-op when the directory already exists', () => {
        withTempDir(dir => {
            expect(() => ensureDir(dir)).not.toThrow();
        });
    });
});
