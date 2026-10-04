import {mkdtemp, mkdir, readdir, rename, rm, stat, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {getUserGraphDirectory} from '@codeyantram/shared';
import {WorkspaceGraphRegistry, type GraphCoordinatorLease} from '../src/index.js';

vi.mock('@codeyantram/shared', async importOriginal => ({
  ...await importOriginal<typeof import('@codeyantram/shared')>(), getUserGraphDirectory: vi.fn(),
}));

let directory: string | undefined;
let lease: GraphCoordinatorLease | undefined;
afterEach(async () => {
  await lease?.release(); lease = undefined;
  if (directory) await rm(directory, {recursive: true, force: true}); directory = undefined;
});

describe('coordinator with the installed CodeGraph SDK', () => {
  it('catches up manual changes before queries and synchronizes logical edits and relationships', async () => {
    directory = await mkdtemp(path.join(tmpdir(), 'codeyantram-graph-coordinator-'));
    const workspace = path.join(directory, 'project');
    const storage = path.join(directory, 'global', 'codeyantram', 'graphs');
    vi.mocked(getUserGraphDirectory).mockReturnValue(storage);
    await mkdir(workspace);
    await writeFile(path.join(workspace, '.gitignore'), 'ignored.ts\n');
    await writeFile(path.join(workspace, 'helper.ts'), 'export function greet() { return "hello"; }\n');
    await writeFile(path.join(workspace, 'main.ts'), 'import {greet} from "./helper";\nexport function welcome() { return greet(); }\n');
    await writeFile(path.join(workspace, 'ignored.ts'), 'export function ignoredSymbol() {}\n');
    const registry = new WorkspaceGraphRegistry();
    lease = await registry.acquire(workspace);
    const coordinator = lease.coordinator;
    const initial = await coordinator.query(reader => {
      const symbol = reader.search('greet').find(result => result.symbol.name === 'greet')!.symbol;
      return {symbol, callers: reader.getCallers(symbol.id), ignored: reader.search('ignoredSymbol')};
    });
    expect(initial.value.callers.map(relation => relation.symbol.name)).toContain('welcome');
    expect(initial.value.ignored).toEqual([]);
    expect(coordinator.storage.databasePath.startsWith(storage)).toBe(true);
    expect((await readdir(workspace)).sort()).toEqual(['.gitignore', 'helper.ts', 'ignored.ts', 'main.ts']);

    // Editor writes are deliberately not notified to the coordinator.
    await writeFile(path.join(workspace, 'helper.ts'), 'export function salute() { return "manual edit"; }\n');
    await writeFile(path.join(workspace, 'main.ts'), 'import {salute} from "./helper";\nexport function welcome() { return salute(); }\n');
    const updated = await coordinator.query(async reader => {
      const symbol = reader.search('salute').find(result => result.symbol.name === 'salute')!.symbol;
      return {old: reader.getSymbol(initial.value.symbol.id), source: await reader.getSource(symbol.id), callers: reader.getCallers(symbol.id)};
    });
    expect(updated.value.old).toBeNull();
    expect(updated.value.source).toContain('manual edit');
    expect(updated.value.callers.map(relation => relation.symbol.name)).toContain('welcome');
    expect(updated.freshness.epoch).toBe(initial.freshness.epoch);
    expect(updated.freshness.revision).toBeGreaterThan(initial.freshness.revision);

    const created = await coordinator.edit(async ({markChanged}) => {
      markChanged('added.ts');
      await writeFile(path.join(workspace, 'added.ts'), 'export function addedSymbol() {}\n');
      return 'saved';
    });
    expect(created).toMatchObject({mutation: {success: true, value: 'saved'}, graph: {state: 'synchronized'}});
    expect((await coordinator.query(reader => reader.search('addedSymbol'))).value[0]?.symbol.filePath).toBe('added.ts');
    await coordinator.edit(async ({markChanged}) => {
      markChanged('added.ts', 'moved.ts');
      await rename(path.join(workspace, 'added.ts'), path.join(workspace, 'moved.ts'));
    });
    expect((await coordinator.query(reader => reader.search('addedSymbol'))).value[0]?.symbol.filePath).toBe('moved.ts');
    await coordinator.edit(async ({markChanged}) => {
      markChanged('moved.ts'); await rm(path.join(workspace, 'moved.ts'));
    });
    expect((await coordinator.query(reader => reader.search('addedSymbol'))).value).toEqual([]);
    await expect(stat(path.join(workspace, 'codegraph.json'))).rejects.toMatchObject({code: 'ENOENT'});
    await expect(stat(path.join(workspace, '.codegraph'))).rejects.toMatchObject({code: 'ENOENT'});

    const epoch = coordinator.getStatus().freshness!.epoch;
    await lease.release();
    await writeFile(path.join(workspace, 'late.ts'), 'export function offlineSymbol() {}\n');
    lease = await registry.acquire(workspace);
    const reopened = await lease.coordinator.query(reader => reader.search('offlineSymbol'));
    expect(reopened.value[0]?.symbol.filePath).toBe('late.ts');
    expect(reopened.freshness.epoch).not.toBe(epoch);
  }, 30_000);
});
