import {requireValue, requireParts, requireString, asymmetric, requestBody, requestUrl, parseJson, type ProviderRequest} from '../../../shared/tests/helpers.js';
import {describe, expect, it, vi} from 'vitest';
import {compactChat} from '@codeyantram/core';
import {MAX_SUMMARY_CHARACTERS, compactStreamEventSchema, type CompactRequest, type CompactStreamEvent} from '@codeyantram/shared';
import {summaryResponse} from './fixtures.js';

const credentials = {openai: 'test-openai-key', anthropic: 'test-anthropic-key', google: 'test-google-key'};
const summary = 'Objective and requests\nUpdate /src/chat.ts; validation remains pending.\n';
const request: CompactRequest = {
  model: 'gpt-6.1-sol',
  previousSummary: 'Initial objective: update /src/chat.ts using port 43187.',
  messages: [
    {id: 'u1', role: 'user', parts: [{type: 'text', text: 'Use port 43188 instead. Preserve the API.'}]},
    {id: 'a1', role: 'assistant', status: 'cancelled', parts: [{type: 'text', text: 'Started an edit; checks pending.'}]},
    {id: 'u2', role: 'user', parts: [{type: 'text', text: 'Continue after reviewing the failure.'}]},
    {id: 'a2', role: 'assistant', status: 'failed', parts: [{type: 'text', text: 'The attempt failed.'}]},
  ],
};
const providerModels = ['gpt-6.1-sol', 'claude-sonnet-5-5', 'gemini-3.8-flash'];

async function collect(stream: AsyncIterable<CompactStreamEvent>): Promise<CompactStreamEvent[]> {
  const events: CompactStreamEvent[] = [];
  for await (const event of stream) {
    expect(compactStreamEventSchema.safeParse(event).success).toBe(true);
    events.push(event);
  }
  return events;
}

describe('compactChat provider integration', () => {
  it.each(providerModels)('generates a complete summary with normalized usage for %s', async model => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(summaryResponse(model, summary));
    const events = await collect(compactChat({...request, model}, {credentials, fetch}));
    expect(events).toEqual([
      {type: 'start'},
      {type: 'done', summary, durationMs: asymmetric.any(Number), usage: {
        inputTokens: 10, outputTokens: 3, totalTokens: 13, cacheReadTokens: 4,
        ...(model.startsWith('claude-') ? {cacheWriteTokens: 1} : {}),
      }},
    ]);
    expect(fetch).toHaveBeenCalledOnce();
    const [url, init] = requireValue(fetch.mock.calls[0]);
    const body = parseJson<ProviderRequest>(requestBody(init?.body));
    expect(body.stream).not.toBe(true);
    expect(body.tools ?? []).toEqual([]);
    let source: string;
    let instructions: string;
    if (model.startsWith('gpt-')) {
      expect(requestUrl(url)).toBe('https://api.openai.com/v1/responses');
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer test-openai-key');
      expect(body).toMatchObject({max_output_tokens: 4096, reasoning: {effort: 'low'}});
      expect(requireValue(body.input).map((message: {role: string}) => message.role)).toEqual(['developer', 'user']);
      instructions = requireString(requireValue(body.input)[0].content);
      source = requireParts(requireValue(body.input)[1].content)[0].text;
    } else if (model.startsWith('claude-')) {
      expect(new Headers(init?.headers).get('x-api-key')).toBe('test-anthropic-key');
      expect(body).toMatchObject({cache_control: {type: 'ephemeral'}, max_tokens: 4096, thinking: {type: 'adaptive'}, output_config: {effort: 'low'}});
      expect(requireValue(body.messages).map((message: {role: string}) => message.role)).toEqual(['user']);
      instructions = requireValue(body.system)[0].text;
      source = requireValue(body.messages)[0].content[0].text;
    } else {
      expect(requestUrl(url)).toContain(':generateContent');
      expect(new Headers(init?.headers).get('x-goog-api-key')).toBe('test-google-key');
      expect(body).toMatchObject({generationConfig: {maxOutputTokens: 4096, thinkingConfig: {thinkingLevel: 'low'}}});
      expect(requireValue(body.contents).map((message: {role: string}) => message.role)).toEqual(['user']);
      instructions = requireValue(body.systemInstruction).parts[0].text;
      source = requireValue(body.contents)[0].parts[0].text;
    }
    expect(parseJson<ProviderRequest>(source)).toEqual({previousSummary: request.previousSummary, messages: request.messages});
    expect(instructions).not.toContain(request.previousSummary);
    expect(instructions).not.toContain('43188');
    // Check preservation requirements, without snapshotting the prompt's wording.
    for (const concept of ['historical', 'constraints', 'paths', 'validation', 'uncertainty', 'authorization', 'cancelled', 'failed']) {
      expect(instructions.toLowerCase()).toContain(concept);
    }
  });

  it.each(['claude-haiku-4-5-20251001', 'gemma-4-31b-it'])('omits effort for %s without effort controls', async model => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(summaryResponse(model, summary));
    expect((await collect(compactChat({...request, model}, {credentials, fetch}))).at(-1)?.type).toBe('done');
    const body = parseJson<ProviderRequest>(requestBody(requireValue(fetch.mock.calls[0])[1]?.body));
    expect(body.thinking).toBeUndefined();
    expect(body.output_config).toBeUndefined();
    expect(body.generationConfig?.thinkingConfig).toBeUndefined();
    if (model.startsWith('claude-')) expect(body.cache_control).toEqual({type: 'ephemeral'});
    expect(body.max_tokens ?? body.generationConfig?.maxOutputTokens).toBe(4096);
  });

  it.each(['gemini-2.5-pro', 'gemini-2.5-flash'])('uses the supported low reasoning budget for %s', async model => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(summaryResponse(model, summary));
    expect((await collect(compactChat({...request, model}, {credentials, fetch}))).at(-1)?.type).toBe('done');
    const body = parseJson<ProviderRequest>(requestBody(requireValue(fetch.mock.calls[0])[1]?.body));
    expect(body.generationConfig).toMatchObject({maxOutputTokens: 4096, thinkingConfig: {thinkingBudget: 6554}});
  });

  it('supports the first summary, defaults statusless assistants to complete, and strips usage', async () => {
    const input = {model: request.model, messages: [requireValue(request.messages[0]), {
      id: 'a1', role: 'assistant' as const, parts: [{type: 'text' as const, text: 'Reported work'}],
      usage: {inputTokens: 42},
    }]};
    const original = structuredClone(input);
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(summaryResponse(input.model, summary));
    await collect(compactChat(input, {credentials, fetch}));
    const body = parseJson<ProviderRequest>(requestBody(requireValue(fetch.mock.calls[0])[1]?.body));
    const source = parseJson<{messages: CompactRequest["messages"]}>(requireParts(requireValue(body.input)[1].content)[0].text);
    expect(source).not.toHaveProperty('previousSummary');
    expect(requireValue(source.messages)[1]).toMatchObject({status: 'complete'});
    expect(requireValue(source.messages)[1]).not.toHaveProperty('usage');
    expect(input).toEqual(original);
  });

  it('omits unavailable provider usage rather than reporting zero', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(Response.json({
      candidates: [{content: {role: 'model', parts: [{text: summary}]}, finishReason: 'STOP'}],
    }));
    const events = await collect(compactChat({...request, model: 'gemini-3.8-flash'}, {credentials, fetch}));
    expect(events.at(-1)).toMatchObject({type: 'done', summary});
    expect(events.at(-1)).not.toHaveProperty('usage');
  });

  it('accepts the summary size limit without trimming the returned text', async () => {
    const text = ' ' + 'x'.repeat(MAX_SUMMARY_CHARACTERS - 2) + '\n';
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(summaryResponse(request.model, text));
    expect((await collect(compactChat(request, {credentials, fetch}))).at(-1)).toMatchObject({type: 'done', summary: text});
  });
});

describe('compactChat failures and cancellation', () => {
  it.each(providerModels.flatMap(model => ['', ' \n\t', 'x'.repeat(MAX_SUMMARY_CHARACTERS + 1)].map(text => ({model, text}))))(
    'rejects blank or oversized output for $model (case %#)', async ({model, text}) => {
      const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(summaryResponse(model, text));
      const events = await collect(compactChat({...request, model}, {credentials, fetch}));
      expect(events.map(event => event.type)).toEqual(['start', 'error']);
      expect(events.at(-1)).toMatchObject({code: 'compaction_failed'});
      expect(fetch).toHaveBeenCalledOnce();
    },
  );

  it.each([
    ...providerModels.map(model => ({model, finish: 'length'})),
    {model: 'gpt-6.1-sol', finish: 'content_filter'},
    {model: 'claude-sonnet-5-5', finish: 'refusal'},
    {model: 'gemini-3.8-flash', finish: 'SAFETY'},
    {model: 'claude-sonnet-5-5', finish: 'unexpected'},
  ])('rejects $finish output for $model even with readable text', async ({model, finish}) => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(summaryResponse(model, summary, finish));
    const events = await collect(compactChat({...request, model}, {credentials, fetch}));
    expect(events.map(event => event.type)).toEqual(['start', 'error']);
    expect(events.at(-1)).toMatchObject({code: 'compaction_failed'});
    expect(fetch).toHaveBeenCalledOnce();
  });

  it.each([
    [{...request, model: 'unsupported'}, credentials, 'invalid_request'],
    [{...request, messages: []}, credentials, 'invalid_request'],
    [{...request, previousSummary: ' '}, credentials, 'invalid_request'],
    [request, {}, 'missing_credentials'],
  ] as const)('rejects invalid input or missing credentials before HTTP (case %#)', async (input, keys, code) => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    expect((await collect(compactChat(input as CompactRequest, {credentials: keys, fetch}))).at(-1)).toMatchObject({type: 'error', code});
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([[429, 'rate_limited'], [401, 'provider_error'], [500, 'provider_error']] as const)(
    'sanitizes HTTP %s and makes no retries', async (status, code) => {
      const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(Response.json({
        error: {message: 'private-data test-openai-key', type: 'api_error'},
      }, {status}));
      const events = await collect(compactChat(request, {credentials, fetch}));
      expect(events.at(-1)).toMatchObject({type: 'error', code});
      expect(JSON.stringify(events)).not.toContain('private-data');
      expect(JSON.stringify(events)).not.toContain('test-openai-key');
      expect(fetch).toHaveBeenCalledOnce();
    },
  );

  it.each([Response.json({output: 'private-data test-openai-key'}), new Response('{broken', {
    headers: {'content-type': 'application/json'},
  })])('sanitizes malformed provider responses (case %#)', async response => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(response);
    const events = await collect(compactChat(request, {credentials, fetch}));
    expect(events.at(-1)).toMatchObject({type: 'error', code: 'provider_error'});
    expect(JSON.stringify(events)).not.toContain('private-data');
    expect(JSON.stringify(events)).not.toContain('test-openai-key');
  });

  it('emits nothing and makes no request when already cancelled', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    expect(await collect(compactChat(request, {credentials, fetch, abortSignal: AbortSignal.abort()}))).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('stops after start when cancelled before generation', async () => {
    const controller = new AbortController();
    const fetch = vi.fn<typeof globalThis.fetch>();
    const events: CompactStreamEvent[] = [];
    for await (const event of compactChat(request, {credentials, fetch, abortSignal: controller.signal})) {
      events.push(event);
      controller.abort();
    }
    expect(events).toEqual([{type: 'start'}]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([false, true])('propagates pending cancellation and ignores a late response (late=%s)', async late => {
    const controller = new AbortController();
    let started!: () => void;
    const pending = new Promise<void>(resolve => {started = resolve;});
    let resolveResponse!: (response: Response) => void;
    let rejectResponse!: (error: Error) => void;
    const response = new Promise<Response>((resolve, reject) => {resolveResponse = resolve; rejectResponse = reject;});
    const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation((_url, init) => {
      init?.signal?.addEventListener('abort', () => {
        if (late) resolveResponse(summaryResponse(request.model, summary));
        else rejectResponse(new DOMException('Aborted', 'AbortError'));
      }, {once: true});
      started();
      return response;
    });
    const result = collect(compactChat(request, {credentials, fetch, abortSignal: controller.signal}));
    await pending;
    controller.abort();
    expect(await result).toEqual([{type: 'start'}]);
    expect(requireValue(fetch.mock.calls[0])[1]?.signal?.aborted).toBe(true);
  });

  it('makes no request if the caller stops consuming after start', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    for await (const _event of compactChat(request, {credentials, fetch})) break;
    expect(fetch).not.toHaveBeenCalled();
  });

  it('releases its operation controller after successful consumption', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(summaryResponse(request.model, summary));
    await collect(compactChat(request, {credentials, fetch}));
    expect(requireValue(fetch.mock.calls[0])[1]?.signal?.aborted).toBe(true);
  });
});
