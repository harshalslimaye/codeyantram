import {requireValue, requestBody, parseJson, type ProviderRequest} from '../../../shared/tests/helpers.js';
import {describe, expect, it, vi} from 'vitest';
import {streamChat, type NavigationGraphService} from '../../src/index.js';
import {chatStreamEventSchema, type ChatStreamEvent} from '@codeyantram/shared';
import {sseResponse, openaiEvents, openaiToolEvents, anthropicEvents, anthropicToolEvents, googleEvents} from './fixtures.js';
function service() {
  return {query: vi.fn<NavigationGraphService["query"]>().mockResolvedValue({value: {symbols: ['greet'], coverage: 'indexed scope'}, freshness: {epoch: 'e', revision: 1, reconciledAt: 1}}),
    getStatus: vi.fn<NavigationGraphService["getStatus"]>().mockReturnValue({lifecycle: 'unopened', graph: null})} as unknown as NavigationGraphService;
}
async function collect(stream: AsyncIterable<ChatStreamEvent>) {
  const events = []; for await (const event of stream) events.push(chatStreamEventSchema.parse(event)); return events;
}
const messages = [{id: 'u1', role: 'user' as const, parts: [{type: 'text' as const, text: 'Where is greet?'}]}];

describe('provider navigation loop', () => {
  it.each(['openai', 'anthropic', 'google'])('executes %s calls, streams results, and continues to text with aggregate usage', async provider => {
    const workspaceGraph = service();
    const googleTool = [{candidates: [{content: {role: 'model', parts: [{functionCall: {name: 'graph', args: {}}, thoughtSignature: 'fixture-signature'}]}, finishReason: 'STOP'}],
      usageMetadata: {promptTokenCount: 5, candidatesTokenCount: 3, totalTokenCount: 8}}];
    const calls = provider === 'openai' ? openaiToolEvents() : provider === 'anthropic' ? anthropicToolEvents() : googleTool;
    const answer = provider === 'openai' ? openaiEvents : provider === 'anthropic' ? anthropicEvents : googleEvents;
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValueOnce(sseResponse(calls)).mockResolvedValueOnce(sseResponse(answer));
    const events = await collect(streamChat({model: provider === 'openai' ? 'gpt-6.1-sol' : provider === 'anthropic' ? 'claude-sonnet-5-5' : 'gemini-3.8-flash', messages}, {
      credentials: {openai: 'test', anthropic: 'test', google: 'test'}, workspaceGraph, fetch,
    }));
    expect(events.map(event => event.type)).toEqual(['start', 'tool-call', 'tool-result', 'text-delta', 'text-delta', 'done']);
    expect(events[2]).toMatchObject({type: 'tool-result', result: {status: 'success'}});
    expect(events.at(-1)).toMatchObject({usage: {inputTokens: 15, outputTokens: 6}});
    expect(fetch).toHaveBeenCalledTimes(2);
    const second = parseJson<ProviderRequest>(requestBody(fetch.mock.calls[1][1]?.body));
    const call = requireValue(events.find(event => event.type === 'tool-call'));
    expect(JSON.stringify(second)).toContain(call.call.toolCallId);
    if (provider === 'google') expect(call.call.providerOptions).toMatchObject({google: {thoughtSignature: 'fixture-signature'}});
    expect(JSON.stringify(second)).toContain('success');
  });

  it('returns invalid input as a tool error and continues without touching the graph', async () => {
    const workspaceGraph = service();
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValueOnce(sseResponse(anthropicToolEvents('explore', {query: 'greet', workspaceRoot: '/other'})))
      .mockResolvedValueOnce(sseResponse(anthropicEvents));
    const events = await collect(streamChat({model: 'claude-sonnet-5-5', messages}, {credentials: {anthropic: 'test'}, fetch, workspaceGraph}));
    expect(events[2]).toMatchObject({type: 'tool-result', result: {status: 'error', error: {code: 'invalid_input'}}});
    expect(workspaceGraph.query).not.toHaveBeenCalled();
    expect(events.at(-1)?.type).toBe('done');
  });

  it('stops repeated tool steps with a turn error instead of claiming completion', async () => {
    let call = 0;
    const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(async () => sseResponse(openaiToolEvents('graph', {}, `call-${++call}`)));
    const events = await collect(streamChat({model: 'gpt-6.1-sol', messages}, {credentials: {openai: 'test'}, fetch, workspaceGraph: service()}));
    expect(fetch).toHaveBeenCalledTimes(6);
    expect(events.filter(event => event.type === 'tool-call')).toHaveLength(6);
    expect(events.filter(event => event.type === 'tool-result')).toHaveLength(6);
    expect(events.at(-1)).toMatchObject({type: 'error', code: 'tool_limit'});
    expect(events.some(event => event.type === 'done')).toBe(false);
  });

  it('cancels an in-flight graph query without starting another provider step', async () => {
    const controller = new AbortController();
    let querySignal: AbortSignal | undefined;
    let entered!: () => void;
    const queryStarted = new Promise<void>(resolve => {entered = resolve;});
    const workspaceGraph = service();
    const query = vi.fn<NavigationGraphService["query"]>().mockImplementation(async (_read, options) => {
      querySignal = options?.signal; entered();
      await new Promise<void>(resolve => requireValue(querySignal).addEventListener('abort', () => resolve(), {once: true}));
      throw new DOMException('Cancelled', 'AbortError');
    });
    workspaceGraph.query = async (read, options) => {await query(read, options); throw new Error('The cancelled query must reject.');};
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValueOnce(sseResponse(openaiToolEvents()));
    const completed = collect(streamChat({model: 'gpt-6.1-sol', messages}, {credentials: {openai: 'test'}, fetch, workspaceGraph, abortSignal: controller.signal}));
    await queryStarted; controller.abort();
    const events = await completed;
    expect(querySignal?.aborted).toBe(true);
    expect(fetch).toHaveBeenCalledOnce();
    expect(events.map(event => event.type)).toEqual(['start', 'tool-call']);
  });
});
