import {mkdtemp, readFile, readdir, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach, describe, expect, it, vi} from 'vitest';
import type {streamChat} from '@codeyantram/core';
import type {ChatRequest, ChatStreamEvent} from '@codeyantram/shared';
import {requireValue} from '../../../shared/tests/helpers.js';
import {startChatServer} from '../../src/chat/server.js';
import {requestChat} from '../../src/chat/client.js';

const requests: Awaited<ReturnType<typeof startChatServer>>[] = [];
const directories: string[] = [];
const input: ChatRequest = {model: 'gpt-6.1-sol', agentId: 'build',
  messages: [{id: 'u1', role: 'user', parts: [{type: 'text', text: 'Add and check a file.'}]}]};

afterEach(async () => {
  await Promise.all(requests.splice(0).map(server => server.close()));
  await Promise.all(directories.splice(0).map(directory => rm(directory, {recursive: true, force: true})));
});

async function setup(stream: typeof streamChat) {
  const directory = await mkdtemp(join(tmpdir(), 'codeyantram-approval-'));
  directories.push(directory);
  const server = await startChatServer({workspaceRoot: directory, streamChat: stream,
    readConfig: async () => ({providers: {openai: {apiKey: 'test-key'}}})});
  server.agentSession.select('build');
  requests.push(server);
  return {server, directory};
}

async function collect(stream: AsyncIterable<ChatStreamEvent>) {
  const events: ChatStreamEvent[] = [];
  for await (const event of stream) events.push(event);
  return events;
}

describe('private Build approval path', () => {
  it('reviews the exact patch and command before completing a turn', async () => {
    const stream = vi.fn<typeof streamChat>().mockImplementation(async function* (_request, options) {
      yield {type: 'start', messageId: 'a1'};
      const patch = await requireValue(options.applyPatch).apply({patchText: '*** Begin Patch\n*** Add File: hello.txt\n+hello\n*** End Patch', expectedHashes: {}},
        {objective: 'Add and check a file.', abortSignal: options.abortSignal});
      expect(patch.applied).toHaveLength(1);
      const command = await requireValue(options.bash).run({command: 'cat hello.txt'},
        {objective: 'Check the file.', abortSignal: options.abortSignal});
      expect(command.stdout).toBe('hello\n');
      yield {type: 'done', durationMs: 1};
    });
    const {server, directory} = await setup(stream);
    const result = collect(requestChat(server.chatUrl, input, new AbortController().signal, server.fetchResponse));
    await vi.waitFor(() => expect(server.approvals.getSnapshot()?.kind).toBe('patch'));
    const patch = requireValue(server.approvals.getSnapshot());
    expect(patch.kind).toBe('patch');
    if (patch.kind !== 'patch') throw new Error('Expected patch approval.');
    expect(patch.request.patchText).toContain('*** Add File: hello.txt');
    expect(patch.request.changes[0]?.afterHash).toMatch(/^[a-f0-9]{64}$/);
    server.approvals.decide(patch.id, true);
    await vi.waitFor(() => expect(server.approvals.getSnapshot()?.kind).toBe('command'));
    const command = requireValue(server.approvals.getSnapshot());
    if (command.kind !== 'command') throw new Error('Expected command approval.');
    expect(command.request).toMatchObject({command: 'cat hello.txt', objective: 'Check the file.'});
    server.approvals.decide(command.id, true);
    expect((await result).at(-1)?.type).toBe('done');
    expect(await readFile(join(directory, 'hello.txt'), 'utf8')).toBe('hello\n');
  });

  it('denies a patch and leaves files unchanged', async () => {
    const stream = vi.fn<typeof streamChat>().mockImplementation(async function* (_request, options) {
      yield {type: 'start', messageId: 'a1'};
      await expect(requireValue(options.applyPatch).apply({patchText: '*** Begin Patch\n*** Add File: hello.txt\n+hello\n*** End Patch', expectedHashes: {}},
        {abortSignal: options.abortSignal})).rejects.toMatchObject({code: 'permission_denied'});
      yield {type: 'done', durationMs: 1};
    });
    const {server, directory} = await setup(stream);
    const result = collect(requestChat(server.chatUrl, input, new AbortController().signal, server.fetchResponse));
    await vi.waitFor(() => expect(server.approvals.getSnapshot()?.kind).toBe('patch'));
    server.approvals.decide(requireValue(server.approvals.getSnapshot()).id, false);
    expect((await result).at(-1)?.type).toBe('done');
    expect(await readdir(directory)).toEqual([]);
  });

  it('clears a pending approval when the client cancels or the server closes', async () => {
    const stream = vi.fn<typeof streamChat>().mockImplementation(async function* (_request, options) {
      yield {type: 'start', messageId: 'a1'};
      await requireValue(options.applyPatch).apply({patchText: '*** Begin Patch\n*** Add File: hello.txt\n+hello\n*** End Patch', expectedHashes: {}},
        {abortSignal: options.abortSignal});
      yield {type: 'done', durationMs: 1};
    });
    const {server, directory} = await setup(stream);
    const controller = new AbortController();
    const result = collect(requestChat(server.chatUrl, input, controller.signal, server.fetchResponse)).catch(() => []);
    await vi.waitFor(() => expect(server.approvals.getSnapshot()?.kind).toBe('patch'));
    controller.abort();
    await result;
    await vi.waitFor(() => expect(server.approvals.getSnapshot()).toBeUndefined());
    expect(await readdir(directory)).toEqual([]);

    const another = collect(requestChat(server.chatUrl, input, new AbortController().signal, server.fetchResponse)).catch(() => []);
    await vi.waitFor(() => expect(server.approvals.getSnapshot()?.kind).toBe('patch'));
    requests.splice(requests.indexOf(server), 1);
    await server.close();
    await another;
    expect(server.approvals.getSnapshot()).toBeUndefined();
    expect(await readdir(directory)).toEqual([]);
  });
});
