import {describe, expect, it, vi} from 'vitest';
import {compactChat, streamChat, type NavigationGraphService} from '../../src/index.js';
import {sseResponse, openaiEvents, openaiToolEvents} from './fixtures.js';
import {requestBody, requestUrl, parseJson} from '../../../shared/tests/helpers.js';

const request = {model: 'gpt-6.1-sol', messages: [{id: 'u1', role: 'user' as const,
  parts: [{type: 'text' as const, text: 'Find greet'}]}]};
const chatgpt = {profileId: 'issued-client', getAccessToken: vi.fn<(id: string, signal?: AbortSignal) => Promise<string>>().mockResolvedValue('oauth-access-token')};

async function collect(stream: ReturnType<typeof streamChat>) {
  const events = [];
  for await (const event of stream) events.push(event);
  return events;
}

describe('ChatGPT plan provider in CodeYantram', () => {
  it('streams through the public Responses API with the authorized token and supported request shape', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(sseResponse(openaiEvents));
    const events = await collect(streamChat(request, {credentials: {}, chatgpt, fetch}));
    expect(events.map(event => event.type)).toEqual(['start', 'text-delta', 'text-delta', 'done']);
    expect(fetch).toHaveBeenCalledOnce();
    expect(requestUrl(fetch.mock.calls[0]?.[0])).toBe('https://api.openai.com/v1/responses');
    expect(new Headers(fetch.mock.calls[0]?.[1]?.headers).get('Authorization')).toBe('Bearer oauth-access-token');
    const body = parseJson<Record<string, unknown>>(requestBody(fetch.mock.calls[0]?.[1]?.body));
    expect(body).toMatchObject({model: 'gpt-6.1-sol', store: false, stream: true});
    expect(body).not.toHaveProperty('max_output_tokens');
    expect(body).not.toHaveProperty('temperature');
    expect(body).not.toHaveProperty('previous_response_id');
    expect(body).not.toHaveProperty('tools');
    expect(body.instructions).toEqual(expect.stringContaining('MODE: ASK'));
  });

  it('delivers a text delta before the model sends its completion event', async () => {
    let source!: ReadableStreamDefaultController<Uint8Array>;
    const body = new ReadableStream<Uint8Array>({start(controller) {source = controller;}});
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response(body, {headers: {'content-type': 'text/event-stream'}}));
    const iterator = streamChat(request, {credentials: {}, chatgpt, fetch})[Symbol.asyncIterator]();
    expect((await iterator.next()).value).toMatchObject({type: 'start'});
    source.enqueue(new TextEncoder().encode('data: {"type":"response.output_text.delta","delta":"live"}\n\n'));
    expect((await iterator.next()).value).toMatchObject({type: 'text-delta', text: 'live'});
    source.enqueue(new TextEncoder().encode('data: {"type":"response.completed","response":{"usage":{"input_tokens":1,"output_tokens":1}}}\n\n'));
    source.close();
    expect((await iterator.next()).value).toMatchObject({type: 'done'});
  });

  it('executes a CodeYantram tool and submits its result in the next Responses request', async () => {
    const workspaceGraph = {query: vi.fn<NavigationGraphService['query']>().mockResolvedValue({value: {symbols: ['greet'], coverage: 'indexed scope'},
      freshness: {epoch: 'e', revision: 1, reconciledAt: 1}}),
    getStatus: vi.fn<NavigationGraphService['getStatus']>().mockReturnValue({lifecycle: 'unopened', graph: null})} as unknown as NavigationGraphService;
    const toolEvents: unknown[] = openaiToolEvents('explore', {query: 'greet'});
    toolEvents.splice(1, 0, {type: 'response.output_item.done', output_index: 0,
      item: {type: 'reasoning', id: 'reasoning-1', encrypted_content: 'opaque-reasoning', summary: []}});
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValueOnce(sseResponse(toolEvents))
      .mockResolvedValueOnce(sseResponse(openaiEvents));
    const events = await collect(streamChat(request, {credentials: {}, chatgpt, fetch, workspaceGraph}));
    expect(events.map(event => event.type)).toEqual(['start', 'tool-call', 'tool-result', 'text-delta', 'text-delta', 'done']);
    expect(workspaceGraph.query).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenCalledTimes(2);
    const first = parseJson<{input: unknown[]}>(requestBody(fetch.mock.calls[0]?.[1]?.body));
    expect(first.input[0]).toMatchObject({type: 'additional_tools', role: 'developer'});
    const second = parseJson<{input: unknown[]}>(requestBody(fetch.mock.calls[1]?.[1]?.body));
    expect(second.input).toEqual(expect.arrayContaining([
      expect.objectContaining({type: 'reasoning', id: 'reasoning-1', encrypted_content: 'opaque-reasoning'}),
      expect.objectContaining({type: 'function_call', call_id: 'call-1', name: 'explore'}),
      expect.objectContaining({type: 'function_call_output', call_id: 'call-1'}),
    ]));
  });

  it('fails an interrupted or rejected stream without a success event', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(sseResponse([
      {type: 'response.output_text.delta', delta: 'partial'},
      {type: 'response.failed', response: {error: {code: 'subscription_sharing_usage_limit_exceeded'}}},
    ]));
    const events = await collect(streamChat(request, {credentials: {}, chatgpt, fetch}));
    expect(events.map(event => event.type)).toEqual(['start', 'text-delta', 'error']);
    expect(events.at(-1)).toMatchObject({code: 'rate_limited'});
  });

  it('compacts context through the same streaming endpoint without unsupported output limits', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(sseResponse([
      {type: 'response.output_text.delta', delta: 'Keep the existing API.'},
      {type: 'response.completed', response: {usage: {input_tokens: 20, output_tokens: 5}}},
    ]));
    const events = [];
    for await (const event of compactChat({model: request.model, messages: [{id: 'u1', role: 'user',
      parts: [{type: 'text', text: 'Keep the API'}]}]}, {credentials: {}, chatgpt, fetch})) events.push(event);
    expect(events.at(-1)).toMatchObject({type: 'done', summary: 'Keep the existing API.'});
    const body = parseJson<Record<string, unknown>>(requestBody(fetch.mock.calls[0]?.[1]?.body));
    expect(body).toMatchObject({store: false, stream: true});
    expect(body).not.toHaveProperty('max_output_tokens');
  });
});
