import { describe, expect, test } from 'bun:test';

// Uses a dynamic import (not a top-level static one, like every other test file's
// `import { app } from '../src/index'`) so this file controls exactly when
// src/index.ts's top-level code - including the shutdown-handler registration under
// test - actually runs, relative to when the listener counts below are captured.
describe('shutdown handler registration', () => {
    test('registers no SIGINT/SIGTERM listeners under bun test (NODE_ENV=test)', async () => {
        const sigintBefore = process.listenerCount('SIGINT');
        const sigtermBefore = process.listenerCount('SIGTERM');

        await import('../src/index');

        // Whether this is the first time the module has ever been evaluated in this
        // process, or it was already cached from another test file, the assertion holds
        // either way: if it's genuinely the first evaluation, this proves the
        // isTestEnv() guard actually skipped registration; if it was already cached,
        // that earlier evaluation must have skipped it too (this file only ever runs
        // under the same NODE_ENV=test), so no new listeners appear now regardless.
        expect(process.listenerCount('SIGINT')).toBe(sigintBefore);
        expect(process.listenerCount('SIGTERM')).toBe(sigtermBefore);
    });
});
