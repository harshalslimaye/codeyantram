import {describe, expect, it, vi} from 'vitest';
import {streamChat, type ChatStreamOptions, type ReadService} from '../../src/index.js';
import {history, readOutput, OMITTED_MARKER} from '../../../shared/tests/chat/tool-result-fixtures.js';
import {requestBody, parseJson, requireValue} from '../../../shared/tests/helpers.js';
import {sseResponse, openaiEvents, openaiToolEvents, anthropicEvents, anthropicToolEvents, googleEvents} from './fixtures.js';
import {BUILTIN_AGENTS} from '../../src/agents/builtins.js';

const models = new Map([['openai', 'gpt-6.1-sol'], ['anthropic', 'claude-sonnet-5-5'], ['google', 'gemini-3.8-flash'], ['chatgpt', 'gpt-6.1-sol']]);
const credentials = {openai: 'fixture', anthropic: 'fixture', google: 'fixture'};
const chatgpt = {profileId: 'fixture', getAccessToken: async () => 'fixture'};

async function collect(request: Parameters<typeof streamChat>[0], options: ChatStreamOptions) {
  const events = [];
  for await (const event of streamChat(request, options)) events.push(event);
  return events;
}

function answer(provider: string) {
  if (provider === 'anthropic') return anthropicEvents;
  if (provider === 'google') return googleEvents;
  return openaiEvents;
}

function call(provider: string, name: string, input: unknown, id: string) {
  if (provider === 'anthropic') return anthropicToolEvents(name, input, id);
  if (provider === 'google') return [{candidates: [{content: {role: 'model', parts: [
    {functionCall: {name, args: input}, thoughtSignature: `signature-${id}`},
  ]}, finishReason: 'STOP'}], usageMetadata: {promptTokenCount: 5, candidatesTokenCount: 3, totalTokenCount: 8}}];
  return openaiToolEvents(name, input, id);
}

describe('actual provider tool result projection', () => {
  it.each(['openai', 'anthropic', 'google', 'chatgpt'])('removes old body bytes, preserves pairing and recovers exact history through %s', async provider => {
    const messages = history();
    const snapshot = structuredClone(messages);
    const original = requireValue(messages[1]?.parts.find(part => part.type === 'tool-result'));
    if (original.type !== 'tool-result') throw new Error('Expected result fixture.');
    const text = JSON.stringify(original.result);
    const offset = text.indexOf(OMITTED_MARKER);
    const fetch = vi.fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(sseResponse(call(provider, 'tool_result_read', {toolCallId: 'old-read', offset, length: 100}, 'recovery-call')))
      .mockResolvedValueOnce(sseResponse(answer(provider)));
    const diagnostics: unknown[] = [];
    const events = await collect({model: requireValue(models.get(provider)), messages}, {
      credentials, fetch, ...(provider === 'chatgpt' ? {chatgpt} : {}), onToolResultContext: value => {diagnostics.push(value);},
    });
    expect(events.at(-1)?.type).toBe('done');
    expect(fetch).toHaveBeenCalledTimes(2);
    const first = requestBody(fetch.mock.calls[0]?.[1]?.body);
    const second = requestBody(fetch.mock.calls[1]?.[1]?.body);
    expect(first).toContain('older-tool-result');
    expect(first).toContain('old-read');
    expect(first).not.toContain(OMITTED_MARKER);
    expect(first).toContain('File inspected.');
    expect(second).toContain(OMITTED_MARKER);
    expect(second).toContain('older-tool-result');
    if (provider === 'google') expect(first).toContain('historical-signature');
    expect(messages).toEqual(snapshot);
    const recovery = events.find(event => event.type === 'tool-result');
    expect(recovery).toMatchObject({result: {toolName: 'tool_result_read', status: 'success', output: {
      offset, content: text.slice(offset, offset + 100), untrusted: true,
    }}});
    expect(diagnostics[0]).toMatchObject({trimmedResults: 1});
    expect(diagnostics[1]).toMatchObject({trimmedResults: 1, recoveryCalls: 1});
  });

  it.each(['openai', 'anthropic', 'google', 'chatgpt'])('delivers live results fully before trimming older steps for %s', async provider => {
    const outputs = ['FIRST_LIVE_DETAIL', 'SECOND_LIVE_DETAIL', 'THIRD_LIVE_DETAIL'].map(readOutput);
    const read = vi.fn<ReadService['read']>()
      .mockResolvedValueOnce(requireValue(outputs[0])).mockResolvedValueOnce(requireValue(outputs[1])).mockResolvedValueOnce(requireValue(outputs[2]));
    const fetch = vi.fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(sseResponse(call(provider, 'read', {filePath: 'src/large.ts'}, 'live-1')))
      .mockResolvedValueOnce(sseResponse(call(provider, 'read', {filePath: 'src/large.ts'}, 'live-2')))
      .mockResolvedValueOnce(sseResponse(call(provider, 'read', {filePath: 'src/large.ts'}, 'live-3')))
      .mockResolvedValueOnce(sseResponse(answer(provider)));
    const events = await collect({model: requireValue(models.get(provider)), messages: [
      {id: 'user', role: 'user', parts: [{type: 'text', text: 'Inspect source'}]},
    ]}, {credentials, fetch, read: {read}, ...(provider === 'chatgpt' ? {chatgpt} : {})});
    expect(events.at(-1)?.type).toBe('done');
    expect(requestBody(fetch.mock.calls[1]?.[1]?.body)).toContain('FIRST_LIVE_DETAIL');
    expect(requestBody(fetch.mock.calls[2]?.[1]?.body)).toContain('FIRST_LIVE_DETAIL');
    const last = requestBody(fetch.mock.calls[3]?.[1]?.body);
    expect(last).not.toContain('FIRST_LIVE_DETAIL');
    expect(last).toContain('SECOND_LIVE_DETAIL');
    expect(last).toContain('THIRD_LIVE_DETAIL');
    expect(last).toContain('older-tool-result');
    expect(events.flatMap(event => event.type === 'tool-result' && event.result.status === 'success' ? [event.result.output] : [])).toEqual(outputs);
  });

  it.each(['request', 'host', 'tool-free-agent'])('keeps full history when disabled by %s', async mode => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(sseResponse(openaiEvents));
    await collect({model: 'gpt-6.1-sol', messages: history(), ...(mode === 'request' ? {toolResultTrimming: false} : {})},
      {credentials, fetch, ...(mode === 'host' ? {toolResultTrimming: false} : {}),
        ...(mode === 'tool-free-agent' ? {agent: {...requireValue(BUILTIN_AGENTS[0]), tools: []}} : {})});
    const body = parseJson<Record<string, unknown>>(requestBody(fetch.mock.calls[0]?.[1]?.body));
    expect(JSON.stringify(body)).toContain(OMITTED_MARKER);
    expect(JSON.stringify(body)).not.toContain('older-tool-result');
  });

  it('ages parallel results together, keeps SDK call metadata and leaves streamed originals intact', async () => {
    const parallel = ['parallel-1', 'parallel-2'].map(id => openaiToolEvents('read', {filePath: 'src/large.ts'}, id));
    const batch = [requireValue(parallel[0]?.[0]), ...parallel.flatMap(events => events.slice(1, -1)), requireValue(parallel[0]?.at(-1))];
    const read = vi.fn<ReadService['read']>().mockResolvedValue(readOutput());
    const fetch = vi.fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(sseResponse(batch))
      .mockResolvedValueOnce(sseResponse(openaiToolEvents('read', {filePath: 'src/large.ts'}, 'single-1')))
      .mockResolvedValueOnce(sseResponse(openaiToolEvents('read', {filePath: 'src/large.ts'}, 'single-2')))
      .mockResolvedValueOnce(sseResponse(openaiEvents));
    const events = await collect({model: 'gpt-6.1-sol', messages: [history()[0]]}, {credentials, fetch, read: {read}});
    expect(events.at(-1)?.type).toBe('done');
    expect(read).toHaveBeenCalledTimes(4);
    const second = requestBody(fetch.mock.calls[1]?.[1]?.body);
    expect(second).toContain(OMITTED_MARKER);
    const fourth = requestBody(fetch.mock.calls[3]?.[1]?.body);
    const body = parseJson<{input: {type: string; call_id?: string; output?: string}[]}>(fourth);
    for (const id of ['parallel-1', 'parallel-2']) {
      expect(body.input.filter(item => item.type === 'function_call' && item.call_id === id)).toHaveLength(1);
      const outputs = body.input.filter(item => item.type === 'function_call_output' && item.call_id === id);
      expect(outputs).toHaveLength(1);
      expect(outputs[0]?.output).toContain('older-tool-result');
      expect(outputs[0]?.output).not.toContain(OMITTED_MARKER);
    }
    expect(events.filter(event => event.type === 'tool-result')).toHaveLength(4);
  });
});
