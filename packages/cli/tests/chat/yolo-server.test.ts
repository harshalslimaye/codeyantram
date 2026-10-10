import {mkdtemp, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach, describe, expect, it, vi} from 'vitest';
import type {streamChat} from '@codeyantram/core';
import type {ChatRequest, ChatStreamEvent} from '@codeyantram/shared';
import {requireValue} from '../../../shared/tests/helpers.js';
import {startChatServer} from '../../src/chat/server.js';
import {requestChat} from '../../src/chat/client.js';

const servers: Awaited<ReturnType<typeof startChatServer>>[] = [];
const directories: string[] = [];
const input: ChatRequest = {model: 'gpt-6.1-sol', agentId: 'yolo',
  messages: [{id: 'u1', role: 'user', parts: [{type: 'text', text: 'Add and check a file.'}]}]};

afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => server.close()));
  await Promise.all(directories.splice(0).map(directory => rm(directory, {recursive: true, force: true})));
});

async function setup(stream: typeof streamChat, automaticCapabilities = {patch: true, command: true}) {
  const directory = await mkdtemp(join(tmpdir(), 'codeyantram-yolo-'));
  directories.push(directory);
  const server = await startChatServer({workspaceRoot: directory, streamChat: stream, automaticCapabilities,
    readConfig: async () => ({providers: {openai: {apiKey: 'test-key'}}})});
  servers.push(server);
  return {server, directory};
}

async function collect(stream: AsyncIterable<ChatStreamEvent>) {
  const events: ChatStreamEvent[] = [];
  for await (const event of stream) events.push(event);
  return events;
}

describe('private Yolo activation', () => {
  it('rejects a forged Yolo request before activation and after switching away', async () => {
    const stream = vi.fn<typeof streamChat>().mockImplementation(async function* () {yield {type: 'done', durationMs: 1};});
    const {server} = await setup(stream);
    const post = () => server.fetchResponse(server.chatUrl, {method: 'POST',
      headers: {'content-type': 'application/json'}, body: JSON.stringify(input)});
    expect((await post()).status).toBe(400);
    server.agentSession.activateYolo();
    expect((await post()).status).toBe(200);
    server.agentSession.select('ask');
    expect((await post()).status).toBe(400);
    expect(stream).toHaveBeenCalledOnce();
  });

  it('runs an approved Yolo turn without prompts and keeps its original authorization after switching away', async () => {
    let release!: () => void;
    const gate = new Promise<void>(resolve => {release = resolve;});
    const stream = vi.fn<typeof streamChat>().mockImplementation(async function* (_request, options) {
      yield {type: 'start', messageId: 'a1'};
      await gate;
      expect(options.agent?.tools).toContain('apply_patch');
      expect(options.agent?.tools).toContain('bash');
      await requireValue(options.applyPatch).apply({patchText: '*** Begin Patch\n*** Add File: hello.txt\n+hello\n*** End Patch', expectedHashes: {}},
        {abortSignal: options.abortSignal});
      const result = await requireValue(options.bash).run({command: 'cat hello.txt'}, {abortSignal: options.abortSignal});
      expect(result.stdout).toBe('hello\n');
      yield {type: 'done', durationMs: 1};
    });
    const {server, directory} = await setup(stream);
    server.agentSession.activateYolo();
    const result = collect(requestChat(server.chatUrl, input, new AbortController().signal, server.fetchResponse));
    await vi.waitFor(() => expect(stream).toHaveBeenCalledOnce());
    server.agentSession.select('ask');
    release();
    expect((await result).at(-1)?.type).toBe('done');
    expect(server.approvals.getSnapshot()).toBeUndefined();
    expect(await readFile(join(directory, 'hello.txt'), 'utf8')).toBe('hello\n');
  });

  it('omits disabled automatic capabilities and reports them in metadata', async () => {
    const stream = vi.fn<typeof streamChat>().mockImplementation(async function* (_request, options) {
      expect(options.applyPatch).toBeDefined();
      expect(options.bash).toBeUndefined();
      expect(options.agent?.tools).toContain('apply_patch');
      expect(options.agent?.tools).not.toContain('bash');
      yield {type: 'done', durationMs: 1};
    });
    const {server} = await setup(stream, {patch: true, command: false});
    server.agentSession.activateYolo();
    const metadata = await server.fetchResponse(new URL('/agents', server.baseUrl));
    const agents = await metadata.json() as Array<{id: string; tools: string[]; available: boolean}>;
    const yolo = requireValue(agents.find(agent => agent.id === 'yolo'));
    expect(yolo).toMatchObject({available: true});
    expect(yolo.tools).toContain('apply_patch');
    expect(yolo.tools).not.toContain('bash');
    expect((await collect(requestChat(server.chatUrl, input, new AbortController().signal, server.fetchResponse))).at(-1)?.type).toBe('done');
  });
});
