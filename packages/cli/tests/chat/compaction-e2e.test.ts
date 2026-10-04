import {requireTextPart} from '../helpers/message-parts.js';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {compactChat, streamChat} from '@codeyantram/core';
import {formatContextSummary, toRequestMessage, type CompactRequest} from '@codeyantram/shared';
import {anthropicEvents, googleEvents, openaiEvents, sseResponse, summaryResponse} from '../../../core/tests/chat/fixtures.js';
import {compactionEvaluationChecklist, compactionScenario} from '../../../core/tests/chat/compaction-scenario.js';
import {requestChat, requestCompact} from '../../src/chat/client.js';
import {buildChatContext, measureContextBytes} from '../../src/chat/context.js';
import {startChatServer} from '../../src/chat/server.js';
import {ChatSession} from '../../src/chat/session.js';

const servers: Awaited<ReturnType<typeof startChatServer>>[] = [];
afterEach(async () => {await Promise.all(servers.splice(0).map(server => server.close()));});

// Use the actual SDK adapters, replacing only outbound HTTP. Adjacent user
// blocks may be merged by Anthropic; compare ordered text blocks, not messages.
function wireText(body: Record<string, any>): string[] {
  if (body.input) return body.input.flatMap((message: any) =>
    typeof message.content === 'string' ? [message.content] : message.content.map((part: any) => part.text));
  if (body.messages) return body.messages.flatMap((message: any) => message.content.map((part: any) => part.text));
  return body.contents.flatMap((message: any) => message.parts.map((part: any) => part.text));
}

describe('compaction end-to-end regressions', () => {
  it.each([
    ['gpt-6.1-sol', 'claude-sonnet-5-5'],
    ['claude-sonnet-5-5', 'gemini-3.8-flash'],
    ['gemini-3.8-flash', 'gpt-6.1-sol'],
  ])('preserves context across compaction, provider switching, refresh and rollback (%s → %s)', async (model, nextModel) => {
    const compactRequests: CompactRequest[] = [];
    const providerBodies: Record<string, any>[] = [];
    let summaryIndex = 0;
    let failedRefresh = false;
    const providerFetch = vi.fn<typeof fetch>().mockImplementation(async (url, init) => {
      const body = JSON.parse(String(init?.body));
      providerBodies.push(body);
      const google = String(url).includes('generativelanguage.googleapis.com');
      const providerModel = google ? 'gemini-3.8-flash' : body.model;
      if (!body.stream && !String(url).includes(':streamGenerateContent')) {
        const text = summaryIndex++ === 0 ? compactionScenario.summary : compactionScenario.refreshedSummary;
        return summaryResponse(providerModel, text, failedRefresh ? 'length' : 'stop');
      }
      const base = google ? googleEvents : providerModel.startsWith('claude-') ? anthropicEvents : openaiEvents;
      const text = compactionScenario.turns[chatCalls]?.assistant ?? 'Continue from the retained context.';
      chatCalls++;
      const events = structuredClone(base).filter((event: any) =>
        event.type !== 'response.output_text.delta' || event.delta === 'Hello');
      for (const event of events as any[]) {
        if (event.type === 'response.output_text.delta') event.delta = text;
        if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') event.delta.text = event.delta.text === 'Hello' ? text : '';
        if (event.candidates) event.candidates[0].content.parts[0].text = event.candidates[0].content.parts[0].text === 'Hello' ? text : '';
      }
      return sseResponse(events);
    });
    let chatCalls = 0;
    const server = await startChatServer({
      readConfig: async () => ({providers: {
        openai: {apiKey: 'fixture-openai'}, anthropic: {apiKey: 'fixture-anthropic'}, google: {apiKey: 'fixture-google'},
      }}),
      streamChat: (request, options) => streamChat(request, {...options, fetch: providerFetch}),
      compactChat: (request, options) => {
        compactRequests.push(structuredClone(request));
        return compactChat(request, {...options, fetch: providerFetch});
      },
    });
    servers.push(server);
    const session = new ChatSession(
      (request, signal) => requestChat(server.chatUrl, request, signal),
      (request, signal) => requestCompact(server.compactUrl, request, signal),
    );
    for (const turn of compactionScenario.turns) {
      await session.send(turn.user, model, 'high');
      expect(session.getSnapshot().error).toBeUndefined();
      expect(session.getSnapshot().messages.at(-1)?.parts.map(requireTextPart)[0]?.text).toBe(turn.assistant);
    }
    const transcript = session.getSnapshot().messages;
    const original = structuredClone(transcript);
    const beforeBytes = measureContextBytes(buildChatContext(transcript));
    expect(await session.compact(model)).toEqual({type: 'success'});
    expect(session.getSnapshot().messages).toBe(transcript);
    const afterBytes = measureContextBytes(buildChatContext(transcript, session.getSnapshot().compaction));
    expect(afterBytes).toBeLessThan(beforeBytes * 0.8);
    // This checklist validates our hand-authored fixture, not model quality.
    for (const item of compactionEvaluationChecklist) {
      for (const literal of item.literals) expect(session.getSnapshot().compaction?.summary, item.criterion).toContain(literal);
    }
    expect(compactRequests[0]!.messages.map(message => message.parts.map(requireTextPart)[0]?.text)).toEqual(
      transcript.slice(0, 4).map(message => message.parts.map(requireTextPart)[0]?.text),
    );
    expect(await session.compact(model)).toEqual({type: 'noop', reason: 'no-eligible-messages'});
    expect(compactRequests).toHaveLength(1);

    await session.send('Continue reviewing ordering; deployment remains prohibited.', nextModel, 'high');
    expect(session.getSnapshot().error).toBeUndefined();
    expect(wireText(providerBodies.at(-1)!)).toEqual([
      formatContextSummary(compactionScenario.summary),
      ...transcript.slice(4).flatMap(message => message.parts.map(part => part.type === 'text' ? part.text : JSON.stringify(part))),
      'Continue reviewing ordering; deployment remains prohibited.',
    ]);
    expect(await session.compact(nextModel)).toEqual({type: 'success'});
    expect(compactRequests[1]).toEqual({
      model: nextModel, previousSummary: compactionScenario.summary,
      messages: transcript.slice(4, 6).map(message => ({...toRequestMessage(message),
        ...(message.role === 'assistant' ? {status: 'complete'} : {}),
      })),
    });
    expect(session.getSnapshot().compaction).toMatchObject({generation: 2, coveredMessageCount: 6, model: nextModel});
    expect(session.getSnapshot().compactionUsage?.completedCalls).toBe(2);
    expect(session.getSnapshot().messages.slice(0, 8)).toEqual(original);

    // Make newly eligible context large enough to attempt a third compaction.
    await session.send(compactionScenario.turns[0].user + '\n' + compactionScenario.turns[0].assistant, nextModel);
    await session.send('Finish docs after checks.', nextModel);
    await session.send('Keep the API stable.', nextModel);
    const previous = session.getSnapshot();
    failedRefresh = true;
    expect((await session.compact(nextModel)).type).toBe('failed');
    expect(session.getSnapshot().error).toContain('complete, usable');
    expect(session.getSnapshot().compaction).toBe(previous.compaction);
    expect(session.getSnapshot().compactionUsage).toBe(previous.compactionUsage);
    expect(session.getSnapshot().messages).toBe(previous.messages);
    await session.send('Continue using the last good summary.', model);
    expect(session.getSnapshot().error).toBeUndefined();
    expect(wireText(providerBodies.at(-1)!)).toEqual([
      formatContextSummary(compactionScenario.refreshedSummary),
      ...previous.messages.slice(6).flatMap(message => message.parts.map(part => part.type === 'text' ? part.text : JSON.stringify(part))),
      'Continue using the last good summary.',
    ]);
    session.clear();
    await session.send('New session.', model);
    expect(wireText(providerBodies.at(-1)!)).toEqual(['New session.']);
  });
});
