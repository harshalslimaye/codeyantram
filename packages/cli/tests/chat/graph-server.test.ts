import {mkdtemp, mkdir, readdir, rm, stat, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {getUserGraphDirectory} from '@codeyantram/shared';
import {streamChat as coreStreamChat} from '@codeyantram/core';
import {sseResponse, openaiEvents, openaiToolEvents} from '../../../core/tests/chat/fixtures.js';
import {startChatServer} from '../../src/chat/server.js';
import {requestChat} from '../../src/chat/client.js';
import {ChatSession} from '../../src/chat/session.js';

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
  it('executes navigation through provider, HTTP, and session history and reconciles manual edits before the next explore', async () => {
    directory = await mkdtemp(path.join(tmpdir(), 'codeyantram-tools-e2e-'));
    const root = path.join(directory, 'project');
    const global = path.join(directory, 'user-config', 'codeyantram', 'graphs');
    vi.mocked(getUserGraphDirectory).mockReturnValue(global);
    await mkdir(root);
    const sourcePath = path.join(root, 'entry.ts');
    await writeFile(sourcePath, 'export function greet() { return "initial source"; }\n');
    const providerFetch = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(sseResponse(openaiToolEvents('graph', {}, 'diagnostic-1')))
      .mockResolvedValueOnce(sseResponse(openaiEvents))
      .mockResolvedValueOnce(sseResponse(openaiToolEvents('explore', {query: 'greet'}, 'explore-1')))
      .mockResolvedValueOnce(sseResponse(openaiEvents))
      .mockResolvedValueOnce(sseResponse(openaiToolEvents('explore', {query: 'greet'}, 'explore-2')))
      .mockResolvedValueOnce(sseResponse(openaiEvents));
    const server = await startChatServer({workspaceRoot: root,
      readConfig: async () => ({providers: {openai: {apiKey: 'test-openai'}}}),
      streamChat: (request, options) => coreStreamChat(request, {...options, fetch: providerFetch}),
    }); servers.push(server);
    const session = new ChatSession((request, signal) => requestChat(server.chatUrl, request, signal));
    await session.send('Check graph status', 'gpt-6.1-sol');
    expect(session.getSnapshot().error).toBeUndefined();
    expect(server.workspaceGraph.getStatus().lifecycle).toBe('unopened');
    await expect(stat(global)).rejects.toMatchObject({code: 'ENOENT'});
    expect(JSON.stringify(session.getSnapshot().messages[1].parts)).toContain('before-every-query');

    await session.send('Locate greet', 'gpt-6.1-sol');
    expect(session.getSnapshot().error).toBeUndefined();
    expect(server.workspaceGraph.getStatus()).toMatchObject({lifecycle: 'open', graph: {readiness: 'ready'}});
    const first = session.getSnapshot().messages[3];
    expect(first.parts.map(part => part.type)).toEqual(['tool-call', 'tool-result', 'text']);
    expect(JSON.stringify(first.parts)).toContain('initial source');
    const continuation = String(providerFetch.mock.calls[3][1]?.body);
    expect(continuation).toContain('function_call_output');
    expect(continuation).toContain('initial source');
    expect(continuation).toMatch(/[a-f0-9]{64}/);

    await writeFile(sourcePath, 'export function greet() { return "manually updated source"; }\n');
    await session.send('Check greet again', 'gpt-6.1-sol');
    expect(session.getSnapshot().error).toBeUndefined();
    expect(JSON.stringify(session.getSnapshot().messages[5].parts)).toContain('manually updated source');
    const replay = String(providerFetch.mock.calls[4][1]?.body);
    expect(replay).toContain('explore-1');
    expect(replay).toContain('initial source');
    const updated = String(providerFetch.mock.calls[5][1]?.body);
    expect(updated).toContain('explore-2');
    expect(updated).toContain('manually updated source');
    expect(providerFetch).toHaveBeenCalledTimes(6);
    expect(await readdir(root)).toEqual(['entry.ts']);
    expect(await readdir(global)).toHaveLength(1);
  }, 30_000);

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
