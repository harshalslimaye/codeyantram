import type * as SharedModule from '@codeyantram/shared';
import {mkdtemp, mkdir, readdir, realpath, rm, stat, symlink, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {getUserGraphDirectory} from '@codeyantram/shared';
import {resolveGraphStoragePaths} from '../src/index.js';

vi.mock('@codeyantram/shared', async importOriginal => ({
  ...await importOriginal<typeof SharedModule>(),
  getUserGraphDirectory: vi.fn<typeof getUserGraphDirectory>(),
}));

let temporaryDirectory: string;
let workspaceRoot: string;
let globalGraphDirectory: string;

beforeEach(async () => {
  temporaryDirectory = await mkdtemp(path.join(tmpdir(), 'codeyantram-graph-storage-'));
  workspaceRoot = path.join(temporaryDirectory, 'workspace');
  globalGraphDirectory = path.join(temporaryDirectory, 'user-config', 'codeyantram', 'graphs');
  await mkdir(workspaceRoot);
  vi.mocked(getUserGraphDirectory).mockReturnValue(globalGraphDirectory);
});

afterEach(async () => {
  await rm(temporaryDirectory, {recursive: true, force: true});
});

describe('workspace graph storage', () => {
  it('keeps database and lock paths under the global directory without writing files', async () => {
    const storage = await resolveGraphStoragePaths(workspaceRoot);
    expect(storage.workspaceRoot).toBe(await realpath(workspaceRoot));
    expect(storage.workspaceId).toMatch(/^[a-f0-9]{64}$/);
    expect(storage.directory).toBe(path.join(globalGraphDirectory, storage.workspaceId));
    expect(storage.databasePath).toBe(path.join(storage.directory, 'codegraph.db'));
    expect(storage.lockPath).toBe(path.join(storage.directory, 'codegraph.lock'));
    expect(await readdir(workspaceRoot)).toEqual([]);
    await expect(stat(globalGraphDirectory)).rejects.toMatchObject({code: 'ENOENT'});
  });

  it('uses the same storage for repeated calls and relative paths to a workspace', async () => {
    const absolute = await resolveGraphStoragePaths(workspaceRoot);
    expect(await resolveGraphStoragePaths(workspaceRoot)).toEqual(absolute);
    expect(await resolveGraphStoragePaths(path.relative(process.cwd(), workspaceRoot))).toEqual(absolute);
  });

  it('shares storage for a workspace accessed through a symlink', async () => {
    const alias = path.join(temporaryDirectory, 'alias');
    await symlink(workspaceRoot, alias, process.platform === 'win32' ? 'junction' : 'dir');
    expect(await resolveGraphStoragePaths(alias)).toEqual(await resolveGraphStoragePaths(workspaceRoot));
  });

  it('keeps separate checkouts with the same directory name in separate indexes', async () => {
    const secondCheckout = path.join(temporaryDirectory, 'other-parent', 'workspace');
    await mkdir(secondCheckout, {recursive: true});
    const first = await resolveGraphStoragePaths(workspaceRoot);
    const second = await resolveGraphStoragePaths(secondCheckout);
    expect(second.workspaceId).not.toBe(first.workspaceId);
    expect(second.directory).not.toBe(first.directory);
  });

  it.each(['', ' \n\t '])('rejects a blank root rather than choosing the current directory (case %#)', async root => {
    await expect(resolveGraphStoragePaths(root)).rejects.toThrow('A graph workspace root is required.');
  });

  it('rejects missing roots and file roots', async () => {
    await expect(resolveGraphStoragePaths(path.join(temporaryDirectory, 'missing')))
      .rejects.toMatchObject({code: 'ENOENT'});
    const fileRoot = path.join(temporaryDirectory, 'file.ts');
    await writeFile(fileRoot, 'export {};');
    await expect(resolveGraphStoragePaths(fileRoot)).rejects.toThrow('must be a directory');
  });
});
