import {describe, expect, it, vi} from 'vitest';
import {streamChat, type ApplyPatchService} from '../../src/index.js';
import {chatStreamEventSchema, type ChatStreamEvent} from '@codeyantram/shared';
import {asymmetric} from '../../../shared/tests/helpers.js';
import {sseResponse, openaiEvents, openaiToolEvents} from './fixtures.js';

async function collect(stream: AsyncIterable<ChatStreamEvent>) {
  const events: ChatStreamEvent[] = [];
  for await (const event of stream) events.push(chatStreamEventSchema.parse(event));
  return events;
}
const input = {patchText: '*** Begin Patch\n*** Add File: file.ts\n+new\n*** End Patch', expectedHashes: {}};
const messages = [{id: 'prior', role: 'user' as const, parts: [{type: 'text' as const, text: 'PRIVATE prior task'}]},
  {id: 'latest', role: 'user' as const, parts: [{type: 'text' as const, text: 'Add file'}]}];

describe('apply_patch provider loop', () => {
  it('registers host-provided patches independently of the graph with only the latest objective', async () => {
    const output = {applied: [{filePath: 'file.ts', action: 'add' as const, contentHash: 'a'.repeat(64)}],
      warnings: []};
    const apply = vi.fn<ApplyPatchService['apply']>().mockResolvedValue(output);
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValueOnce(sseResponse(openaiToolEvents('apply_patch', input)))
      .mockResolvedValueOnce(sseResponse(openaiEvents));
    const events = await collect(streamChat({model: 'gpt-6.1-sol', messages}, {credentials: {openai: 'test'}, fetch, applyPatch: {apply}}));
    expect(events[2]).toMatchObject({type: 'tool-result', result: {toolName: 'apply_patch', status: 'success', output}});
    expect(apply).toHaveBeenCalledWith(input, {objective: 'Add file', abortSignal: asymmetric.any(AbortSignal)});
    expect(events.at(-1)?.type).toBe('done');
  });

  it.each([{approve: true, workspaceRoot: '/other'}, {evaluate: false}])('rejects model-selected roots, permission overrides, and removed review controls: %j', async extra => {
    const apply = vi.fn<ApplyPatchService['apply']>();
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValueOnce(sseResponse(openaiToolEvents('apply_patch', {...input, ...extra})))
      .mockResolvedValueOnce(sseResponse(openaiEvents));
    const events = await collect(streamChat({model: 'gpt-6.1-sol', messages}, {credentials: {openai: 'test'}, fetch, applyPatch: {apply}}));
    expect(events[2]).toMatchObject({type: 'tool-result', result: {status: 'error', error: {code: 'invalid_input'}}});
    expect(apply).not.toHaveBeenCalled();
  });

  it('does not advertise mutation without a host capability', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValueOnce(sseResponse(openaiEvents));
    await collect(streamChat({model: 'gpt-6.1-sol', messages}, {credentials: {openai: 'test'}, fetch}));
    const requestBody = fetch.mock.calls[0]?.[1]?.body;
    if (typeof requestBody !== 'string') throw new Error('Expected JSON request body.');
    const body: unknown = JSON.parse(requestBody);
    expect(body).not.toHaveProperty('tools');
  });
});
