import {describe, expect, it, vi} from 'vitest';
import {streamChat, type ReadService} from '../../src/index.js';
import {chatStreamEventSchema, type ChatStreamEvent} from '@codeyantram/shared';
import {requireValue, parseJson, requestBody, asymmetric, type ProviderRequest} from '../../../shared/tests/helpers.js';
import {sseResponse, openaiEvents, openaiToolEvents} from './fixtures.js';

const output = {filePath: 'config.json', contentHash: 'a'.repeat(64), totalLines: 1, offset: 1, nextOffset: null,
  ranges: [{startLine: 1, endLine: 1, text: '{"enabled":true}'}], untrusted: true as const,
  truncation: {truncated: false, lineTruncated: false},
  filtering: {status: 'skipped' as const, reason: 'disabled', totalChunks: 1, evaluatedChunks: 0, retainedChunks: 1, incomplete: false}, warnings: [],
};

async function collect(stream: AsyncIterable<ChatStreamEvent>) {
  const events: ChatStreamEvent[] = [];
  for await (const event of stream) events.push(chatStreamEventSchema.parse(event));
  return events;
}

describe('read provider loop', () => {
  it('registers read without a graph and passes only the latest user objective', async () => {
    const read = vi.fn<ReadService['read']>().mockResolvedValue(output);
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValueOnce(sseResponse(openaiToolEvents('read', {filePath: 'config.json', filter: false})))
      .mockResolvedValueOnce(sseResponse(openaiEvents));
    const messages = [{id: 'prior', role: 'user' as const, parts: [{type: 'text' as const, text: 'Private prior task'}]},
      {id: 'latest', role: 'user' as const, parts: [{type: 'text' as const, text: 'Inspect the config'}]}];
    const events = await collect(streamChat({model: 'gpt-6.1-sol', messages}, {credentials: {openai: 'test'}, fetch, read: {read}}));
    expect(events.map(event => event.type)).toEqual(['start', 'tool-call', 'tool-result', 'text-delta', 'text-delta', 'done']);
    expect(events[2]).toMatchObject({type: 'tool-result', result: {toolName: 'read', status: 'success', output}});
    expect(read).toHaveBeenCalledWith({filePath: 'config.json', filter: false}, {objective: 'Inspect the config', abortSignal: asymmetric.any(AbortSignal)});
    const second = parseJson<ProviderRequest>(requestBody(requireValue(fetch.mock.calls[1])[1]?.body));
    expect(JSON.stringify(second)).toContain('config.json');
  });

  it('rejects model-selected roots before filesystem work', async () => {
    const read = vi.fn<ReadService['read']>();
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValueOnce(sseResponse(openaiToolEvents('read', {filePath: 'file', workspaceRoot: '/other'})))
      .mockResolvedValueOnce(sseResponse(openaiEvents));
    const events = await collect(streamChat({model: 'gpt-6.1-sol', messages: [{id: 'user', role: 'user', parts: [{type: 'text', text: 'Read file'}]}]}, {
      credentials: {openai: 'test'}, fetch, read: {read},
    }));
    expect(events[2]).toMatchObject({type: 'tool-result', result: {status: 'error', error: {code: 'invalid_input'}}});
    expect(read).not.toHaveBeenCalled();
  });
});
