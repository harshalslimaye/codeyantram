import {requireValue, requestBody, asymmetric, parseJson, type EvaluationRequest, type JsonValue} from '../../../shared/tests/helpers.js';
import {type readConfig as ReadConfigFunction,chatStreamEventSchema,type ChatRequest,type ChatStreamEvent} from '@codeyantram/shared';
import {once} from 'node:events';
import {createServer, type Server} from 'node:http';
import {brotliCompressSync, deflateSync, gzipSync} from 'node:zlib';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {streamChat as coreStreamChat, createJevEvaluator, type streamChat, type WebFetchOutput} from '@codeyantram/core';
import {createApp, type ServerAppOptions} from '@codeyantram/server';

const servers: Server[] = [];
const config = {providers: {openai: {apiKey: ' test-openai-key '}}};
const request: ChatRequest = {
  model: 'gpt-6.1-sol', effort: 'high',
  messages: [{id: 'user-1', role: 'user', parts: [{type: 'text', text: 'Hello'}]}],
};
const start: ChatStreamEvent = {type: 'start', messageId: 'assistant-1'};
const done: ChatStreamEvent = {type: 'done', durationMs: 20, usage: {inputTokens: 10, outputTokens: 3}};

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(res => {resolve = res;});
  return {promise, resolve};
}

function eventStream(...events: ChatStreamEvent[]) {
  return vi.fn<typeof streamChat>().mockImplementation(async function* () {
    yield* events;
  });
}

async function listen(options: ServerAppOptions = {}): Promise<string> {
  const server = createServer(createApp({readConfig: async () => config, ...options}));
  servers.push(server);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('Expected a TCP server');
  return `http://127.0.0.1:${address.port}/chat`;
}

function post(url: string, body: unknown = request) {
  return fetch(url, {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify(body)});
}

function parseEvents(text: string): ChatStreamEvent[] {
  return text.split('\n\n').filter(frame => frame.startsWith('data: '))
    .map(frame => chatStreamEventSchema.parse(parseJson<EvaluationRequest>(frame.slice(6))));
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => {
    server.closeAllConnections();
    server.close(() => resolve());
  })));
});

describe('POST /chat', () => {
  it.each(['disabled', 'key_only', 'enabled', 'missing_key', 'initialization_failed', 'evaluation_failed'] as const)
  ('resolves JEV %s from one configuration snapshot and returns bounded web content', async state => {
    const readConfig = vi.fn<typeof ReadConfigFunction>(async () => ({
      providers: {...config.providers, ...(state === 'missing_key' || state === 'disabled' ? {} : {typesafe: {apiKey: 'private-jev-key'}})},
      integrations: {jev: {enabled: !['disabled', 'key_only'].includes(state)}},
    }));
    const jevFetch = vi.fn<typeof globalThis.fetch>().mockImplementation(async (_url, init) => {
      if (state === 'evaluation_failed') throw new Error('private-jev-key');
      const body = parseJson<EvaluationRequest>(requestBody(init?.body));
      return Response.json({model: 'fixture', answers: Object.fromEntries(Object.keys(body.questions).map(id => [id, {type: 'noul', noul: 0.8}])), usage: {input_tokens: 20, output_tokens: 2}});
    });
    const factory = vi.fn<typeof createJevEvaluator>(options => {
      if (state === 'initialization_failed') throw new Error('private-jev-key');
      return createJevEvaluator({...options, fetch: jevFetch});
    });
    let result: WebFetchOutput | undefined;
    const stream = vi.fn<typeof streamChat>().mockImplementation(async function* (_request, options) {
      yield start;
      result = await requireValue(options.webFetch).fetch({url: 'https://example.com/docs'}, {objective: 'Read the API reference', abortSignal: options.abortSignal});
      yield {type: 'tool-call', call: {toolCallId: 'web-1', toolName: 'web_fetch', input: {url: 'https://example.com/docs'}}};
      yield {type: 'tool-result', result: {toolCallId: 'web-1', toolName: 'web_fetch', status: 'success', output: parseJson<JsonValue>(JSON.stringify(result))}};
      yield done;
    });
    const response = await post(await listen({readConfig, streamChat: stream, createJevEvaluator: factory, webTransport: {fetch: async url => ({
      requestedUrl: url, finalUrl: url, status: 200, contentType: 'text/markdown', text: '# API\n\n' + 'Evidence and prerequisites. '.repeat(500),
    })}}));
    const text = await response.text();
    expect(parseEvents(text).at(-1)?.type).toBe('done');
    expect(text).not.toContain('private-jev-key');
    expect(readConfig).toHaveBeenCalledOnce();
    expect(requireValue(result).content).toContain('Evidence and prerequisites.');
    expect(requireValue(result).filtering.status).toBe(state === 'enabled' ? 'completed' : state === 'evaluation_failed' ? 'failed' : 'skipped');
    if (['missing_key', 'initialization_failed', 'evaluation_failed'].includes(state)) expect(requireValue(result).warnings.length).toBeGreaterThan(0);
    expect(factory).toHaveBeenCalledTimes(['enabled', 'initialization_failed', 'evaluation_failed'].includes(state) ? 1 : 0);
    expect(jevFetch.mock.calls.length > 0).toBe(['enabled', 'evaluation_failed'].includes(state));
    expect(requireValue(stream.mock.calls[0])[1].credentials).toEqual({openai: 'test-openai-key'});
    expect(requireValue(stream.mock.calls[0])[1].workspaceGraph).toBeUndefined();
  });

  it.each(['fetch', 'evaluation'] as const)('cancels in-flight web %s when the client disconnects', async phase => {
    const entered = deferred();
    const cleaned = deferred();
    let workSignal: AbortSignal | undefined;
    const text = 'API evidence. '.repeat(1000);
    const webTransport = {fetch: async (url: string, _format: unknown, signal: AbortSignal) => {
      if (phase === 'fetch') {workSignal = signal; entered.resolve(); await new Promise(() => {});}
      return {requestedUrl: url, finalUrl: url, status: 200, contentType: 'text/plain', text};
    }};
    const factory: typeof createJevEvaluator = options => createJevEvaluator({...options, fetch: async (_url, init) => {
      workSignal = init?.signal ?? undefined; entered.resolve(); return new Promise(() => {});
    }});
    const stream = vi.fn<typeof streamChat>().mockImplementation(async function* (_request, options) {
      try {
        yield start;
        await requireValue(options.webFetch).fetch({url: 'https://example.com'}, {objective: 'API task', abortSignal: options.abortSignal});
        yield done;
      } finally {cleaned.resolve();}
    });
    const response = await post(await listen({streamChat: stream, webTransport, createJevEvaluator: factory,
      readConfig: async () => ({...config, providers: {...config.providers, typesafe: {apiKey: 'test-key'}}, integrations: {jev: {enabled: true}}}),
    }));
    const reader = requireValue(response.body).getReader(); await reader.read(); await entered.promise; await reader.cancel(); await cleaned.promise;
    expect(workSignal?.aborted).toBe(true);
  });

  it('forwards SSE events, history, effort, credentials, and usage', async () => {
    const stream = eventStream(start, {type: 'text-delta', text: 'Hello\nworld'}, done);
    const response = await post(await listen({streamChat: stream}));
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/event-stream; charset=utf-8');
    expect(response.headers.get('cache-control')).toBe('no-cache, no-transform');
    expect(response.headers.get('x-accel-buffering')).toBe('no');
    const text = await response.text();
    expect(parseEvents(text)).toEqual([start, {type: 'text-delta', text: 'Hello\nworld'}, done]);
    expect(text).not.toContain('test-openai-key');
    expect(stream).toHaveBeenCalledWith(request, {
      credentials: {openai: 'test-openai-key'}, abortSignal: asymmetric.any(AbortSignal),
      webFetch: {fetch: asymmetric.any(Function)},
    });
  });

  it.each([
    ['gpt-6.1-sol', 'openai'],
    ['claude-sonnet-5-5', 'anthropic'],
    ['gemini-3.8-flash', 'google'],
  ])('passes only the selected provider key to core for %s', async (model, provider) => {
    const stream = eventStream(start, done);
    const response = await post(await listen({
      readConfig: async () => ({providers: {
        openai: {apiKey: 'openai-key'},
        anthropic: {apiKey: 'anthropic-key'},
        google: {apiKey: 'google-key'},
      }}),
      streamChat: stream,
    }), {...request, model});
    expect(response.status).toBe(200);
    expect(parseEvents(await response.text())).toEqual([start, done]);
    expect(requireValue(stream.mock.calls[0])[1].credentials).toEqual({[provider]: `${provider}-key`});
  });

  it('delivers partial text before completion and keeps generation active after reading the POST body', async () => {
    const finish = deferred();
    const stream = vi.fn<typeof streamChat>().mockImplementation(async function* (_request, options) {
      yield start;
      yield {type: 'text-delta', text: 'First chunk'};
      await finish.promise;
      expect(options.abortSignal?.aborted).toBe(false);
      yield done;
    });
    try {
      const response = await post(await listen({streamChat: stream}));
      const reader = requireValue(response.body).getReader();
      const decoder = new TextDecoder();
      let text = '';
      while (!text.includes('First chunk')) {
        const chunk = await reader.read();
        expect(chunk.done).toBe(false);
        text += decoder.decode(chunk.value, {stream: true});
      }
      expect(parseEvents(text)).toEqual([start, {type: 'text-delta', text: 'First chunk'}]);
      expect(requireValue(stream.mock.calls[0])[1].abortSignal?.aborted).toBe(false);
      finish.resolve();
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        text += decoder.decode(chunk.value, {stream: true});
      }
      expect(parseEvents(text).at(-1)).toEqual(done);
    } finally {
      finish.resolve();
    }
  });

  it.each([
    {...request, model: 'unsupported'},
    {...request, effort: 'none'},
    {...request, messages: []},
  ])('rejects invalid chat input before reading keys or starting generation', async body => {
    const readConfig = vi.fn<typeof ReadConfigFunction>(async () => config);
    const stream = eventStream(start, done);
    const response = await post(await listen({readConfig, streamChat: stream}), body);
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({type: 'error', code: 'invalid_request'});
    expect(readConfig).not.toHaveBeenCalled();
    expect(stream).not.toHaveBeenCalled();
  });

  it('returns a JSON validation error for malformed JSON', async () => {
    const stream = eventStream(start, done);
    const response = await fetch(await listen({streamChat: stream}), {
      method: 'POST', headers: {'content-type': 'application/json'}, body: '{invalid-json',
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({type: 'error', code: 'invalid_request', message: 'The request body must be valid JSON.'});
    expect(stream).not.toHaveBeenCalled();
  });

  it.each([
    {
      headers: {'content-type': 'application/json; charset=iso-8859-1', 'content-encoding': 'identity'},
      body: '{}', status: 415, message: 'The request body charset is not supported.',
    },
    {
      headers: {'content-type': 'application/json', 'content-encoding': 'unsupported'},
      body: '{}', status: 415, message: 'The request body encoding is not supported.',
    },
    ...['gzip', 'deflate', 'br'].map(encoding => ({
      headers: {'content-type': 'application/json', 'content-encoding': encoding},
      body: 'invalid compressed body', status: 400, message: 'The request body is invalid.',
    })),
  ])('rejects invalid body encoding with $status: $headers', async ({headers, body, status, message}) => {
    const readConfig = vi.fn<typeof ReadConfigFunction>(async () => config);
    const stream = eventStream(start, done);
    const response = await fetch(await listen({readConfig, streamChat: stream}), {
      method: 'POST', headers, body,
    });
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({type: 'error', code: 'invalid_request', message});
    expect(readConfig).not.toHaveBeenCalled();
    expect(stream).not.toHaveBeenCalled();
  });

  it.each([
    ['gzip', gzipSync],
    ['deflate', deflateSync],
    ['br', brotliCompressSync],
  ] as const)('accepts a valid %s-compressed JSON request', async (encoding, compress) => {
    const stream = eventStream(start, done);
    const response = await fetch(await listen({streamChat: stream}), {
      method: 'POST',
      headers: {'content-type': 'application/json', 'content-encoding': encoding},
      body: new Uint8Array(compress(JSON.stringify(request))),
    });
    expect(response.status).toBe(200);
    expect(parseEvents(await response.text())).toEqual([start, done]);
    expect(requireValue(stream.mock.calls[0])[0]).toEqual(request);
  });

  it('rejects non-JSON input', async () => {
    const stream = eventStream(start, done);
    const response = await fetch(await listen({streamChat: stream}), {
      method: 'POST', headers: {'content-type': 'text/plain'}, body: JSON.stringify(request),
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({code: 'invalid_request'});
    expect(stream).not.toHaveBeenCalled();
  });

  it('rejects an oversized request before reading credentials', async () => {
    const readConfig = vi.fn<typeof ReadConfigFunction>(async () => config);
    const response = await post(await listen({readConfig}), {
      ...request,
      messages: [{id: 'user-1', role: 'user', parts: [{type: 'text', text: 'x'.repeat(4 * 1024 * 1024)}]}],
    });
    expect(response.status).toBe(413);
    expect(await response.json()).toMatchObject({code: 'invalid_request'});
    expect(readConfig).not.toHaveBeenCalled();
  });

  it('streams the real core missing-credentials error without a provider call', async () => {
    const response = await post(await listen({readConfig: async () => ({})}));
    expect(response.status).toBe(200);
    const events = parseEvents(await response.text());
    expect(events.map(event => event.type)).toEqual(['start', 'error']);
    expect(events.at(-1)).toMatchObject({code: 'missing_credentials'});
  });

  it('streams a successful response through core and the provider SDK', async () => {
    const providerEvents = [
      {type: 'response.created', response: {id: 'response-1', created_at: 1, model: request.model}},
      {type: 'response.output_item.added', output_index: 0, item: {type: 'message', id: 'message-1'}},
      {type: 'response.output_text.delta', item_id: 'message-1', output_index: 0, delta: 'Hello back'},
      {type: 'response.completed', response: {usage: {input_tokens: 10, output_tokens: 3, total_tokens: 13}}},
    ];
    const providerFetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response(
      providerEvents.map(event => `data: ${JSON.stringify(event)}\n\n`).join(''),
      {headers: {'content-type': 'text/event-stream'}},
    ));
    const response = await post(await listen({
      streamChat: (input, options) => coreStreamChat(input, {...options, fetch: providerFetch}),
    }));
    const events = parseEvents(await response.text());
    expect(events.map(event => event.type)).toEqual(['start', 'text-delta', 'done']);
    expect(events[1]).toEqual({type: 'text-delta', text: 'Hello back'});
    expect(events.at(-1)).toMatchObject({usage: {inputTokens: 10, outputTokens: 3, totalTokens: 13}});
    expect(providerFetch).toHaveBeenCalledOnce();
    expect(new Headers(requireValue(providerFetch.mock.calls[0])[1]?.headers).get('authorization'))
      .toBe('Bearer test-openai-key');
  });

  it('reloads keys on each turn so CLI configuration changes take effect', async () => {
    const readConfig = vi.fn<typeof ReadConfigFunction>().mockResolvedValueOnce(config)
      .mockResolvedValueOnce({providers: {openai: {apiKey: 'replacement-key'}}});
    const stream = eventStream(start, done);
    const url = await listen({readConfig, streamChat: stream});
    await (await post(url)).text();
    await (await post(url)).text();
    expect(requireValue(stream.mock.calls[0])[1].credentials).toEqual({openai: 'test-openai-key'});
    expect(requireValue(stream.mock.calls[1])[1].credentials).toEqual({openai: 'replacement-key'});
  });

  it('returns a sanitized HTTP error when configuration cannot be loaded', async () => {
    const stream = eventStream(start, done);
    const response = await post(await listen({
      readConfig: async () => {throw new Error('secret configuration details');}, streamChat: stream,
    }));
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({type: 'error', code: 'internal_error', message: 'The chat request could not be completed.'});
    expect(stream).not.toHaveBeenCalled();
  });

  it('forwards core errors and closes after the terminal event', async () => {
    const error: ChatStreamEvent = {type: 'error', code: 'rate_limited', message: 'Try again later.'};
    const stream = eventStream(start, error, {type: 'text-delta', text: 'Should not be sent'});
    const response = await post(await listen({streamChat: stream}));
    expect(parseEvents(await response.text())).toEqual([start, error]);
  });

  it('reports unexpected stream failures as a sanitized SSE error', async () => {
    const stream = vi.fn<typeof streamChat>().mockImplementation(async function* () {
      yield start;
      throw new Error('secret provider details');
    });
    const response = await post(await listen({streamChat: stream}));
    expect(parseEvents(await response.text())).toEqual([
      start, {type: 'error', code: 'internal_error', message: 'The chat request could not be completed.'},
    ]);
  });

  it('cancels generation and cleans up its iterator when the client disconnects', async () => {
    const aborted = deferred();
    const cleanedUp = deferred();
    const stream = vi.fn<typeof streamChat>().mockImplementation(async function* (_request, options) {
      try {
        yield start;
        await new Promise<void>(resolve => {
          const stop = () => {aborted.resolve(); resolve();};
          if (requireValue(options.abortSignal).aborted) stop();
          else requireValue(options.abortSignal).addEventListener('abort', stop, {once: true});
        });
      } finally {
        cleanedUp.resolve();
      }
    });
    const response = await post(await listen({streamChat: stream}));
    const reader = requireValue(response.body).getReader();
    expect((await reader.read()).done).toBe(false);
    await reader.cancel();
    await aborted.promise;
    await cleanedUp.promise;
    expect(requireValue(stream.mock.calls[0])[1].abortSignal?.aborted).toBe(true);
  });
});
