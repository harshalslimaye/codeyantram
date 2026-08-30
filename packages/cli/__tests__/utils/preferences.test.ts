import { describe, test, expect } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { readPreferences, writePreferences } from '../../src/utils/preferences';

// Bun sets NODE_ENV=test automatically, which readPreferences/writePreferences
// both check — without that guard, every test importing this module would
// depend on whatever preferences happen to be saved on the machine running
// them, and writePreferences below would write to that file for real.
describe('test-environment guard', () => {
    test('readPreferences returns an empty object rather than reading the real file', () => {
        expect(readPreferences()).toEqual({});
    });

    test('writePreferences does not touch the real preferences file', () => {
        // Checked as "unchanged from before this test", not "absent" — the
        // developer running this suite may have genuinely used the real app
        // and saved preferences already, and that pre-existing file is not
        // this test's business to disturb or assume away.
        const preferencesPath = join(homedir(), '.codeyantram', 'preferences.json');
        const existedBefore = existsSync(preferencesPath);
        const contentBefore = existedBefore ? readFileSync(preferencesPath, 'utf-8') : null;

        writePreferences({ themeName: 'Changed', modelId: 'claude-opus-5' });

        expect(existsSync(preferencesPath)).toBe(existedBefore);
        if (existedBefore) {
            expect(readFileSync(preferencesPath, 'utf-8')).toBe(contentBefore!);
        }
    });
});
