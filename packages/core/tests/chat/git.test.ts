import {describe, expect, it, vi} from 'vitest';
import {streamChat, type GitService} from '../../src/index.js';
import {chatStreamEventSchema, type ChatStreamEvent} from '@codeyantram/shared';
import {asymmetric} from '../../../shared/tests/helpers.js';
import {sseResponse, openaiEvents, openaiToolEvents} from './fixtures.js';

const output = {entries: [' M alpha.txt'], truncated: false, incomplete: false,
  coverage: 'snapshot', untrusted: true as const,
  filtering: {status: 'skipped' as const, mode: 'rank' as const, reason: 'disabled', totalCandidates: 1,
    evaluatedCandidates: 0, retainedCandidates: 1, incomplete: false}, warnings: [],
};

async function collect(stream: AsyncIterable<ChatStreamEvent>) {
  const events: ChatStreamEvent[] = [];
  for await (const event of stream) events.push(chatStreamEventSchema.parse(event));
  return events;
}

describe('Git provider loop', () => {
  it('registers read-only Git tools and passes the latest objective', async () => {
    const status = vi.fn<GitService['status']>().mockResolvedValue(output);
    const diff = vi.fn<GitService['diff']>();
    const log = vi.fn<GitService['log']>();
    const show = vi.fn<GitService['show']>();
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValueOnce(sseResponse(openaiToolEvents('git_status', {filter: false})))
      .mockResolvedValueOnce(sseResponse(openaiEvents));
    const messages = [{id: 'prior', role: 'user' as const, parts: [{type: 'text' as const, text: 'Prior objective'}]},
      {id: 'latest', role: 'user' as const, parts: [{type: 'text' as const, text: 'Inspect changes'}]}];
    const events = await collect(streamChat({model: 'gpt-6.1-sol', messages}, {
      credentials: {openai: 'test'}, fetch, git: {status, diff, log, show},
    }));
    expect(events[2]).toMatchObject({type: 'tool-result', result: {toolName: 'git_status', status: 'success', output}});
    expect(status).toHaveBeenCalledWith({filter: false}, {objective: 'Inspect changes', abortSignal: asymmetric.any(AbortSignal)});
    expect(events.at(-1)?.type).toBe('done');
  });
});
