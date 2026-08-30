import { describe, test, expect } from 'bun:test';
import { readAuth, writeAuthKey, removeAuthKey, getConfiguredProviders } from '../src/auth';

// Full guard coverage (empty read, no real-file writes under NODE_ENV=test)
// lives in local-store.test.ts, which every function here delegates to. This
// just confirms auth.ts actually wires up that guard rather than bypassing it.
describe('test-environment guard', () => {
    test('auth functions do not touch the real file', () => {
        expect(readAuth()).toEqual({});
        expect(getConfiguredProviders()).toEqual([]);
        expect(() => writeAuthKey('anthropic', 'sk-test-key')).not.toThrow();
        expect(() => removeAuthKey('anthropic')).not.toThrow();
    });
});
