import {describe, expect, it, vi} from 'vitest';
import {streamChat} from '@codeyantram/core';
import {chatStreamEventSchema, type ChatRequest, type ChatStreamEvent} from '@codeyantram/shared';
import {anthropicEvents, googleEvents, openaiEvents, sseResponse} from './fixtures.js';

const credentials = {openai: 'test-openai-key', anthropic: 'test-anthropic-key', google: 'test-google-key'};
const request: ChatRequest = {
  model: 'gpt-6.1-sol',
  effort: 'high',
  messages: [
    {id: 'user-1', role: 'user', parts: [{type: 'text', text: 'Hello'}]},
    {id: 'assistant-1', role: 'assistant', parts: [{type: 'text', text: 'Hi'}]},
    {id: 'user-2', role: 'user', parts: [{type: 'text', text: 'Continue'}]},
  ],
};

async function collect(stream: AsyncIterable<ChatStreamEvent>): Promise<ChatStreamEvent[]> {
  const events: ChatStreamEvent[] = [];
  for await (const event of stream) {
    expect(chatStreamEventSchema.safeParse(event).success).toBe(true);
    events.push(event);
  }
  return events;
}

describe('streamChat provider integration', () => {
  it.each([
    ['gpt-6.1-sol', openaiEvents],
    ['claude-sonnet-5-5', anthropicEvents],
    ['gemini-3.8-flash', googleEvents],
  ])('streams %s into the shared events and normalizes usage', async (model, fixture) => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(sseResponse(fixture));
    const events = await collect(streamChat({...request, model}, {credentials, fetch}));
    expect(events.map(event => event.type)).toEqual(['start', 'text-delta', 'text-delta', 'done']);
    expect(events[0]).toEqual({type: 'start', messageId: expect.any(String)});
    expect(events.slice(1, 3)).toEqual([
      {type: 'text-delta', text: 'Hello'}, {type: 'text-delta', text: ' back'},
    ]);
    expect(events.at(-1)).toMatchObject({
      type: 'done', durationMs: expect.any(Number),
      usage: {inputTokens: 10, outputTokens: 3, totalTokens: 13, cacheReadTokens: 4},
    });
    if (model.startsWith('claude-')) {
      expect(events.at(-1)).toMatchObject({usage: {cacheWriteTokens: 1}});
    }
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('sends only conversation content, credentials, and the requested OpenAI effort', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(sseResponse(openaiEvents));
    await collect(streamChat(request, {credentials, fetch}));
    const [url, init] = fetch.mock.calls[0]!;
    expect(String(url)).toBe('https://api.openai.com/v1/responses');
    expect(new Headers(init?.headers).get('authorization')).toBe('Bearer test-openai-key');
    const body = JSON.parse(String(init?.body));
    expect(body).toMatchObject({model: request.model, reasoning: {effort: 'high'}, stream: true});
    expect(body.input.map((message: {role: string}) => message.role)).toEqual(['user', 'assistant', 'user']);
    expect(body.input[2].content).toEqual([{type: 'input_text', text: 'Continue'}]);
    expect(body.input.every((message: object) => !('id' in message) && !('usage' in message))).toBe(true);
  });

  it('sends adaptive thinking and effort to Anthropic', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(sseResponse(anthropicEvents));
    await collect(streamChat({...request, model: 'claude-sonnet-5-5', effort: 'max'}, {credentials, fetch}));
    const init = fetch.mock.calls[0]![1];
    expect(new Headers(init?.headers).get('x-api-key')).toBe('test-anthropic-key');
    expect(JSON.parse(String(init?.body))).toMatchObject({
      cache_control: {type: 'ephemeral'},
      thinking: {type: 'adaptive'}, output_config: {effort: 'max'},
    });
  });

  it.each(['claude-sonnet-5-5', 'claude-haiku-4-5-20251001'])('enables automatic caching without changing default reasoning for %s', async model => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(sseResponse(anthropicEvents));
    const input: ChatRequest = {...request, model, effort: undefined};
    const events = await collect(streamChat(input, {credentials, fetch}));
    expect(events.at(-1)?.type).toBe('done');
    const body = JSON.parse(String(fetch.mock.calls[0]![1]?.body));
    expect(body.cache_control).toEqual({type: 'ephemeral'});
    expect(body.thinking).toBeUndefined();
    expect(body.output_config).toBeUndefined();
    expect(body.messages.map((message: {role: string}) => message.role)).toEqual(['user', 'assistant', 'user']);
  });

  it.each([
    ['gemini-3.8-flash', {thinkingLevel: 'high'}],
    ['gemini-2.5-pro', {thinkingBudget: 32768}],
    ['gemini-2.5-flash', {thinkingBudget: 24576}],
  ])('applies the supported Google effort settings for %s', async (model, thinkingConfig) => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(sseResponse(googleEvents));
    await collect(streamChat({...request, model}, {credentials, fetch}));
    const init = fetch.mock.calls[0]![1];
    expect(new Headers(init?.headers).get('x-goog-api-key')).toBe('test-google-key');
    expect(JSON.parse(String(init?.body))).toMatchObject({generationConfig: {thinkingConfig}});
  });

  it.each([
    ['gpt-6.1-sol', openaiEvents],
    ['claude-sonnet-5-5', anthropicEvents],
    ['gemini-3.8-flash', googleEvents],
  ])('replays historical context at user level before the unchanged tail for %s', async (model, fixture) => {
    const input: ChatRequest = {
      model,
      contextSummary: '  Prior objective: use /src/old.ts and port 43187.\n ',
      messages: [
        {id: 'u1', role: 'user', parts: [{type: 'text', text: 'Use /src/new.ts instead.'}, {type: 'text', text: '\nKeep the API.'}]},
        {id: 'u2', role: 'user', parts: [{type: 'text', text: 'Correction: port 43188.'}]},
        {id: 'a1', role: 'assistant', parts: [{type: 'text', text: 'Acknowledged.'}]},
        {id: 'u3', role: 'user', parts: [{type: 'text', text: 'Continue.'}]},
      ],
    };
    const original = structuredClone(input);
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(sseResponse(fixture));
    const events = await collect(streamChat(input, {credentials, fetch}));
    expect(events.at(-1)?.type).toBe('done');
    const body = JSON.parse(String(fetch.mock.calls[0]![1]?.body));
    const wireMessages: {role: string; texts: string[]}[] = model.startsWith('gpt-')
      ? body.input.map((message: {role: string; content: string | {text: string}[]}) => ({
        role: message.role, texts: typeof message.content === 'string' ? [message.content] : message.content.map(part => part.text),
      }))
      : model.startsWith('claude-')
        ? body.messages.map((message: {role: string; content: {text: string}[]}) => ({
          role: message.role, texts: message.content.map(part => part.text),
        }))
        : body.contents.map((message: {role: string; parts: {text: string}[]}) => ({
          role: message.role === 'model' ? 'assistant' : message.role, texts: message.parts.map(part => part.text),
        }));
    expect(wireMessages[0]?.role).toBe('user');
    const wrapper = wireMessages[0]!.texts[0]!;
    expect(wrapper).toContain('Historical conversation summary');
    expect(wrapper).toContain('current user instructions may supersede');
    expect(wrapper).toContain(input.contextSummary);
    expect(wrapper).toContain('End of historical conversation summary');
    expect(wireMessages.flatMap(message => message.texts).slice(1)).toEqual(
      input.messages.flatMap(message => message.parts.map(part => part.text)),
    );
    expect(wireMessages.filter(message => message.role === 'assistant')).toEqual([
      {role: 'assistant', texts: ['Acknowledged.']},
    ]);
    // Anthropic merges adjacent users into ordered content blocks; the other
    // adapters retain distinct messages. No fabricated acknowledgement is needed.
    expect(wireMessages.map(message => message.role)).toEqual(model.startsWith('claude-')
      ? ['user', 'assistant', 'user'] : ['user', 'user', 'user', 'assistant', 'user']);
    expect(body.system).toBeUndefined();
    expect(body.systemInstruction).toBeUndefined();
    expect(body.instructions).toBeUndefined();
    expect(input).toEqual(original);
  });
});

describe('streamChat failures and cancellation', () => {
  it.each([
    [{...request, model: 'unsupported'}, credentials, 'invalid_request'],
    [{...request, model: 'claude-haiku-4-5-20251001'}, credentials, 'invalid_request'],
    [request, {}, 'missing_credentials'],
  ] as const)('rejects invalid requests or missing credentials before calling a provider', async (input, keys, code) => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    const events = await collect(streamChat(input, {credentials: keys, fetch}));
    expect(events.map(event => event.type)).toEqual(['start', 'error']);
    expect(events.at(-1)).toMatchObject({code});
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([[429, 'rate_limited'], [401, 'provider_error'], [500, 'provider_error']] as const)(
    'maps HTTP %s to %s without leaking the response body', async (status, code) => {
      const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response(JSON.stringify({
        error: {message: 'private-request-data test-openai-key', type: 'api_error'},
      }), {status, headers: {'content-type': 'application/json'}}));
      const events = await collect(streamChat(request, {credentials, fetch}));
      expect(events.map(event => event.type)).toEqual(['start', 'error']);
      expect(events.at(-1)).toMatchObject({code});
      expect(JSON.stringify(events)).not.toContain('private-request-data');
      expect(JSON.stringify(events)).not.toContain('test-openai-key');
      expect(fetch).toHaveBeenCalledOnce();
    },
  );

  it('reports a disconnected provider stream instead of successful completion', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(sseResponse(openaiEvents.slice(0, -1)));
    const events = await collect(streamChat(request, {credentials, fetch}));
    expect(events.map(event => event.type)).toEqual(['start', 'text-delta', 'text-delta', 'error']);
    expect(events.at(-1)).toMatchObject({code: 'provider_error'});
  });

  it('surfaces an error reported inside a response stream without a done event', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(sseResponse([
      ...openaiEvents.slice(0, -1),
      {type: 'error', sequence_number: 5, code: 'server_error', message: 'private-provider-details'},
    ]));
    const events = await collect(streamChat(request, {credentials, fetch}));
    expect(events.map(event => event.type)).toEqual(['start', 'text-delta', 'text-delta', 'error']);
    expect(events.at(-1)).toMatchObject({code: 'provider_error'});
    expect(JSON.stringify(events)).not.toContain('private-provider-details');
  });

  it('reports malformed provider frames as provider failures', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(sseResponse([
      {type: 'response.output_text.delta', delta: 42},
    ]));
    const events = await collect(streamChat(request, {credentials, fetch}));
    expect(events.map(event => event.type)).toEqual(['start', 'error']);
    expect(events.at(-1)).toMatchObject({code: 'provider_error'});
  });

  it('does not call a provider when already cancelled', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    const events = await collect(streamChat(request, {credentials, fetch, abortSignal: AbortSignal.abort()}));
    expect(events).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('ends without done or error when cancelled while the provider is pending', async () => {
    const controller = new AbortController();
    const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(async (_url, init) => {
      controller.abort();
      expect(init?.signal?.aborted).toBe(true);
      throw new DOMException('Aborted', 'AbortError');
    });
    const events = await collect(streamChat(request, {credentials, fetch, abortSignal: controller.signal}));
    expect(events.map(event => event.type)).toEqual(['start']);
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('aborts the provider request when the caller stops reading', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(sseResponse(openaiEvents));
    for await (const event of streamChat(request, {credentials, fetch})) {
      if (event.type === 'text-delta') break;
    }
    expect(fetch.mock.calls[0]![1]?.signal?.aborted).toBe(true);
  });

  it('preserves partial text without a terminal event when stopped mid-response', async () => {
    const controller = new AbortController();
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(sseResponse(openaiEvents));
    const events: ChatStreamEvent[] = [];
    for await (const event of streamChat(request, {credentials, fetch, abortSignal: controller.signal})) {
      events.push(event);
      if (event.type === 'text-delta') controller.abort();
    }
    expect(events.map(event => event.type)).toEqual(['start', 'text-delta']);
    expect(fetch.mock.calls[0]![1]?.signal?.aborted).toBe(true);
  });
});
