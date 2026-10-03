import {describe, expect, it, vi} from 'vitest';
import type {CompactRequest, CompactStreamEvent} from '@codeyantram/shared';
import {requestCompact} from '../../src/chat/client.js';

const request: CompactRequest = {
	model: 'gpt-6.1-sol', previousSummary: 'Previous working state.',
	messages: [{id: 'u1', role: 'user', parts: [{type: 'text', text: 'Keep /src/chat.ts and port 43187.'}]}],
};
const start: CompactStreamEvent = {type: 'start'};
const done: CompactStreamEvent = {
	type: 'done', summary: 'Objective 👋\nUpdate /src/chat.ts; checks pending.', durationMs: 1,
	usage: {inputTokens: 20, outputTokens: 10, totalTokens: 30},
};
const signal = () => new AbortController().signal;
const frame = (event: unknown) => `data: ${JSON.stringify(event)}\n\n`;

async function collect(events: AsyncIterable<CompactStreamEvent>) {
	const result: CompactStreamEvent[] = [];
	for await (const event of events) result.push(event);
	return result;
}

function streamedResponse(text: string) {
	const bytes = new TextEncoder().encode(text);
	return new Response(new ReadableStream<Uint8Array>({
		start(controller) {
			for (const byte of bytes) controller.enqueue(Uint8Array.of(byte));
			controller.close();
		},
	}), {headers: {'content-type': 'text/event-stream; charset=utf-8'}});
}

describe('compaction streaming client', () => {
	it('decodes split UTF-8, JSON and CRLF, ignores comments, and forwards the exact request', async () => {
		const fetchResponse = vi.fn<typeof fetch>().mockResolvedValue(streamedResponse(
			(': keep-alive\n\n' + frame(start) + frame(done)).replaceAll('\n', '\r\n'),
		));
		const abortSignal = signal();
		expect(await collect(requestCompact('http://localhost/compact', request, abortSignal, fetchResponse))).toEqual([start, done]);
		expect(fetchResponse).toHaveBeenCalledWith('http://localhost/compact', {
			method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify(request), signal: abortSignal,
		});
	});

	it('joins multiline data frames into one event', async () => {
		const fetchResponse = vi.fn<typeof fetch>().mockResolvedValue(streamedResponse(
			'data: {"type":"done",\ndata: "summary":"Working state","durationMs":1}\n\n',
		));
		expect(await collect(requestCompact('http://localhost/compact', request, signal(), fetchResponse)))
			.toEqual([{type: 'done', summary: 'Working state', durationMs: 1}]);
	});

	it.each([
		{...done, summary: ''}, {...done, summary: ' \n '}, {...done, summary: 'x'.repeat(12_001)},
		{...done, durationMs: -1}, {...done, usage: {inputTokens: -1}},
		{type: 'text-delta', text: 'Partial summary'}, {type: 'unknown'},
	])('rejects invalid compact events before returning a summary (case %#)', async event => {
		const fetchResponse = vi.fn<typeof fetch>().mockResolvedValue(streamedResponse(frame(event)));
		await expect(collect(requestCompact('http://localhost/compact', request, signal(), fetchResponse)))
			.rejects.toThrow('The compaction server sent an invalid response.');
	});

	it.each(['data: invalid-json\n\n', frame(start), frame(start) + 'data: {"type":"done"'])('rejects malformed JSON or EOF before a complete terminal event (case %#)', async text => {
		const fetchResponse = vi.fn<typeof fetch>().mockResolvedValue(streamedResponse(text));
		await expect(collect(requestCompact('http://localhost/compact', request, signal(), fetchResponse))).rejects.toThrow(
			text.includes('invalid-json') ? 'invalid response' : 'interrupted',
		);
	});

	it.each(['done', 'error'] as const)('closes the reader after %s without waiting for EOF', async type => {
		const event = type === 'done' ? done : {type: 'error', code: 'compaction_failed', message: 'Unusable summary.'};
		const cancel = vi.fn();
		const response = new Response(new ReadableStream({
			start(controller) {controller.enqueue(new TextEncoder().encode(frame(event) + frame(start)));}, cancel,
		}), {headers: {'content-type': 'text/event-stream'}});
		const fetchResponse = vi.fn<typeof fetch>().mockResolvedValue(response);
		expect(await collect(requestCompact('http://localhost/compact', request, signal(), fetchResponse))).toEqual([event]);
		expect(cancel).toHaveBeenCalledOnce();
	});

	it('forwards a validated JSON error from a failed HTTP request', async () => {
		const error: CompactStreamEvent = {type: 'error', code: 'invalid_request', message: 'Invalid prefix.'};
		const fetchResponse = vi.fn<typeof fetch>().mockResolvedValue(Response.json(error, {status: 400}));
		expect(await collect(requestCompact('http://localhost/compact', request, signal(), fetchResponse))).toEqual([error]);
	});

	it.each([new Response('<html>private details</html>', {status: 502}), Response.json(done, {status: 502})])(
		'rejects invalid HTTP error bodies without exposing private details or accepting a summary (case %#)', async response => {
			const fetchResponse = vi.fn<typeof fetch>().mockResolvedValue(response);
			await expect(collect(requestCompact('http://localhost/compact', request, signal(), fetchResponse)))
				.rejects.toThrow('The compaction request failed (HTTP 502).');
		},
	);

	it('rejects successful non-SSE responses', async () => {
		const fetchResponse = vi.fn<typeof fetch>().mockResolvedValue(Response.json(done));
		await expect(collect(requestCompact('http://localhost/compact', request, signal(), fetchResponse))).rejects.toThrow('did not return an event stream');
	});

	it('reports a useful connection failure instead of raw fetch details', async () => {
		const fetchResponse = vi.fn<typeof fetch>().mockRejectedValue(new Error('private connection details'));
		await expect(collect(requestCompact('http://localhost/compact', request, signal(), fetchResponse)))
			.rejects.toThrow('Could not reach the compaction server. Restart the CLI and try again.');
	});

	it('does not send an already cancelled request', async () => {
		const fetchResponse = vi.fn<typeof fetch>();
		await expect(collect(requestCompact('http://localhost/compact', request, AbortSignal.abort(), fetchResponse)))
			.rejects.toMatchObject({name: 'AbortError'});
		expect(fetchResponse).not.toHaveBeenCalled();
	});

	it('preserves cancellation when fetch rejects', async () => {
		const controller = new AbortController();
		const fetchResponse = vi.fn<typeof fetch>().mockImplementation(async () => {
			controller.abort();
			throw new DOMException('Aborted', 'AbortError');
		});
		await expect(collect(requestCompact('http://localhost/compact', request, controller.signal, fetchResponse)))
			.rejects.toMatchObject({name: 'AbortError'});
	});

	it('cancels a pending reader even when an injected fetch does not observe the signal', async () => {
		const controller = new AbortController();
		const cancel = vi.fn();
		const response = new Response(new ReadableStream({
			start(stream) {stream.enqueue(new TextEncoder().encode(frame(start)));}, cancel,
		}), {headers: {'content-type': 'text/event-stream'}});
		const fetchResponse = vi.fn<typeof fetch>().mockResolvedValue(response);
		const stream = requestCompact('http://localhost/compact', request, controller.signal, fetchResponse);
		expect((await stream.next()).value).toEqual(start);
		const pending = stream.next();
		controller.abort();
		await expect(pending).rejects.toMatchObject({name: 'AbortError'});
		expect(cancel).toHaveBeenCalledOnce();
		expect(response.body!.locked).toBe(false);
	});

	it('reports a failed reader as an interrupted response', async () => {
		const response = new Response(new ReadableStream({start(stream) {stream.error(new Error('private read error'));}}), {
			headers: {'content-type': 'text/event-stream'},
		});
		const fetchResponse = vi.fn<typeof fetch>().mockResolvedValue(response);
		await expect(collect(requestCompact('http://localhost/compact', request, signal(), fetchResponse)))
			.rejects.toThrow('The compaction response was interrupted. Try again.');
	});

	it('cancels the reader when its consumer stops after start', async () => {
		const cancel = vi.fn();
		const response = new Response(new ReadableStream({
			start(stream) {stream.enqueue(new TextEncoder().encode(frame(start)));}, cancel,
		}), {headers: {'content-type': 'text/event-stream'}});
		const fetchResponse = vi.fn<typeof fetch>().mockResolvedValue(response);
		for await (const _event of requestCompact('http://localhost/compact', request, signal(), fetchResponse)) break;
		expect(cancel).toHaveBeenCalledOnce();
		expect(response.body!.locked).toBe(false);
	});
});
