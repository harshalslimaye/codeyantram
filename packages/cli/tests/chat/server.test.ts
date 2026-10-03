import {afterEach, describe, expect, it, vi} from 'vitest';
import type {streamChat} from '@codeyantram/core';
import {startChatServer} from '../../src/chat/server.js';
import {requestChat} from '../../src/chat/client.js';
import {ChatSession} from '../../src/chat/session.js';

const servers: Awaited<ReturnType<typeof startChatServer>>[] = [];
afterEach(async () => {await Promise.all(servers.splice(0).map(server => server.close()));});

async function start(options: Parameters<typeof startChatServer>[0]) {
	const server = await startChatServer(options);
	servers.push(server);
	return server;
}

describe('CLI-owned chat server', () => {
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
		expect(other.url).not.toBe(server.url);
		const session = new ChatSession((request, signal) => requestChat(server.url, request, signal));
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
		const session = new ChatSession((request, signal) => requestChat(server.url, request, signal));
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
		const session = new ChatSession((request, signal) => requestChat(server.url, request, signal));
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
