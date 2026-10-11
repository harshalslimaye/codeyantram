/* oxlint-disable vitest/require-mock-type-parameters -- These router tests use a deliberately partial session stub. */
import {once} from 'node:events';
import {createServer, type Server} from 'node:http';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {createApp} from '../../src/app.js';
import type {ChatGPTSessionService, streamChat} from '@codeyantram/core';

const servers: Server[] = [];
afterEach(async () => {await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => {
  server.closeAllConnections(); server.close(() => resolve());
})));});

function session() {
  return {
    status: vi.fn().mockResolvedValue({selectedId: 'issued-client', profiles: [{id: 'issued-client', sharing: true}]}),
    models: vi.fn().mockResolvedValue([{slug: 'gpt-6.1-sol', displayName: 'GPT 6.1 Sol'}]),
    selected: vi.fn().mockResolvedValue({clientId: 'issued-client'}),
    model: vi.fn().mockResolvedValue({slug: 'gpt-6.1-sol'}),
    accessToken: vi.fn().mockResolvedValue('test-access-token'),
    login: vi.fn().mockResolvedValue({selectedId: 'issued-client', profiles: []}),
    select: vi.fn().mockResolvedValue({selectedId: 'issued-client', profiles: []}),
    logout: vi.fn().mockResolvedValue({status: {profiles: []}, revoked: true}),
  };
}

async function listen(auth: ReturnType<typeof session>, withToken = true, stream?: typeof streamChat) {
  const app = createApp({readConfig: async () => ({providers: {}, openaiConnection: 'chatgpt'}),
    ...(withToken ? {privateSessionToken: 'private-test-session'} : {}),
    chatgptSession: auth as unknown as ChatGPTSessionService,
    ...(stream ? {streamChat: stream} : {})});
  const server = createServer(app);
  servers.push(server);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('No test port.');
  return `http://127.0.0.1:${address.port}`;
}

const headers = {'x-codeyantram-session': 'private-test-session', 'content-type': 'application/json'};

describe('private ChatGPT endpoints', () => {
  it('requires the CLI session secret and does not mount authentication routes on an unowned server', async () => {
    const auth = session();
    const url = await listen(auth);
    expect((await fetch(`${url}/chatgpt/status`)).status).toBe(403);
    expect((await fetch(`${url}/chatgpt/status`, {headers})).status).toBe(200);
    const publicUrl = await listen(auth, false);
    expect((await fetch(`${publicUrl}/chatgpt/status`)).status).toBe(404);
    expect(auth.status).toHaveBeenCalledOnce();
  });

  it('uses the selected account catalog before a ChatGPT model reaches the agent loop', async () => {
    const auth = session();
    const stream = vi.fn<typeof streamChat>().mockImplementation(async function* () {
      yield {type: 'start', messageId: 'a1'};
      yield {type: 'done', durationMs: 1};
    });
    const url = await listen(auth, true, stream);
    const response = await fetch(`${url}/chat`, {method: 'POST', headers,
      body: JSON.stringify({model: 'gpt-6.1-sol', messages: [{id: 'u1', role: 'user', parts: [{type: 'text', text: 'Hello'}]}]})});
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('"type":"done"');
    expect(auth.model).toHaveBeenCalledWith('gpt-6.1-sol', expect.any(AbortSignal));
    expect(stream).toHaveBeenCalledOnce();
    expect(stream.mock.calls[0]?.[1]?.chatgpt?.profileId).toBe('issued-client');
    expect(await stream.mock.calls[0]?.[1]?.chatgpt?.getAccessToken('issued-client')).toBe('test-access-token');
  });

  it('exposes only account models returned by the selected account', async () => {
    const auth = session();
    const url = await listen(auth);
    const response = await fetch(`${url}/chatgpt/models`, {headers});
    expect(await response.json()).toEqual({models: [{slug: 'gpt-6.1-sol', displayName: 'GPT 6.1 Sol'}]});
    expect(auth.models).toHaveBeenCalledOnce();
  });
});
