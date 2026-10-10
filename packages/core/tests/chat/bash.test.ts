import {describe, expect, it, vi} from 'vitest';
import {streamChat, type BashService, type BashOutput} from '../../src/index.js';
import {chatStreamEventSchema, type ChatStreamEvent} from '@codeyantram/shared';
import {asymmetric} from '../../../shared/tests/helpers.js';
import {sseResponse, openaiEvents, openaiToolEvents} from './fixtures.js';

async function collect(stream: AsyncIterable<ChatStreamEvent>) {
  const events: ChatStreamEvent[] = [];
  for await (const event of stream) events.push(chatStreamEventSchema.parse(event));
  return events;
}
const input = {command: 'npm test', timeoutMs: 1000};
const messages = [{id: 'prior', role: 'user' as const, parts: [{type: 'text' as const, text: 'PRIVATE prior task'}]},
  {id: 'latest', role: 'user' as const, parts: [{type: 'text' as const, text: 'Run tests'}]}];
const output: BashOutput = {workdir: '.', stdout: 'failed test', stderr: '', exitCode: 1, signal: null,
  termination: 'exit', durationMs: 1, truncated: false, untrusted: true, warnings: []};

describe('bash provider loop', () => {
  it('registers host-provided execution independently of the graph and passes only the latest objective', async () => {
    const run = vi.fn<BashService['run']>().mockResolvedValue(output);
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValueOnce(sseResponse(openaiToolEvents('bash', input)))
      .mockResolvedValueOnce(sseResponse(openaiEvents));
    const events = await collect(streamChat({model: 'gpt-6.1-sol', messages}, {credentials: {openai: 'test'}, fetch, bash: {run}}));
    expect(events[2]).toMatchObject({type: 'tool-result', result: {toolName: 'bash', status: 'success', output}});
    expect(run).toHaveBeenCalledWith(input, {objective: 'Run tests', abortSignal: asymmetric.any(AbortSignal)});
    expect(events.at(-1)?.type).toBe('done');
  });

  it.each([{workspaceRoot: '/other'}, {approve: true}, {environment: {SECRET: 'value'}}, {evaluate: true}])('rejects model-selected host controls: %j', async extra => {
    const run = vi.fn<BashService['run']>();
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValueOnce(sseResponse(openaiToolEvents('bash', {...input, ...extra})))
      .mockResolvedValueOnce(sseResponse(openaiEvents));
    const events = await collect(streamChat({model: 'gpt-6.1-sol', messages}, {credentials: {openai: 'test'}, fetch, bash: {run}}));
    expect(events[2]).toMatchObject({type: 'tool-result', result: {status: 'error', error: {code: 'invalid_input'}}});
    expect(run).not.toHaveBeenCalled();
  });
});
