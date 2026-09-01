import { describe, test, expect } from 'bun:test';
import { readPreferences, writePreferences, getEffortForModel, setEffortForModel } from '../../src/utils/preferences';

// Full guard coverage (empty read, no real-file writes under NODE_ENV=test)
// lives in @codeyantram/shared's local-store.test.ts, which readPreferences/
// writePreferences delegate to. This just confirms preferences.ts actually
// wires up that guard rather than bypassing it.
describe('test-environment guard', () => {
    test('preferences functions do not touch the real file', () => {
        expect(readPreferences()).toEqual({});
        expect(() => writePreferences({ themeName: 'Changed', modelId: 'claude-opus-5' })).not.toThrow();
    });

    test('getEffortForModel/setEffortForModel do not touch the real file', () => {
        expect(getEffortForModel('claude-sonnet-5')).toBeUndefined();
        expect(() => setEffortForModel('claude-sonnet-5', 'high')).not.toThrow();
        // Nothing actually persisted (writeJsonFile no-ops in test env), so a
        // read right after still comes back empty rather than reflecting the write.
        expect(getEffortForModel('claude-sonnet-5')).toBeUndefined();
    });
});
