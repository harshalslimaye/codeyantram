import { describe, test, expect } from 'bun:test';
import { readPreferences, writePreferences } from '../../src/utils/preferences';

// Full guard coverage (empty read, no real-file writes under NODE_ENV=test)
// lives in @codeyantram/shared's local-store.test.ts, which readPreferences/
// writePreferences delegate to. This just confirms preferences.ts actually
// wires up that guard rather than bypassing it.
describe('test-environment guard', () => {
    test('preferences functions do not touch the real file', () => {
        expect(readPreferences()).toEqual({});
        expect(() => writePreferences({ themeName: 'Changed', modelId: 'claude-opus-5' })).not.toThrow();
    });
});
