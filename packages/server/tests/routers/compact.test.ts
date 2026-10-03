import {once} from 'node:events';
import {createServer, type Server} from 'node:http';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {compactChat as coreCompactChat, type compactChat} from '@codeyantram/core';
import {compactStreamEventSchema, type CompactRequest, type CompactStreamEvent} from '@codeyantram/shared';
import {createApp, type ServerAppOptions} from '@codeyantram/server';

const servers: Server[] = [];
const config = {providers: {openai: {apiKey: ' test-openai-key '}}};
const request: CompactRequest = {
  model: 'gpt-6.1-sol', previousSummary: 'Earlier decisions.',
  messages: [
    {id: 'u1', role: 'user', parts: [{type: 'text', text: 'Update /src/chat.ts.'}]},
    {id: 'a1', role: 'assistant', status: 'cancelled', parts: [{type: 'text', text: 'Partial work'}]},
  ],
};
const start: CompactStreamEvent = {type: 'start'};
const done: CompactStreamEvent = {type: 'done', summary: 'Objective: update /src/chat.ts.\nChecks pending.', durationMs: 20, usage: {inputTokens: 10, outputTokens: 3}};

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(res => {resolve = res;});
  return {promise, resolve};
}

function eventStream(...events: CompactStreamEvent[]) {
  return vi.fn<typeof compactChat>().mockImplementation(async function* () {yield* events;});
}

async function listen(options: ServerAppOptions = {}): Promise<string> {
  const server = createServer(createApp({readConfig: async () => config, ...options}));
  servers.push(server);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected a TCP server');
  return `http://127.0.0.1:${address.port}/compact`;
}

function post(url: string, body: unknown = request) {
  return fetch(url, {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify(body)});
}

function parseEvents(text: string): CompactStreamEvent[] {
  return text.split('\n\n').filter(frame => frame.startsWith('data: '))
    .map(frame => compactStreamEventSchema.parse(JSON.parse(frame.slice(6))));
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => {
    server.closeAllConnections();
    server.close(() => resolve());
  })));
  vi.useRealTimers();
});

describe('POST /compact', () => {
  it('forwards the prefix, previous summary, selected credentials, and terminal result through SSE', async () => {
    const stream = eventStream(start, done, {type: 'error', code: 'provider_error', message: 'Ignore after done'});
    const response = await post(await listen({compactChat: stream}));
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/event-stream; charset=utf-8');
    expect(response.headers.get('cache-control')).toBe('no-cache, no-transform');
    expect(response.headers.get('x-accel-buffering')).toBe('no');
    const text = await response.text();
    expect(parseEvents(text)).toEqual([start, done]);
    expect(text).not.toContain('test-openai-key');
    expect(stream).toHaveBeenCalledWith(request, {
      credentials: {openai: 'test-openai-key'}, abortSignal: expect.any(AbortSignal),
    });
    expect(stream.mock.calls[0]![1].abortSignal?.aborted).toBe(true);
  });

  it.each([
    ['gpt-6.1-sol', 'openai'], ['claude-sonnet-5-5', 'anthropic'], ['gemini-3.8-flash', 'google'],
  ])('loads only the selected provider credential for %s', async (model, provider) => {
    const stream = eventStream(start, done);
    const response = await post(await listen({
      readConfig: async () => ({providers: {
        openai: {apiKey: 'openai-key'}, anthropic: {apiKey: 'anthropic-key'}, google: {apiKey: 'google-key'},
      }}), compactChat: stream,
    }), {...request, model});
    expect(parseEvents(await response.text())).toEqual([start, done]);
    expect(stream.mock.calls[0]![1].credentials).toEqual({[provider]: `${provider}-key`});
  });

  it.each([
    {...request, model: 'unsupported'}, {...request, messages: []}, {...request, previousSummary: ' '},
    {...request, previousSummary: 'x'.repeat(12_001)},
    {...request, messages: [{...request.messages[0], status: 'failed'}]},
    {...request, messages: [{...request.messages[1], status: 'streaming'}]},
  ])('rejects invalid input before reading credentials or starting SSE (case %#)', async body => {
    const readConfig = vi.fn(async () => config);
    const stream = eventStream(start, done);
    const response = await post(await listen({readConfig, compactChat: stream}), body);
    expect(response.status).toBe(400);
    expect(response.headers.get('content-type')).toContain('application/json');
    expect(await response.json()).toMatchObject({type: 'error', code: 'invalid_request'});
    expect(readConfig).not.toHaveBeenCalled();
    expect(stream).not.toHaveBeenCalled();
  });

  it.each([
    ['application/json', '{broken JSON'], ['text/plain', JSON.stringify(request)],
  ])('rejects malformed or non-JSON bodies before generation (%s)', async (contentType, body) => {
    const readConfig = vi.fn(async () => config);
    const stream = eventStream(start, done);
    const response = await fetch(await listen({readConfig, compactChat: stream}), {
      method: 'POST', headers: {'content-type': contentType}, body,
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({code: 'invalid_request'});
    expect(readConfig).not.toHaveBeenCalled();
    expect(stream).not.toHaveBeenCalled();
  });

  it('enforces the shared 4 MB body limit before reading credentials', async () => {
    const readConfig = vi.fn(async () => config);
    const stream = eventStream(start, done);
    const response = await post(await listen({readConfig, compactChat: stream}), {
      ...request, messages: [{id: 'u1', role: 'user', parts: [{type: 'text', text: 'x'.repeat(4 * 1024 * 1024)}]}],
    });
    expect(response.status).toBe(413);
    expect(await response.json()).toMatchObject({code: 'invalid_request'});
    expect(readConfig).not.toHaveBeenCalled();
    expect(stream).not.toHaveBeenCalled();
  });

  it('streams the real core missing-credentials error without calling a provider', async () => {
    const response = await post(await listen({readConfig: async () => ({})}));
    expect(response.status).toBe(200);
    const events = parseEvents(await response.text());
    expect(events.map(event => event.type)).toEqual(['start', 'error']);
    expect(events.at(-1)).toMatchObject({code: 'missing_credentials'});
  });

  it('passes a real core summary and usage through the actual provider adapter', async () => {
    const providerFetch = vi.fn<typeof fetch>().mockResolvedValue(Response.json({
      id: 'summary-1', model: request.model, created_at: 1,
      output: [{type: 'message', role: 'assistant', id: 'a1', content: [{type: 'output_text', text: 'Working summary', annotations: []}]}],
      usage: {input_tokens: 10, output_tokens: 3, total_tokens: 13},
    }));
    const response = await post(await listen({
      compactChat: (input, options) => coreCompactChat(input, {...options, fetch: providerFetch}),
    }));
    const events = parseEvents(await response.text());
    expect(events.map(event => event.type)).toEqual(['start', 'done']);
    expect(events.at(-1)).toMatchObject({summary: 'Working summary', usage: {inputTokens: 10, outputTokens: 3, totalTokens: 13}});
    expect(new Headers(providerFetch.mock.calls[0]![1]?.headers).get('authorization')).toBe('Bearer test-openai-key');
  });

  it('reloads credentials on each compaction request', async () => {
    const readConfig = vi.fn().mockResolvedValueOnce(config)
      .mockResolvedValueOnce({providers: {openai: {apiKey: 'replacement-key'}}});
    const stream = eventStream(start, done);
    const url = await listen({readConfig, compactChat: stream});
    await (await post(url)).text();
    await (await post(url)).text();
    expect(stream.mock.calls[0]![1].credentials).toEqual({openai: 'test-openai-key'});
    expect(stream.mock.calls[1]![1].credentials).toEqual({openai: 'replacement-key'});
  });

  it('returns a sanitized JSON error if credential loading fails', async () => {
    const stream = eventStream(start, done);
    const response = await post(await listen({
      readConfig: async () => {throw new Error('private configuration test-openai-key');}, compactChat: stream,
    }));
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({type: 'error', code: 'internal_error', message: 'The compaction request could not be completed.'});
    expect(stream).not.toHaveBeenCalled();
  });

  it.each(['rate_limited', 'compaction_failed', 'provider_error'] as const)('forwards a core %s error and closes the iterator', async code => {
    const error: CompactStreamEvent = {type: 'error', code, message: 'Could not summarize.'};
    const cleanedUp = vi.fn();
    const stream = vi.fn<typeof compactChat>().mockImplementation(async function* () {
      try {yield start; yield error; yield done;} finally {cleanedUp();}
    });
    const response = await post(await listen({compactChat: stream}));
    expect(parseEvents(await response.text())).toEqual([start, error]);
    expect(cleanedUp).toHaveBeenCalledOnce();
  });

  it('sanitizes unexpected failures after SSE starts', async () => {
    const response = await post(await listen({compactChat: async function* () {
      yield start;
      throw new Error('private provider details test-openai-key');
    }}));
    expect(parseEvents(await response.text())).toEqual([
      start, {type: 'error', code: 'internal_error', message: 'The compaction request could not be completed.'},
    ]);
  });

  it('keeps the pending operation active, sends heartbeats, and clears its timer after completion', async () => {
    vi.useFakeTimers({toFake: ['setInterval', 'clearInterval']});
    const finish = deferred();
    const stream = vi.fn<typeof compactChat>().mockImplementation(async function* (_request, options) {
      yield start;
      await finish.promise;
      expect(options.abortSignal?.aborted).toBe(false);
      yield done;
    });
    try {
      const response = await post(await listen({compactChat: stream}));
      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let text = decoder.decode((await reader.read()).value);
      expect(parseEvents(text)).toEqual([start]);
      expect(stream.mock.calls[0]![1].abortSignal?.aborted).toBe(false);
      await vi.advanceTimersByTimeAsync(15_000);
      text += decoder.decode((await reader.read()).value);
      expect(text).toContain(': keep-alive\n\n');
      finish.resolve();
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        text += decoder.decode(chunk.value);
      }
      expect(parseEvents(text)).toEqual([start, done]);
      expect(vi.getTimerCount()).toBe(0);
    } finally {finish.resolve();}
  });

  it('aborts on disconnect, ignores a late result, and cleans up generation and heartbeat', async () => {
    vi.useFakeTimers({toFake: ['setInterval', 'clearInterval']});
    const aborted = deferred();
    const cleanedUp = deferred();
    const finish = deferred();
    const stream = vi.fn<typeof compactChat>().mockImplementation(async function* (_request, options) {
      try {
        yield start;
        if (options.abortSignal!.aborted) aborted.resolve();
        else options.abortSignal!.addEventListener('abort', aborted.resolve, {once: true});
        await finish.promise;
        yield done; // Simulate a provider ignoring cancellation.
      } finally {cleanedUp.resolve();}
    });
    try {
      const response = await post(await listen({compactChat: stream}));
      const reader = response.body!.getReader();
      expect((await reader.read()).done).toBe(false);
      await reader.cancel();
      await aborted.promise;
      // Disconnect stops the heartbeat even while a provider ignores abort.
      expect(vi.getTimerCount()).toBe(0);
      finish.resolve();
      await cleanedUp.promise;
      expect(stream.mock.calls[0]![1].abortSignal?.aborted).toBe(true);
    } finally {finish.resolve();}
  });
});
