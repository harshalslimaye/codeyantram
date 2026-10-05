import {chmod, mkdtemp, mkdir, readFile, readdir, rename, rm, stat, writeFile} from 'node:fs/promises';
import {readFileSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import path from 'node:path';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {getUserGraphDirectory} from '@codeyantram/shared';
import {openWorkspaceGraph, type WorkspaceGraph} from '../src/index.js';

vi.mock('@codeyantram/shared', async importOriginal => ({
  ...await importOriginal<typeof import('@codeyantram/shared')>(),
  getUserGraphDirectory: vi.fn(),
}));

let directory: string;
let workspace: string;
let globalStorage: string;
let graphs: WorkspaceGraph[];
const git = promisify(execFile);

async function trackFixture() {
  await git('git', ['init', '--quiet'], {cwd: workspace});
  await git('git', ['add', '.'], {cwd: workspace});
  return readFile(path.join(workspace, '.git', 'index'));
}

beforeEach(async () => {
  graphs = [];
  directory = await mkdtemp(path.join(tmpdir(), 'codeyantram-graph-adapter-'));
  workspace = path.join(directory, 'project');
  globalStorage = path.join(directory, 'user-config', 'codeyantram', 'graphs');
  await mkdir(path.join(workspace, 'src'), {recursive: true});
  await mkdir(path.join(workspace, '.codegraph'));
  await Promise.all([
    writeFile(path.join(workspace, 'src', 'helper.ts'), 'export function greet(): string { return "hello"; }\n'),
    writeFile(path.join(workspace, 'src', 'main.ts'), 'import {greet} from "./helper";\nexport function welcome(): string { return greet(); }\n'),
    writeFile(path.join(workspace, 'excluded.ts'), 'export function excludedSymbol() {}\n'),
    writeFile(path.join(workspace, '.codegraph', 'team.json'), '{"shared":true}\n'),
    writeFile(path.join(workspace, '.gitignore'), 'build/\nexcluded.ts\n'),
  ]);
  vi.mocked(getUserGraphDirectory).mockReturnValue(globalStorage);
});

afterEach(async () => {
  await Promise.all(graphs.map(graph => graph.close()));
  await rm(directory, {recursive: true, force: true});
});

async function open(root = workspace) {
  const graph = await openWorkspaceGraph(root);
  graphs.push(graph);
  return graph;
}

async function sourceSnapshot() {
  const entries = await readdir(workspace, {recursive: true});
  const files = entries.sort().filter(entry => !['src', '.codegraph'].includes(entry));
  return Promise.all(files.map(async file => [file, await readFile(path.join(workspace, file), 'utf8')]));
}

describe('real CodeGraph adapter', () => {
  it('initializes a Git working tree with unstaged deletions without changing the Git index', async () => {
    const gitIndex = await trackFixture();
    await rm(path.join(workspace, 'src/helper.ts'));
    const graph = await open();
    expect(await graph.index()).toMatchObject({success: true, state: 'complete', filesErrored: 0, errors: []});
    expect(graph.search('greet').some(result => result.symbol.filePath === 'src/helper.ts')).toBe(false);
    expect((await graph.sync()).success).toBe(true);
    expect(await readFile(path.join(workspace, '.git/index'))).toEqual(gitIndex);
  }, 30_000);

  it('syncs unstaged Git deletions and moves and discovers untracked replacements', async () => {
    const gitIndex = await trackFixture();
    const graph = await open();
    expect((await graph.index()).success).toBe(true);
    const old = graph.search('greet').find(result => result.symbol.name === 'greet')!.symbol;
    await rename(path.join(workspace, 'src/helper.ts'), path.join(workspace, 'src/moved.ts'));
    await writeFile(path.join(workspace, 'src/main.ts'), 'import {greet} from "./moved";\nexport function welcome() { return greet(); }\n');
    expect(await graph.sync()).toMatchObject({success: true, filesRemoved: 1, filesAdded: 1, failedFilePaths: []});
    expect(graph.getSymbol(old.id)).toBeNull();
    const moved = graph.search('greet').find(result => result.symbol.name === 'greet')!.symbol;
    expect(moved.filePath).toBe('src/moved.ts');
    expect(graph.getCallers(moved.id).map(relation => relation.symbol.name)).toContain('welcome');
    await rm(path.join(workspace, 'src/main.ts'));
    expect(await graph.sync()).toMatchObject({success: true, filesRemoved: 1, failedFilePaths: []});
    expect(graph.search('welcome')).toEqual([]);
    expect(graph.getCallers(moved.id)).toEqual([]);
    expect(await readFile(path.join(workspace, '.git/index'))).toEqual(gitIndex);
  }, 30_000);

  it.skipIf(process.platform === 'win32' || process.getuid?.() === 0)('still reports unreadable existing Git files as indexing failures', async () => {
    await trackFixture();
    const source = path.join(workspace, 'src/helper.ts');
    await chmod(source, 0o000);
    try {
      const graph = await open();
      const report = await graph.index();
      expect(report.success).toBe(false);
      expect(report.filesErrored).toBeGreaterThan(0);
      expect(report.errors).toContainEqual(expect.objectContaining({filePath: 'src/helper.ts', code: 'read_error', severity: 'error'}));
    } finally {await chmod(source, 0o644);}
  }, 30_000);

  it('builds bounded context with verified snippets, locations, relationships, and explicit coverage', async () => {
    const graph = await open(); await graph.index();
    const context = await graph.explore('greet');
    expect(context.symbols.some(symbol => symbol.name === 'greet')).toBe(true);
    expect(context.snippets.some(snippet => snippet.text.includes('hello'))).toBe(true);
    expect(context.snippets[0]).toMatchObject({filePath: expect.any(String), startLine: expect.any(Number), contentHash: expect.stringMatching(/^[a-f0-9]{64}$/)});
    expect(context.coverage).toContain('Indexed scope only');
    const bounded = await graph.explore('greet', {maxNodes: 1, maxCharacters: 2048});
    expect(bounded.symbols.length).toBeLessThanOrEqual(1);
    expect(JSON.stringify(bounded).length).toBeLessThanOrEqual(2048);
    expect(bounded.truncated).toBe(true);
    const pending = graph.explore('greet');
    writeFileSync(path.join(workspace, 'src/helper.ts'), 'export function greet() { return "changed during query"; }\n');
    await expect(pending).rejects.toThrow('Source changed');
    expect((await graph.sync()).success).toBe(true);
    expect((await graph.explore('greet')).snippets.some(snippet => snippet.text.includes('changed during query'))).toBe(true);
  }, 30_000);

  it('uses gitignore without generating project configuration during index, sync, or reopen', async () => {
    const before = await sourceSnapshot();
    const graph = await open();
    expect((await graph.index()).success).toBe(true);
    expect(graph.getStatus().fileCount).toBe(2);
    expect(graph.search('excludedSymbol')).toEqual([]);
    expect((await graph.sync()).success).toBe(true);
    await graph.close();
    const reopened = await open();
    expect(reopened.created).toBe(false);
    expect(await sourceSnapshot()).toEqual(before);
    await expect(stat(path.join(workspace, 'codegraph.json'))).rejects.toMatchObject({code: 'ENOENT'});
  }, 30_000);

  it('indexes the source project with its config while writing SQLite and locks only to global storage', async () => {
    // A project can supply its own config; Codeyantram does not generate it.
    await writeFile(path.join(workspace, 'codegraph.json'), JSON.stringify({exclude: ['excluded.ts']}));
    await writeFile(path.join(workspace, '.gitignore'), 'build/\n');
    const before = await sourceSnapshot();
    const graph = await open();
    expect(graph.created).toBe(true);
    expect(graph.getStatus().indexState).toBeNull();
    expect((await stat(graph.storage.databasePath)).isFile()).toBe(true);
    // A file in the data directory must never become part of the source project.
    await writeFile(path.join(graph.storage.directory, 'storage-only.ts'), 'export function storageOnly() {}\n');
    const progress = vi.fn(() => {
      expect(() => graph.search('greet')).toThrow('indexing');
      expect(readFileSync(graph.storage.lockPath, 'utf8')).toBe(String(process.pid));
    });
    const report = await graph.index({onProgress: progress});
    expect(report).toMatchObject({success: true, state: 'complete', filesIndexed: 2, filesErrored: 0, errors: []});
    expect(progress).toHaveBeenCalled();
    expect(graph.getStatus()).toMatchObject({indexState: 'complete', needsReindex: false, fileCount: 2});
    expect(graph.search('excludedSymbol')).toEqual([]);
    expect(graph.search('storageOnly')).toEqual([]);
    const greet = graph.search('greet').find(result => result.symbol.name === 'greet')!.symbol;
    expect(greet).toMatchObject({filePath: 'src/helper.ts', startLine: 1, endLine: 1});
    expect(graph.getSymbol(greet.id)).toEqual(greet);
    expect(await graph.getSource(greet.id)).toContain('return "hello"');
    expect(graph.getCallers(greet.id).map(relation => relation.symbol.name)).toContain('welcome');
    const welcome = graph.search('welcome').find(result => result.symbol.name === 'welcome')!.symbol;
    expect(graph.getCallees(welcome.id).map(relation => relation.symbol.name)).toContain('greet');
    expect(await sourceSnapshot()).toEqual(before);
    expect(await readdir(path.join(workspace, '.codegraph'))).toEqual(['team.json']);
    // Released locks can leave a file behind, but it must be in global storage.
    expect(path.dirname(graph.storage.lockPath)).toBe(graph.storage.directory);
    expect((await readdir(graph.storage.directory)).some(file => file.startsWith('codegraph.db'))).toBe(true);
  }, 30_000);

  it('reopens the persisted index and reads code from the original project', async () => {
    const first = await open();
    expect((await first.index()).success).toBe(true);
    const symbol = first.search('greet').find(result => result.symbol.name === 'greet')!.symbol;
    await first.close();
    const second = await open();
    expect(second.created).toBe(false);
    expect(second.storage).toEqual(first.storage);
    expect(second.getSymbol(symbol.id)).toEqual(symbol);
    expect(await second.getSource(symbol.id)).toContain('return "hello"');
    expect(second.getStatus().indexState).toBe('complete');
  }, 30_000);

  it('reconciles manual updates, creates, moves, and deletes without rebuilding', async () => {
    const graph = await open();
    await graph.index();
    const old = graph.search('greet').find(result => result.symbol.name === 'greet')!.symbol;
    await writeFile(path.join(workspace, 'src', 'helper.ts'), 'export function salute(): string { return "updated"; }\n');
    await writeFile(path.join(workspace, 'src', 'main.ts'), 'import {salute} from "./helper";\nexport function welcome(): string { return salute(); }\n');
    const update = await graph.sync();
    expect(update).toMatchObject({success: true, filesModified: 2, failedFilePaths: []});
    expect(graph.getSymbol(old.id)).toBeNull();
    expect(graph.search('greet')).toEqual([]);
    const salute = graph.search('salute').find(result => result.symbol.name === 'salute')!.symbol;
    expect(await graph.getSource(salute.id)).toContain('updated');
    expect(graph.getCallers(salute.id).map(relation => relation.symbol.name)).toContain('welcome');

    await writeFile(path.join(workspace, 'src', 'added.ts'), 'export function addedSymbol() {}\n');
    expect(await graph.sync()).toMatchObject({success: true, filesAdded: 1});
    await rename(path.join(workspace, 'src', 'added.ts'), path.join(workspace, 'src', 'moved.ts'));
    expect(await graph.sync()).toMatchObject({success: true, filesAdded: 1, filesRemoved: 1});
    expect(graph.search('addedSymbol')[0]?.symbol.filePath).toBe('src/moved.ts');
    await rm(path.join(workspace, 'src', 'moved.ts'));
    expect(await graph.sync()).toMatchObject({success: true, filesRemoved: 1});
    expect(graph.search('addedSymbol')).toEqual([]);
  }, 30_000);

  it('keeps two open workspaces and their database state independent', async () => {
    const secondRoot = path.join(directory, 'second');
    await mkdir(secondRoot);
    await writeFile(path.join(secondRoot, 'second.ts'), 'export function otherProject() {}\n');
    const first = await open();
    const second = await open(secondRoot);
    expect(first.storage.databasePath).not.toBe(second.storage.databasePath);
    expect((await first.index()).success).toBe(true);
    expect((await second.index()).success).toBe(true);
    expect(first.search('otherProject')).toEqual([]);
    expect(second.search('greet')).toEqual([]);
    expect(second.search('otherProject')[0]?.symbol.filePath).toBe('second.ts');
    expect(await readdir(secondRoot)).toEqual(['second.ts']);
  }, 30_000);

  it('drains indexing before closing and rejects work after close begins', async () => {
    const graph = await open();
    const indexing = graph.index();
    const closing = graph.close();
    expect(graph.close()).toBe(closing);
    expect(() => graph.search('greet')).toThrow('closing or closed');
    expect(() => graph.sync()).toThrow('closing or closed');
    expect((await indexing).success).toBe(true);
    await closing;
    const reopened = await open();
    expect(reopened.getStatus().indexState).toBe('complete');
  }, 30_000);

  it('preserves an invalid existing database rather than replacing it', async () => {
    const first = await open();
    const {databasePath} = first.storage;
    await first.close();
    await writeFile(databasePath, 'invalid existing database');
    await expect(open()).rejects.toThrow();
    expect(await readFile(databasePath, 'utf8')).toBe('invalid existing database');
    await expect(stat(first.storage.lockPath)).rejects.toMatchObject({code: 'ENOENT'});
  });

  it('surfaces index and sync lock failures without reporting success', async () => {
    const graph = await open();
    await writeFile(graph.storage.lockPath, String(process.pid));
    const report = await graph.index();
    expect(report).toMatchObject({success: false, filesIndexed: 0, filesErrored: 0});
    expect(report.errors[0]?.message).toContain('file lock');
    await expect(graph.sync()).rejects.toThrow('file lock');
    await expect(open()).rejects.toThrow('locked');
    // Failed lock acquisition must not release someone else's lock.
    expect(await readFile(graph.storage.lockPath, 'utf8')).toBe(String(process.pid));
    await rm(graph.storage.lockPath);
    expect((await graph.index()).success).toBe(true);
  }, 30_000);

  it('refreshes another open instance after manual changes are synced', async () => {
    const writer = await open();
    await writer.index();
    const reader = await open();
    const old = reader.search('greet').find(result => result.symbol.name === 'greet')!.symbol;
    expect(reader.getSymbol(old.id)).toEqual(old);
    await writeFile(path.join(workspace, 'src', 'helper.ts'), '\n\nexport function greet(): string { return "new source"; }\n');
    expect((await writer.sync()).success).toBe(true);
    expect(reader.getSymbol(old.id)).toBeNull();
    const updated = reader.search('greet').find(result => result.symbol.name === 'greet')!.symbol;
    expect(updated.startLine).toBe(3);
    expect(await reader.getSource(updated.id)).toContain('new source');
  }, 30_000);

  it('bounds search/traversal inputs and handles missing symbols', async () => {
    const graph = await open();
    expect(() => graph.search(' ')).toThrow('characters');
    expect(() => graph.search('x'.repeat(1025))).toThrow('characters');
    expect(() => graph.search('greet', 101)).toThrow('Search limit');
    expect(() => graph.getCallers('missing', 6)).toThrow('Traversal depth');
    expect(graph.getSymbol('missing')).toBeNull();
    expect(await graph.getSource('missing')).toBeNull();
  });
});
