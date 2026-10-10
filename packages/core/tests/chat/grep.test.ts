import {describe, expect, it, vi} from 'vitest';
import {streamChat, type GrepService} from '../../src/index.js';
import {chatStreamEventSchema, type ChatStreamEvent} from '@codeyantram/shared';
import {asymmetric} from '../../../shared/tests/helpers.js';
import {sseResponse, openaiEvents, openaiToolEvents} from './fixtures.js';

const output = {pattern: 'needle', path: '.', matches: [{filePath: 'config.json', line: 1, column: 1, text: 'needle', textStartColumn: 1, textTruncated: false}],
  truncated: false, incomplete: false, coverage: 'text search', untrusted: true as const,
  filtering: {status: 'skipped' as const, mode: 'rank' as const, reason: 'disabled', totalCandidates: 1, evaluatedCandidates: 0, retainedCandidates: 1, incomplete: false}, warnings: [],
};
async function collect(stream: AsyncIterable<ChatStreamEvent>) {
  const events: ChatStreamEvent[] = [];
  for await (const event of stream) events.push(chatStreamEventSchema.parse(event));
  return events;
}

describe('grep provider loop', () => {
  it('registers grep without a graph and passes only the latest user objective', async () => {
    const search = vi.fn<GrepService['search']>().mockResolvedValue(output);
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValueOnce(sseResponse(openaiToolEvents('grep', {pattern: 'needle', filter: false})))
      .mockResolvedValueOnce(sseResponse(openaiEvents));
    const messages = [{id: 'prior', role: 'user' as const, parts: [{type: 'text' as const, text: 'Private prior task'}]},
      {id: 'latest', role: 'user' as const, parts: [{type: 'text' as const, text: 'Find the config key'}]}];
    const events = await collect(streamChat({model: 'gpt-6.1-sol', messages}, {credentials: {openai: 'test'}, fetch, grep: {search}}));
    expect(events[2]).toMatchObject({type: 'tool-result', result: {toolName: 'grep', status: 'success', output}});
    expect(search).toHaveBeenCalledWith({pattern: 'needle', filter: false}, {objective: 'Find the config key', abortSignal: asymmetric.any(AbortSignal)});
    expect(events.at(-1)?.type).toBe('done');
  });

  it('rejects model-selected roots before search', async () => {
    const search = vi.fn<GrepService['search']>();
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValueOnce(sseResponse(openaiToolEvents('grep', {pattern: 'needle', workspaceRoot: '/other'})))
      .mockResolvedValueOnce(sseResponse(openaiEvents));
    const events = await collect(streamChat({model: 'gpt-6.1-sol', messages: [{id: 'user', role: 'user', parts: [{type: 'text', text: 'Find needle'}]}]}, {
      credentials: {openai: 'test'}, fetch, grep: {search},
    }));
    expect(events[2]).toMatchObject({type: 'tool-result', result: {status: 'error', error: {code: 'invalid_input'}}});
    expect(search).not.toHaveBeenCalled();
  });
});
