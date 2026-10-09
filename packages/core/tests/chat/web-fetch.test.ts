import {describe, expect, it, vi} from 'vitest';
import {streamChat, createWebFetchService, type WebTransport} from '../../src/index.js';
import {chatStreamEventSchema, type ChatStreamEvent, type ChatMessage} from '@codeyantram/shared';
import {sseResponse, openaiEvents, openaiToolEvents, anthropicEvents, anthropicToolEvents, googleEvents} from './fixtures.js';

async function collect(stream: AsyncIterable<ChatStreamEvent>) {
  const events = []; for await (const event of stream) events.push(chatStreamEventSchema.parse(event)); return events;
}
const url = 'https://example.com/docs';
const messages: ChatMessage[] = [{id: 'u1', role: 'user', parts: [{type: 'text', text: 'Read the API documentation.'}]}];

describe('web fetch provider conversation loop', () => {
  it.each(['openai', 'anthropic', 'google'])('fetches without a graph, answers, and replays the result with %s', async provider => {
    const args = {url};
    const calls = provider === 'openai' ? openaiToolEvents('web_fetch', args) : provider === 'anthropic' ? anthropicToolEvents('web_fetch', args)
      : [{candidates: [{content: {role: 'model', parts: [{functionCall: {name: 'web_fetch', args}, thoughtSignature: 'web-signature'}]}, finishReason: 'STOP'}]}];
    const answer = provider === 'openai' ? openaiEvents : provider === 'anthropic' ? anthropicEvents : googleEvents;
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValueOnce(sseResponse(calls)).mockResolvedValueOnce(sseResponse(answer)).mockResolvedValueOnce(sseResponse(answer));
    const transport: WebTransport = {fetch: vi.fn().mockResolvedValue({requestedUrl: url, finalUrl: url, status: 200, contentType: 'text/html', text: '<h1>API Reference</h1><p>Call authenticate(token).</p>'})};
    const webFetch = createWebFetchService({transport});
    const request = {model: provider === 'openai' ? 'gpt-6.1-sol' : provider === 'anthropic' ? 'claude-sonnet-5-5' : 'gemini-3.8-flash', messages};
    const options = {credentials: {openai: 'test', anthropic: 'test', google: 'test'}, fetch, webFetch};
    const events = await collect(streamChat(request, options));
    expect(events.map(event => event.type)).toEqual(['start', 'tool-call', 'tool-result', 'text-delta', 'text-delta', 'done']);
    expect(events[2]).toMatchObject({type: 'tool-result', result: {toolName: 'web_fetch', status: 'success', output: {format: 'markdown', filtering: {reason: 'disabled'}}}});
    const firstRequest = JSON.stringify(JSON.parse(String(fetch.mock.calls[0]![1]?.body)).tools);
    expect(firstRequest).toContain('web_fetch');
    expect(firstRequest).not.toContain('explore');
    expect(String(fetch.mock.calls[1]![1]?.body)).toContain('authenticate(token)');
    const parts = events.flatMap(event => event.type === 'tool-call' ? [{type: 'tool-call' as const, call: event.call}]
      : event.type === 'tool-result' ? [{type: 'tool-result' as const, result: event.result}] as ChatMessage['parts']
      : event.type === 'text-delta' ? [{type: 'text' as const, text: event.text}] : []);
    const replay = await collect(streamChat({...request, messages: [...messages, {id: 'a1', role: 'assistant', parts}, {id: 'u2', role: 'user', parts: [{type: 'text', text: 'Explain that API.'}]}]}, options));
    expect(replay.at(-1)?.type).toBe('done');
    expect(String(fetch.mock.calls[2]![1]?.body)).toContain('API Reference');
    expect(transport.fetch).toHaveBeenCalledOnce();
  });
  it('uses only the latest user text for the fallback relevance objective', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValueOnce(sseResponse(openaiToolEvents('web_fetch', {url}))).mockResolvedValueOnce(sseResponse(openaiEvents));
    const service = createWebFetchService({transport: {fetch: async () => ({requestedUrl: url, finalUrl: url, status: 200, contentType: 'text/plain', text: 'Source'})}});
    const webFetch = {fetch: vi.fn(service.fetch)};
    await collect(streamChat({model: 'gpt-6.1-sol', contextSummary: 'PRIVATE OLDER SUMMARY', messages: [
      {id: 'old', role: 'user', parts: [{type: 'text', text: 'PRIVATE OLD MESSAGE'}]}, ...messages,
    ]}, {credentials: {openai: 'test'}, fetch, webFetch}));
    expect(webFetch.fetch.mock.calls[0]![1]?.objective).toBe('Read the API documentation.');
  });
  it('propagates cancellation through the provider tool into the web transport', async () => {
    const controller = new AbortController();
    let entered!: () => void;
    const started = new Promise<void>(yes => {entered = yes;});
    let webSignal: AbortSignal | undefined;
    const transport: WebTransport = {fetch: async (_url, _format, signal) => {webSignal = signal; entered(); return new Promise(() => {});}};
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValueOnce(sseResponse(openaiToolEvents('web_fetch', {url})));
    const pending = collect(streamChat({model: 'gpt-6.1-sol', messages}, {credentials: {openai: 'test'}, fetch, webFetch: createWebFetchService({transport}), abortSignal: controller.signal}));
    await started; controller.abort();
    expect((await pending).map(event => event.type)).toEqual(['start', 'tool-call']);
    expect(webSignal?.aborted).toBe(true);
    expect(fetch).toHaveBeenCalledOnce();
  });
});
