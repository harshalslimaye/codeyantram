import {describe, expect, it, vi} from 'vitest';
import type {ChatRequest, ChatStreamEvent} from '@codeyantram/shared';
import {requestChat} from '../../src/chat/client.js';

const request: ChatRequest = {
	model: 'gpt-6.1-sol', effort: 'high',
	messages: [{id: 'user-1', role: 'user', parts: [{type: 'text', text: 'Hello'}]}],
};
const start: ChatStreamEvent = {type: 'start', messageId: 'assistant-1'};
const done: ChatStreamEvent = {type: 'done', durationMs: 1};
const signal = () => new AbortController().signal;
const frame = (event: ChatStreamEvent) => `data: ${JSON.stringify(event)}\n\n`;

async function collect(events: AsyncIterable<ChatStreamEvent>) {
	const result: ChatStreamEvent[] = [];
	for await (const event of events) result.push(event);
	return result;
}

function streamedResponse(text: string) {
	const bytes = new TextEncoder().encode(text);
	return new Response(new ReadableStream<Uint8Array>({
		start(controller) {
			// Splitting every byte also splits UTF-8 characters and CRLF boundaries.
			for (const byte of bytes) controller.enqueue(Uint8Array.of(byte));
			controller.close();
		},
	}), {headers: {'content-type': 'text/event-stream; charset=utf-8'}});
}

describe('chat streaming client', () => {
	it('decodes split UTF-8, JSON, CRLF frames, and ignores heartbeat comments', async () => {
		const delta: ChatStreamEvent = {type: 'text-delta', text: 'Hello 👋\nworld'};
		const events = [start, delta, done];
		const fetchResponse = vi.fn<typeof fetch>().mockResolvedValue(streamedResponse(
			(': keep-alive\n\n' + events.map(frame).join('')).replaceAll('\n', '\r\n'),
		));
		const abortSignal = signal();
		expect(await collect(requestChat('http://localhost/chat', request, abortSignal, fetchResponse))).toEqual(events);
		expect(fetchResponse).toHaveBeenCalledWith('http://localhost/chat', {
			method: 'POST', headers: {'content-type': 'application/json'},
			body: JSON.stringify(request), signal: abortSignal,
		});
	});

	it('joins multiple data lines into a single JSON event', async () => {
		const fetchResponse = vi.fn<typeof fetch>().mockResolvedValue(streamedResponse(
			'data: {"type":"done",\ndata: "durationMs":1}\n\n',
		));
		expect(await collect(requestChat('http://localhost/chat', request, signal(), fetchResponse))).toEqual([done]);
	});

	it.each(['data: invalid-json\n\n', 'data: {"type":"unknown"}\n\n'])('rejects malformed events: %s', async text => {
		const fetchResponse = vi.fn<typeof fetch>().mockResolvedValue(streamedResponse(text));
		await expect(collect(requestChat('http://localhost/chat', request, signal(), fetchResponse)))
			.rejects.toThrow('invalid response');
	});

	it('reports EOF before a terminal event as an interrupted response', async () => {
		const fetchResponse = vi.fn<typeof fetch>().mockResolvedValue(streamedResponse(frame(start)));
		await expect(collect(requestChat('http://localhost/chat', request, signal(), fetchResponse)))
			.rejects.toThrow('interrupted');
	});

	it('cancels the reader after a terminal event without waiting for EOF', async () => {
		const cancel = vi.fn();
		const response = new Response(new ReadableStream({
			start(controller) {controller.enqueue(new TextEncoder().encode(frame(done)));}, cancel,
		}), {headers: {'content-type': 'text/event-stream'}});
		const fetchResponse = vi.fn<typeof fetch>().mockResolvedValue(response);
		expect(await collect(requestChat('http://localhost/chat', request, signal(), fetchResponse))).toEqual([done]);
		expect(cancel).toHaveBeenCalledOnce();
	});

	it('forwards the sanitized JSON error on a failed HTTP request', async () => {
		const error: ChatStreamEvent = {type: 'error', code: 'invalid_request', message: 'The request body is invalid.'};
		const fetchResponse = vi.fn<typeof fetch>().mockResolvedValue(Response.json(error, {status: 400}));
		expect(await collect(requestChat('http://localhost/chat', request, signal(), fetchResponse))).toEqual([error]);
	});

	it('does not display raw HTML from a failed HTTP request', async () => {
		const fetchResponse = vi.fn<typeof fetch>().mockResolvedValue(new Response('<html>private details</html>', {status: 502}));
		await expect(collect(requestChat('http://localhost/chat', request, signal(), fetchResponse)))
			.rejects.toThrow('The chat request failed (HTTP 502).');
	});

	it('rejects a successful response that is not SSE', async () => {
		const fetchResponse = vi.fn<typeof fetch>().mockResolvedValue(Response.json({}));
		await expect(collect(requestChat('http://localhost/chat', request, signal(), fetchResponse)))
			.rejects.toThrow('did not return an event stream');
	});

	it('gives a useful message when the server cannot be reached', async () => {
		const fetchResponse = vi.fn<typeof fetch>().mockRejectedValue(new TypeError('fetch failed'));
		await expect(collect(requestChat('http://localhost/chat', request, signal(), fetchResponse)))
			.rejects.toThrow('Could not reach the chat server');
	});

	it('does not send an already cancelled request', async () => {
		const fetchResponse = vi.fn<typeof fetch>();
		await expect(collect(requestChat('http://localhost/chat', request, AbortSignal.abort(), fetchResponse)))
			.rejects.toMatchObject({name: 'AbortError'});
		expect(fetchResponse).not.toHaveBeenCalled();
	});
});
