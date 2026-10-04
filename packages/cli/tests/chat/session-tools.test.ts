import {describe, expect, it, vi} from 'vitest';
import {chatRequestSchema, compactRequestSchema, type ChatStreamEvent, type MessagePart} from '@codeyantram/shared';
import {ChatSession} from '../../src/chat/session.js';
import {buildChatContext, estimateContextTokens} from '../../src/chat/context.js';
import {planCompaction} from '../../src/chat/compaction.js';
import {toModelMessages} from '../../../core/src/chat/messages.js';

const call: Extract<MessagePart, {type: 'tool-call'}> = {type: 'tool-call', call: {toolCallId: 'c1', toolName: 'explore', input: {query: 'greet'}, providerOptions: {google: {thoughtSignature: 'opaque-signature'}}}};
const result: Extract<MessagePart, {type: 'tool-result'}> = {type: 'tool-result', result: {toolCallId: 'c1', toolName: 'explore', status: 'success', output: {source: 'historical code'}}};
const events: ChatStreamEvent[] = [{type: 'start', messageId: 'a1'}, {type: 'text-delta', text: 'Checking. '}, call, result,
  {type: 'text-delta', text: 'Found it.'}, {type: 'done', durationMs: 1}];

describe('tool-bearing conversation history', () => {
  it('preserves interleaved text, calls, and results and replays assistant/tool roles in order', async () => {
    const transport = vi.fn(async function* () {yield* events;});
    const session = new ChatSession(transport);
    await session.send('Locate greet', 'gpt-6.1-sol');
    const history = session.getSnapshot().messages;
    expect(history[1].parts).toEqual([{type: 'text', text: 'Checking. '}, call, result, {type: 'text', text: 'Found it.'}]);
    const context = buildChatContext(history);
    expect(chatRequestSchema.safeParse({model: 'gpt-6.1-sol', ...context}).success).toBe(true);
    const model = toModelMessages(context);
    expect(model.map(message => message.role)).toEqual(['user', 'assistant', 'tool', 'assistant']);
    expect(model[1].content).toContainEqual({type: 'tool-call', ...call.call});
    expect(model[2]).toMatchObject({role: 'tool', content: [{output: {type: 'json', value: result.result}}]});
    expect(estimateContextTokens(context)).toBeGreaterThan(estimateContextTokens({messages: [history[0]]}));
    const replayedCall = context.messages[1].parts.find(part => part.type === 'tool-call')!;
    if (replayedCall.type !== 'tool-call') throw new Error('Expected a call');
    replayedCall.call.input.query = 'changed replay';
    expect(history[1].parts).toContainEqual(call);
  });

  it('closes interrupted calls for replay without inventing a successful result or altering the transcript', async () => {
    const session = new ChatSession(async function* () {yield {type: 'start', messageId: 'a1'}; yield call;});
    await session.send('Locate greet', 'gpt-6.1-sol');
    expect(session.getSnapshot().messages[1]).toMatchObject({status: 'failed', parts: [call]});
    const history = structuredClone(session.getSnapshot().messages);
    const context = buildChatContext(history);
    expect(context.messages[1].parts.at(-1)).toMatchObject({type: 'tool-result', result: {status: 'error', error: {code: 'cancelled', message: expect.stringContaining('unknown')}}});
    expect(chatRequestSchema.safeParse({model: 'gpt-6.1-sol', ...context}).success).toBe(true);
    expect(history).toEqual(session.getSnapshot().messages);
  });

  it('rejects mismatched or unresolved terminal results instead of accepting corrupt history', async () => {
    for (const stream of [[call, {...result, result: {...result.result, toolCallId: 'other'}}], [call, {type: 'done', durationMs: 1}]]) {
      const session = new ChatSession(async function* () {yield* stream as ChatStreamEvent[];});
      await session.send('Locate greet', 'gpt-6.1-sol');
      expect(session.getSnapshot().messages[1]).toMatchObject({status: 'failed'});
      expect(session.getSnapshot().error).toBeDefined();
    }
  });

  it('includes tool-only history in whole-turn compaction as untrusted historical source data', () => {
    const history = [
      {id: 'u1', role: 'user' as const, parts: [{type: 'text' as const, text: 'Locate greet'}]},
      {id: 'a1', role: 'assistant' as const, parts: [call, {...result, result: {...result.result, status: 'success' as const, output: {source: 'source code\n'.repeat(1000)}}}]},
      ...['u2', 'u3'].map(id => ({id, role: 'user' as const, parts: [{type: 'text' as const, text: 'Continue'}]})),
    ];
    const plan = planCompaction(history);
    expect(plan.type).toBe('ready');
    if (plan.type !== 'ready') throw new Error('Expected eligible history');
    expect(plan.messages[1].parts).toEqual(history[1].parts);
    expect(compactRequestSchema.safeParse({model: 'gpt-6.1-sol', messages: plan.messages}).success).toBe(true);
    expect(plan.coveredMessageCount).toBe(2);
    const plannedCall = plan.messages[1].parts[0];
    if (plannedCall.type !== 'tool-call') throw new Error('Expected a call');
    plannedCall.call.input.query = 'changed summary input';
    expect(history[1].parts[0]).toEqual(call);
  });
});
