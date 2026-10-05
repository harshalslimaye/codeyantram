import {createHash} from 'node:crypto';
import {mkdtemp, mkdir, realpath, rm, symlink, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import type {FileRecord} from '@colbymchenry/codegraph';
import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import type {GraphStoragePaths} from '../../src/index.js';
import {SourceVerifier} from '../../src/navigation/source-verifier.js';

let directory: string, storage: GraphStoragePaths;
const text = 'export function greet() {}\n';
const hash = createHash('sha256').update(text).digest('hex');
const record: FileRecord = {
  path: 'helper.ts', language: 'typescript', contentHash: hash, size: text.length,
  modifiedAt: 1, indexedAt: 1, nodeCount: 1,
};

beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'codeyantram-verifier-'));
  const workspaceRoot = path.join(directory, 'project');
  await mkdir(workspaceRoot);
  await writeFile(path.join(workspaceRoot, 'helper.ts'), text);
  storage = {workspaceRoot: await realpath(workspaceRoot), workspaceId: 'a'.repeat(64), directory,
    databasePath: path.join(directory, 'unused.db'), lockPath: path.join(directory, 'unused.lock')};
});
afterEach(async () => {await rm(directory, {recursive: true, force: true});});

describe('shared source verifier', () => {
  it('accepts matching bytes and rejects differences from the indexed fingerprint', async () => {
    const verifier = new SourceVerifier({getFile: () => record}, storage);
    expect(await verifier.fingerprint('helper.ts')).toBe(hash);
    await writeFile(path.join(storage.workspaceRoot, 'helper.ts'), text + '// changed');
    await expect(verifier.fingerprint('helper.ts')).rejects.toMatchObject({code: 'stale_reference'});
  });

  it('rejects a symlink that leaves the workspace even when its bytes match', async () => {
    const outside = path.join(directory, 'outside.ts');
    await writeFile(outside, text);
    await symlink(outside, path.join(storage.workspaceRoot, 'link.ts'));
    const verifier = new SourceVerifier({getFile: () => record}, storage);
    await expect(verifier.fingerprint('link.ts')).rejects.toMatchObject({code: 'invalid_input'});
  });

  it('reports paths whose parent became a file as stale source', async () => {
    const verifier = new SourceVerifier({getFile: () => record}, storage);
    await expect(verifier.fingerprint('helper.ts/removed.ts')).rejects.toMatchObject({code: 'stale_reference'});
  });

  it('refuses oversized source before returning any fingerprint', async () => {
    await writeFile(path.join(storage.workspaceRoot, 'helper.ts'), 'x'.repeat(1024 * 1024 + 1));
    const verifier = new SourceVerifier({getFile: () => record}, storage);
    await expect(verifier.fingerprint('helper.ts')).rejects.toMatchObject({code: 'source_too_large'});
  });
});
