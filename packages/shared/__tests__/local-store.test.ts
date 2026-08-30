import { describe, test, expect } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CONFIG_DIR, readJsonFile, writeJsonFile } from '../src/local-store';

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
        const filePath = join(CONFIG_DIR, 'local-store-guard-test.json');
        const existedBefore = existsSync(filePath);
        const contentBefore = existedBefore ? readFileSync(filePath, 'utf-8') : null;

        writeJsonFile('local-store-guard-test.json', { touched: true });

        expect(existsSync(filePath)).toBe(existedBefore);
        if (existedBefore) {
            expect(readFileSync(filePath, 'utf-8')).toBe(contentBefore!);
        }
    });
});
