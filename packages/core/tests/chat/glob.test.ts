import {describe, expect, it, vi} from 'vitest';
import {streamChat, type GlobService} from '../../src/index.js';
import {chatStreamEventSchema, type ChatStreamEvent} from '@codeyantram/shared';
import {asymmetric} from '../../../shared/tests/helpers.js';
import {sseResponse, openaiEvents, openaiToolEvents} from './fixtures.js';

const output = {pattern: '**/*.ts', path: '.', files: ['src/file.ts'], truncated: false, incomplete: false,
  coverage: 'file paths only', untrusted: true as const,
  filtering: {status: 'skipped' as const, mode: 'rank' as const, reason: 'disabled', totalCandidates: 1,
    evaluatedCandidates: 0, retainedCandidates: 1, incomplete: false}, warnings: [],
};
async function collect(stream: AsyncIterable<ChatStreamEvent>) {
  const events: ChatStreamEvent[] = [];
  for await (const event of stream) events.push(chatStreamEventSchema.parse(event));
  return events;
}

describe('glob provider loop', () => {
  it('registers discovery independently of graph tools and passes only the latest objective', async () => {
    const discover = vi.fn<GlobService['discover']>().mockResolvedValue(output);
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValueOnce(sseResponse(openaiToolEvents('glob', {pattern: '**/*.ts', filter: false})))
      .mockResolvedValueOnce(sseResponse(openaiEvents));
    const messages = [{id: 'prior', role: 'user' as const, parts: [{type: 'text' as const, text: 'Private prior task'}]},
      {id: 'latest', role: 'user' as const, parts: [{type: 'text' as const, text: 'Find relevant files'}]}];
    const events = await collect(streamChat({model: 'gpt-6.1-sol', messages}, {credentials: {openai: 'test'}, fetch, glob: {discover}}));
    expect(events[2]).toMatchObject({type: 'tool-result', result: {toolName: 'glob', status: 'success', output}});
    expect(discover).toHaveBeenCalledWith({pattern: '**/*.ts', filter: false}, {objective: 'Find relevant files', abortSignal: asymmetric.any(AbortSignal)});
    expect(events.at(-1)?.type).toBe('done');
  });

  it('rejects model-selected roots before discovery', async () => {
    const discover = vi.fn<GlobService['discover']>();
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValueOnce(sseResponse(openaiToolEvents('glob', {pattern: '*', workspaceRoot: '/other'})))
      .mockResolvedValueOnce(sseResponse(openaiEvents));
    const events = await collect(streamChat({model: 'gpt-6.1-sol', messages: [{id: 'user', role: 'user', parts: [{type: 'text', text: 'Find files'}]}]}, {
      credentials: {openai: 'test'}, fetch, glob: {discover},
    }));
    expect(events[2]).toMatchObject({type: 'tool-result', result: {status: 'error', error: {code: 'invalid_input'}}});
    expect(discover).not.toHaveBeenCalled();
  });
});
