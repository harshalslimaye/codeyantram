import {afterEach, describe, expect, it, vi} from 'vitest';
import type {compactChat, streamChat} from '@codeyantram/core';
import type {CompactRequest, CompactStreamEvent} from '@codeyantram/shared';
import {startChatServer} from '../../src/chat/server.js';
import {requestChat, requestCompact} from '../../src/chat/client.js';
import {ChatSession} from '../../src/chat/session.js';

const servers: Awaited<ReturnType<typeof startChatServer>>[] = [];
const compactRequest: CompactRequest = {
	model: 'gpt-6.1-sol', previousSummary: 'Earlier objective.',
	messages: [{id: 'old-u1', role: 'user', parts: [{type: 'text', text: 'Archived prefix.'}]}],
};
const compactDone: CompactStreamEvent = {type: 'done', summary: 'Portable working summary 👋', durationMs: 1, usage: {inputTokens: 30}};
afterEach(async () => {await Promise.all(servers.splice(0).map(server => server.close()));});

async function start(options: Parameters<typeof startChatServer>[0]) {
	const server = await startChatServer(options);
	servers.push(server);
	return server;
}

describe('CLI-owned chat server', () => {
	it('exposes sibling endpoints and round-trips a compact result before a normal chat request', async () => {
		const compact = vi.fn<typeof compactChat>().mockImplementation(async function* () {
			yield {type: 'start'};
			yield compactDone;
		});
		const chat = vi.fn<typeof streamChat>().mockImplementation(async function* () {
			yield {type: 'start', messageId: 'assistant-1'};
			yield {type: 'done', durationMs: 1};
		});
		const server = await start({
			readConfig: async () => ({providers: {openai: {apiKey: 'test-openai'}, google: {apiKey: 'test-google'}}}),
			compactChat: compact, streamChat: chat,
		});
		expect(server.chatUrl).toBe(new URL('/chat', server.baseUrl).href);
		expect(server.compactUrl).toBe(new URL('/compact', server.baseUrl).href);
		const events: CompactStreamEvent[] = [];
		for await (const event of requestCompact(server.compactUrl, compactRequest, new AbortController().signal)) events.push(event);
		expect(events).toEqual([{type: 'start'}, compactDone]);
		expect(compact).toHaveBeenCalledWith(compactRequest, {credentials: {openai: 'test-openai'}, abortSignal: expect.any(AbortSignal)});
		const result = events.at(-1)!;
		if (result.type !== 'done') throw new Error('Expected a completed summary');
		const followUp = {
			model: 'gemini-3.8-flash', contextSummary: result.summary,
			messages: [{id: 'recent-u1', role: 'user' as const, parts: [{type: 'text' as const, text: 'Retained tail and next question.'}]}],
		};
		for await (const _event of requestChat(server.chatUrl, followUp, new AbortController().signal)) { /* consume */ }
		expect(chat.mock.calls[0]![0]).toEqual(followUp);
		expect(chat.mock.calls[0]![1].credentials).toEqual({google: 'test-google'});
	});

	it('propagates CLI compaction cancellation to the server-side operation', async () => {
		const aborted = vi.fn();
		const server = await start({readConfig: async () => ({}), compactChat: async function* (_request, options) {
			yield {type: 'start'};
			await new Promise<void>(resolve => {
				const stop = () => {aborted(); resolve();};
				if (options.abortSignal!.aborted) stop();
				else options.abortSignal!.addEventListener('abort', stop, {once: true});
			});
		}});
		const controller = new AbortController();
		const stream = requestCompact(server.compactUrl, compactRequest, controller.signal);
		expect((await stream.next()).value).toEqual({type: 'start'});
		const pending = stream.next();
		controller.abort();
		await expect(pending).rejects.toMatchObject({name: 'AbortError'});
		await vi.waitFor(() => expect(aborted).toHaveBeenCalledOnce());
	});

	it('aborts compaction when its owner shuts down and reports the interruption', async () => {
		const aborted = vi.fn();
		const server = await start({readConfig: async () => ({}), compactChat: async function* (_request, options) {
			yield {type: 'start'};
			await new Promise<void>(resolve => {
				const stop = () => {aborted(); resolve();};
				if (options.abortSignal!.aborted) stop();
				else options.abortSignal!.addEventListener('abort', stop, {once: true});
			});
		}});
		const stream = requestCompact(server.compactUrl, compactRequest, new AbortController().signal);
		expect((await stream.next()).value).toEqual({type: 'start'});
		const pending = stream.next();
		const interrupted = expect(pending).rejects.toThrow('The compaction response was interrupted. Try again.');
		servers.splice(servers.indexOf(server), 1);
		await server.close();
		await interrupted;
		await vi.waitFor(() => expect(aborted).toHaveBeenCalledOnce());
	});

	it('uses separate ports for concurrent CLIs and sends history and only the selected key', async () => {
		let turn = 0;
		const stream = vi.fn<typeof streamChat>().mockImplementation(async function* () {
			yield {type: 'start', messageId: `assistant-${++turn}`};
			yield {type: 'text-delta', text: 'Answer 👋'};
			yield {type: 'done', durationMs: 1, usage: {inputTokens: 1}};
		});
		const server = await start({
			readConfig: async () => ({providers: {openai: {apiKey: 'test-openai'}, google: {apiKey: 'test-google'}}}),
			streamChat: stream,
		});
		const other = await start({readConfig: async () => ({})});
		expect(other.baseUrl).not.toBe(server.baseUrl);
		const session = new ChatSession((request, signal) => requestChat(server.chatUrl, request, signal));
		await session.send('Hi', 'gpt-6.1-sol', 'high');
		await session.send('Follow up', 'gemini-3.8-flash', 'low');
		expect(session.getSnapshot().error).toBeUndefined();
		expect(session.getSnapshot().messages).toHaveLength(4);
		expect(stream.mock.calls[1]![0]).toMatchObject({model: 'gemini-3.8-flash', effort: 'low'});
		expect(stream.mock.calls[1]![0].messages.map(message => message.parts[0]?.text)).toEqual(['Hi', 'Answer 👋', 'Follow up']);
		expect(stream.mock.calls[1]![0].messages[1]).not.toHaveProperty('usage');
		expect(stream.mock.calls[0]![1].credentials).toEqual({openai: 'test-openai'});
		expect(stream.mock.calls[1]![1].credentials).toEqual({google: 'test-google'});
	});

	it('cancels the server-side generation when the CLI cancels a request', async () => {
		const aborted = vi.fn();
		const server = await start({
			readConfig: async () => ({}),
			streamChat: async function* (_request, options) {
				yield {type: 'start', messageId: 'assistant-1'};
				yield {type: 'text-delta', text: 'Partial answer'};
				await new Promise<void>(resolve => {
					options.abortSignal!.addEventListener('abort', () => {aborted(); resolve();}, {once: true});
				});
			},
		});
		const session = new ChatSession((request, signal) => requestChat(server.chatUrl, request, signal));
		const sending = session.send('Hi', 'gpt-6.1-sol');
		await vi.waitFor(() => expect(session.getSnapshot().messages.at(-1)?.parts[0]?.text).toBe('Partial answer'));
		session.cancel();
		await sending;
		await vi.waitFor(() => expect(aborted).toHaveBeenCalledOnce());
		expect(session.getSnapshot().isStreaming).toBe(false);
		expect(session.getSnapshot().error).toBeUndefined();
	});

	it('closes active requests and cancels generation when its owner shuts down', async () => {
		const aborted = vi.fn();
		const server = await start({
			readConfig: async () => ({}),
			streamChat: async function* (_request, options) {
				yield {type: 'start', messageId: 'assistant-1'};
				yield {type: 'text-delta', text: 'Partial answer'};
				await new Promise<void>(resolve => {
					options.abortSignal!.addEventListener('abort', () => {aborted(); resolve();}, {once: true});
				});
			},
		});
		const session = new ChatSession((request, signal) => requestChat(server.chatUrl, request, signal));
		const sending = session.send('Hi', 'gpt-6.1-sol');
		await vi.waitFor(() => expect(session.getSnapshot().messages.at(-1)?.parts[0]?.text).toBe('Partial answer'));
		servers.splice(servers.indexOf(server), 1);
		await server.close();
		await sending;
		await vi.waitFor(() => expect(aborted).toHaveBeenCalledOnce());
		expect(session.getSnapshot().error).toContain('interrupted');
		expect(session.getSnapshot().isStreaming).toBe(false);
	});
});
