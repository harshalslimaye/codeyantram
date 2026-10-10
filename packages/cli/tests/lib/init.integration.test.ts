import type * as SharedModule from '@codeyantram/shared';
import {mkdtemp, mkdir, readdir, rm, stat, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {getUserGraphDirectory} from '@codeyantram/shared';
import {openWorkspaceGraph, resolveGraphStoragePaths} from '@codeyantram/graph';
import {initializeGraphForUI, runInit} from '../../src/lib/init.js';
import {WorkspaceGraphService} from '@codeyantram/server';

vi.mock('@codeyantram/shared', async importOriginal => ({
  ...await importOriginal<typeof SharedModule>(),
  getUserGraphDirectory: vi.fn<typeof getUserGraphDirectory>(),
}));

let directory: string | undefined;
afterEach(async () => {
  if (directory !== undefined) await rm(directory, {recursive: true, force: true});
  directory = undefined;
});

describe('init command with the installed CodeGraph SDK', () => {
  it('creates the global baseline and refreshes edits on rerun without creating project files', async () => {
    directory = await mkdtemp(path.join(tmpdir(), 'codeyantram-cli-init-'));
    const root = path.join(directory, 'project');
    const globalStorage = path.join(directory, 'global-config', 'codeyantram', 'graphs');
    vi.mocked(getUserGraphDirectory).mockReturnValue(globalStorage);
    await mkdir(root);
    await writeFile(path.join(root, 'entry.ts'), 'export function initialSymbol() { return "initial"; }\n');
    await writeFile(path.join(root, 'ignored.ts'), 'export function ignoredSymbol() {}\n');
    await writeFile(path.join(root, '.gitignore'), 'ignored.ts\n');
    const originalFiles = (await readdir(root)).sort();
    const stdout = {write: vi.fn<(text: string) => boolean>(() => true)};
    const stderr = {write: vi.fn<(text: string) => boolean>(() => true)};
    expect(await runInit(root, {stdout, stderr})).toBe(0);
    expect(stdout.write.mock.calls.flat().join('')).toContain('Graph ready');
    const storage = await resolveGraphStoragePaths(root);
    expect(path.dirname(storage.databasePath).startsWith(globalStorage)).toBe(true);
    expect((await stat(storage.databasePath)).isFile()).toBe(true);
    expect((await readdir(root)).sort()).toEqual(originalFiles);
    const graph = await openWorkspaceGraph(root);
    try {
      expect(graph.getStatus()).toMatchObject({indexState: 'complete', fileCount: 1});
      expect(graph.search('initialSymbol')[0]?.symbol.filePath).toBe('entry.ts');
      expect(graph.search('ignoredSymbol')).toEqual([]);
    } finally {await graph.close();}

    await writeFile(path.join(root, 'entry.ts'), 'export function updatedSymbol() { return "updated"; }\n');
    await writeFile(path.join(root, 'added.ts'), 'export function addedSymbol() {}\n');
    stdout.write.mockClear();
    expect(await runInit(root, {stdout, stderr})).toBe(0);
    expect(stdout.write.mock.calls.flat().join('')).toContain('Refreshing existing graph');
    const refreshed = await openWorkspaceGraph(root);
    try {
      expect(refreshed.getStatus().fileCount).toBe(2);
      expect(refreshed.search('initialSymbol')).toEqual([]);
      expect(refreshed.search('updatedSymbol')[0]?.symbol.filePath).toBe('entry.ts');
      expect(refreshed.search('addedSymbol')[0]?.symbol.filePath).toBe('added.ts');
    } finally {await refreshed.close();}
    const service = new WorkspaceGraphService(root);
    try {
      expect(await initializeGraphForUI(options => service.initialize(options), new AbortController().signal, vi.fn())).toMatch(/^Graph ready: 2 files,/);
    } finally {await service.close();}
    await expect(stat(path.join(root, 'codegraph.json'))).rejects.toMatchObject({code: 'ENOENT'});
    await expect(stat(path.join(root, '.codegraph'))).rejects.toMatchObject({code: 'ENOENT'});
    expect(stderr.write).not.toHaveBeenCalled();
  }, 30_000);
});
