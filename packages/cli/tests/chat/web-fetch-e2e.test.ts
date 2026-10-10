import {requireValue, requestBody, asymmetric, parseJson, type EvaluationRequest} from '../../../shared/tests/helpers.js';
import type {readConfig as ReadConfigFunction} from '@codeyantram/shared';
import {Readable} from 'node:stream';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {createJevEvaluator, createWebTransport, streamChat} from '@codeyantram/core';
import {sseResponse, openaiEvents, openaiToolEvents} from '../../../core/tests/chat/fixtures.js';
import {startChatServer} from '../../src/chat/server.js';
import {requestChat} from '../../src/chat/client.js';
import {ChatSession} from '../../src/chat/session.js';

const servers: Awaited<ReturnType<typeof startChatServer>>[] = [];
afterEach(async () => {await Promise.all(servers.splice(0).map(server => server.close()));});

describe('CLI web fetch end to end', () => {
  it('fetches and filters through the server, answers, replays, and honors an unfiltered follow-up', async () => {
    const url = 'https://docs.example.com/api';
    const page = '<h1>API</h1><h2>History</h2>' + '<p>HISTORICAL_NEWS: community newsletters and conference schedules.</p>'.repeat(140)
      + '<h2>Authentication</h2><p>Use Authorization: Bearer TOKEN and rotate credentials.</p>';
    const webTransport = createWebTransport({resolve: async () => [{address: '93.184.216.34', family: 4}], open: async () => ({
      status: 200, headers: {'content-type': 'text/html'}, body: Readable.from([Buffer.from(page)]),
    })});
    const jevFetch = vi.fn<typeof fetch>().mockImplementation(async (_url, init) => {
      const body = parseJson<EvaluationRequest>(requestBody(init?.body));
      expect(body.state.objective).toBe('Read the authentication docs.');
      return Response.json({model: 'fixture-jev', usage: {input_tokens: 200, output_tokens: 4}, answers: Object.fromEntries(
        body.state.chunks.map((chunk: {id: string; sectionPath: string[]}) => [chunk.id, {type: 'noul', noul: chunk.sectionPath.includes('Authentication') ? 0.99 : 0.01}]),
      )});
    });
    const providerFetch = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(sseResponse(openaiToolEvents('web_fetch', {url}, 'filtered')))
      .mockResolvedValueOnce(sseResponse(openaiEvents))
      .mockResolvedValueOnce(sseResponse(openaiToolEvents('web_fetch', {url, filter: false}, 'unfiltered')))
      .mockResolvedValueOnce(sseResponse(openaiEvents));
    const readConfig = vi.fn<typeof ReadConfigFunction>(async () => ({providers: {openai: {apiKey: 'coding-key'}, typesafe: {apiKey: 'evaluation-key'}}, integrations: {jev: {enabled: true}}}));
    const server = await startChatServer({readConfig, webTransport,
      createJevEvaluator: options => createJevEvaluator({...options, fetch: jevFetch}),
      streamChat: (request, options) => streamChat(request, {...options, fetch: providerFetch}),
    }); servers.push(server);
    const session = new ChatSession((request, signal) => requestChat(server.chatUrl, request, signal));
    await session.send('Read the authentication docs.', 'gpt-6.1-sol');
    expect(session.getSnapshot().error).toBeUndefined();
    const first = requireValue(session.getSnapshot().messages[1]);
    if (first.role !== 'assistant') throw new Error('Expected assistant response.');
    expect(first.parts.map(part => part.type)).toEqual(['tool-call', 'tool-result', 'text']);
    expect(first.usage).toMatchObject({inputTokens: 15, outputTokens: 6});
    const result = first.parts.find(part => part.type === 'tool-result');
    expect(result).toMatchObject({result: {status: 'success', output: {filtering: {status: 'completed', usage: {inputTokens: asymmetric.any(Number)}}}}});
    const evidenceRequest = requestBody(requireValue(providerFetch.mock.calls[1])[1]?.body);
    expect(evidenceRequest).toContain('Authorization: Bearer TOKEN');
    expect(evidenceRequest).not.toContain('HISTORICAL');
    const evaluationCalls = jevFetch.mock.calls.length;
    await session.send('Fetch the complete page without filtering.', 'gpt-6.1-sol');
    expect(session.getSnapshot().error).toBeUndefined();
    expect(requestBody(requireValue(providerFetch.mock.calls[2])[1]?.body)).toContain('filtered');
    expect(requestBody(requireValue(providerFetch.mock.calls[3])[1]?.body)).toContain('HISTORICAL');
    expect(jevFetch).toHaveBeenCalledTimes(evaluationCalls);
    expect(readConfig).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(session.getSnapshot().messages)).not.toContain('evaluation-key');
    expect(server.workspaceGraph.getStatus().lifecycle).toBe('unopened');
  });
});
