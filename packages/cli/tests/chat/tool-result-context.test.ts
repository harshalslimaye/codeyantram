import {describe, expect, it, vi} from 'vitest';
import {streamChat} from '@codeyantram/core';
import {type ChatRequest, type RequestMessage} from '@codeyantram/shared';
import {ChatSession} from '../../src/chat/session.js';
import {buildChatContext, getContextStatus, measureContextBytes} from '../../src/chat/context.js';
import {chatMarkdown} from '../../src/chat/export.js';
import {history, readResult, OMITTED_MARKER} from '../../../shared/tests/chat/tool-result-fixtures.js';
import {sseResponse, openaiEvents} from '../../../core/tests/chat/fixtures.js';
import {requestBody} from '../../../shared/tests/helpers.js';

describe('transcript storage and projected context', () => {
  it('estimates complete history when trimming is disabled for a tool-free agent', () => {
    const messages = history();
    const enabled = getContextStatus('gpt-6.1-sol', messages);
    const disabled = getContextStatus('gpt-6.1-sol', messages, undefined, {toolResultTrimming: false});
    expect(enabled.trimmedToolResults).toBe(1);
    expect(disabled.trimmedToolResults).toBeUndefined();
    expect(disabled.usedTokens).toBeGreaterThan(enabled.usedTokens);
  });

  it('keeps complete results in session, outgoing API requests and exports while core trims provider input', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(async () => sseResponse(openaiEvents));
    const requests: ChatRequest[] = [];
    const raw = readResult();
    const session = new ChatSession(async function* (request, signal) {
      requests.push(structuredClone(request));
      if (requests.length === 1) {
        yield {type: 'tool-call', call: {toolCallId: raw.toolCallId, toolName: raw.toolName, input: {filePath: 'src/large.ts'}}};
        yield {type: 'tool-result', result: raw};
        yield {type: 'done', durationMs: 1};
      } else yield* streamChat(request, {credentials: {openai: 'fixture'}, fetch, abortSignal: signal});
    });
    await session.send('Read source', 'gpt-6.1-sol');
    await session.send('Continue', 'gpt-6.1-sol');
    await session.send('Explain older evidence', 'gpt-6.1-sol');
    const transcript = session.getSnapshot().messages;
    expect(JSON.stringify(transcript)).toContain(OMITTED_MARKER);
    expect(JSON.stringify(requests.at(-1))).toContain(OMITTED_MARKER);
    expect(requestBody(fetch.mock.calls.at(-1)?.[1]?.body)).not.toContain(OMITTED_MARKER);
    expect(chatMarkdown(transcript)).toContain(OMITTED_MARKER);
    const context = buildChatContext(transcript);
    expect(JSON.stringify(context)).toContain(OMITTED_MARKER);
    const status = getContextStatus('gpt-6.1-sol', transcript);
    expect(status.trimmedToolResults).toBe(1);
    expect(status.rawContextBytes).toBe(measureContextBytes(context));
    expect(status.projectedContextBytes).toBeLessThan(status.rawContextBytes ?? 0);
  });

  it('keeps full results in manual compaction input and full transcript after committing a summary', async () => {
    let sequence = 0;
    const compacted: RequestMessage[][] = [];
    const session = new ChatSession(async function* () {
      const result = readResult(`read-${++sequence}`);
      yield {type: 'tool-call', call: {toolCallId: result.toolCallId, toolName: 'read', input: {filePath: 'src/large.ts'}}};
      yield {type: 'tool-result', result};
      yield {type: 'done', durationMs: 1};
    }, async function* (request) {
      compacted.push(request.messages);
      yield {type: 'done', summary: 'Read src/large.ts; exact source details may require another read.', durationMs: 1};
    });
    for (let turn = 0; turn < 4; turn++) await session.send(`Task ${turn}`, 'gpt-6.1-sol');
    const original = structuredClone(session.getSnapshot().messages);
    expect(await session.compact('gpt-6.1-sol')).toEqual({type: 'success'});
    expect(JSON.stringify(compacted)).toContain(OMITTED_MARKER);
    expect(session.getSnapshot().messages).toEqual(original);
    const context = buildChatContext(original, session.getSnapshot().compaction);
    expect(context.messages).toHaveLength(4);
    expect(context.contextSummary).toContain('src/large.ts');
  });
});
