import {mkdtemp, mkdir, readdir, rm, stat, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {getUserGraphDirectory} from '@codeyantram/shared';
import {startChatServer} from '../../src/chat/server.js';
import {requestChat} from '../../src/chat/client.js';

vi.mock('@codeyantram/shared', async importOriginal => ({
  ...await importOriginal<typeof import('@codeyantram/shared')>(), getUserGraphDirectory: vi.fn(),
}));

const servers: Awaited<ReturnType<typeof startChatServer>>[] = [];
let directory: string | undefined;
afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => server.close()));
  if (directory) await rm(directory, {recursive: true, force: true}); directory = undefined;
});

describe('CLI server graph lifetime with the installed SDK', () => {
  it('leaves ordinary chat lazy, retains palette initialization, shares workspace leases, and catches up after reopening', async () => {
    directory = await mkdtemp(path.join(tmpdir(), 'codeyantram-server-graph-'));
    const root = path.join(directory, 'project');
    const global = path.join(directory, 'user-config', 'codeyantram', 'graphs');
    vi.mocked(getUserGraphDirectory).mockReturnValue(global);
    await mkdir(root);
    await writeFile(path.join(root, 'entry.ts'), 'export function initialSymbol() { return "initial"; }\n');
    const readConfig = vi.fn(async () => ({}));
    const streamChat = vi.fn(async function* () {
      yield {type: 'start' as const, messageId: 'a1'};
      yield {type: 'done' as const, durationMs: 1};
    });
    const first = await startChatServer({workspaceRoot: root, readConfig, streamChat}); servers.push(first);
    expect(first.workspaceGraph.getStatus().lifecycle).toBe('unopened');
    await expect(stat(global)).rejects.toMatchObject({code: 'ENOENT'});
    for await (const _event of requestChat(first.chatUrl, {
      model: 'gpt-6.1-sol', messages: [{id: 'u1', role: 'user', parts: [{type: 'text', text: 'hello'}]}],
    }, new AbortController().signal)) { /* consume the ordinary chat */ }
    expect(streamChat).toHaveBeenCalledOnce();
    expect(readConfig).toHaveBeenCalledOnce();
    expect(first.workspaceGraph.getStatus().lifecycle).toBe('unopened');
    await expect(stat(global)).rejects.toMatchObject({code: 'ENOENT'});

    const progress = vi.fn();
    expect(await first.initializeGraph(new AbortController().signal, progress)).toMatch(/^Graph ready: 1 files,/);
    expect(progress).toHaveBeenCalled();
    expect(first.workspaceGraph.getStatus()).toMatchObject({lifecycle: 'open', graph: {readiness: 'ready'}});
    expect(readConfig).toHaveBeenCalledOnce();
    const initial = await first.workspaceGraph.query(reader => reader.search('initialSymbol'));
    expect(initial.value[0]?.symbol.filePath).toBe('entry.ts');

    const second = await startChatServer({workspaceRoot: root}); servers.push(second);
    const shared = await second.workspaceGraph.query(reader => reader.search('initialSymbol'));
    expect(shared.freshness.epoch).toBe(initial.freshness.epoch);
    await first.close();
    expect(first.workspaceGraph.getStatus().lifecycle).toBe('closed');
    await expect(first.initializeGraph(new AbortController().signal, vi.fn())).rejects.toThrow('closing or closed');

    await writeFile(path.join(root, 'entry.ts'), 'export function manuallyUpdatedSymbol() { return "updated"; }\n');
    const updated = await second.workspaceGraph.query(reader => reader.search('manuallyUpdatedSymbol'));
    expect(updated.value[0]?.symbol.filePath).toBe('entry.ts');
    expect(updated.freshness.epoch).toBe(initial.freshness.epoch);
    const edit = await second.workspaceGraph.edit(async ({markChanged}) => {
      markChanged('added.ts'); await writeFile(path.join(root, 'added.ts'), 'export function addedSymbol() {}\n');
    });
    expect(edit.graph.state).toBe('synchronized');
    expect((await second.workspaceGraph.query(reader => reader.search('addedSymbol'))).value[0]?.symbol.filePath).toBe('added.ts');
    await second.close();

    await writeFile(path.join(root, 'offline.ts'), 'export function offlineSymbol() {}\n');
    const third = await startChatServer({workspaceRoot: root}); servers.push(third);
    expect(third.workspaceGraph.getStatus().lifecycle).toBe('unopened');
    const reopened = await third.workspaceGraph.query(reader => reader.search('offlineSymbol'));
    expect(reopened.value[0]?.symbol.filePath).toBe('offline.ts');
    expect(reopened.freshness.epoch).not.toBe(initial.freshness.epoch);
    await third.close();
    expect((await readdir(root)).sort()).toEqual(['added.ts', 'entry.ts', 'offline.ts']);
    expect((await readdir(global)).length).toBe(1);
  }, 30_000);
});
