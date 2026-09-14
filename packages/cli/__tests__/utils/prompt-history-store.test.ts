import { afterEach, beforeEach, describe, test, expect } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getPromptHistory, setPromptHistory } from '../../src/utils/prompt-history-store';

const ORIGINAL_CONFIG_DIR_OVERRIDE = process.env.CODEYANTRAM_CONFIG_DIR;

describe('test-environment guard', () => {
    test('does not touch a real file', () => {
        expect(getPromptHistory('/repo')).toEqual([]);
        expect(() => setPromptHistory('/repo', ['hello'])).not.toThrow();
        // Nothing actually persisted (writeJsonFile no-ops in test env), so a read right
        // after still comes back empty rather than reflecting the write.
        expect(getPromptHistory('/repo')).toEqual([]);
    });
});

describe('CODEYANTRAM_CONFIG_DIR override', () => {
    let tempDir: string;

    beforeEach(() => {
        tempDir = mkdtempSync(join(tmpdir(), 'codeyantram-prompt-history-test-'));
        process.env.CODEYANTRAM_CONFIG_DIR = tempDir;
    });

    afterEach(() => {
        rmSync(tempDir, { recursive: true, force: true });
        if (ORIGINAL_CONFIG_DIR_OVERRIDE === undefined) delete process.env.CODEYANTRAM_CONFIG_DIR;
        else process.env.CODEYANTRAM_CONFIG_DIR = ORIGINAL_CONFIG_DIR_OVERRIDE;
    });

    test('getPromptHistory returns nothing for a project that has never saved anything', () => {
        expect(getPromptHistory('/repo')).toEqual([]);
    });

    test('round-trips a project\'s entries', () => {
        setPromptHistory('/repo', ['fix the bug', 'add tests']);
        expect(getPromptHistory('/repo')).toEqual(['fix the bug', 'add tests']);
    });

    test('keeps each project\'s history separate', () => {
        setPromptHistory('/repo-a', ['a1', 'a2']);
        setPromptHistory('/repo-b', ['b1']);

        expect(getPromptHistory('/repo-a')).toEqual(['a1', 'a2']);
        expect(getPromptHistory('/repo-b')).toEqual(['b1']);
    });

    test('overwriting one project does not disturb another\'s', () => {
        setPromptHistory('/repo-a', ['a1']);
        setPromptHistory('/repo-b', ['b1']);
        setPromptHistory('/repo-a', ['a1', 'a2', 'a3']);

        expect(getPromptHistory('/repo-a')).toEqual(['a1', 'a2', 'a3']);
        expect(getPromptHistory('/repo-b')).toEqual(['b1']);
    });
});
