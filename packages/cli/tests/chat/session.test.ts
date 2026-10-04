import {describe, expect, it, vi} from 'vitest';
import type {ChatStreamEvent} from '@codeyantram/shared';
import {ChatSession, type ChatTransport, type CompactTransport} from '../../src/chat/session.js';

const done: ChatStreamEvent = {type: 'done', durationMs: 1, usage: {inputTokens: 3, outputTokens: 2}};

function successfulTransport() {
	return vi.fn<ChatTransport>().mockImplementation(async function* () {
		yield {type: 'start', messageId: 'assistant-1'};
		yield {type: 'text-delta', text: 'Hello'};
		yield {type: 'text-delta', text: ' world'};
		yield done;
	});
}

describe('chat session', () => {
	it('captures immutable UI-only status snapshots between turns and clears them with history', async () => {
		const transport = successfulTransport();
		const session = new ChatSession(transport);
		session.showStatus('gemma-4-31b-it');
		const first = structuredClone(session.getSnapshot().statusEntries[0]!);
		expect(first).toMatchObject({afterMessageCount: 0, status: {modelId: 'gemma-4-31b-it', usedTokens: 0}});
		expect(transport).not.toHaveBeenCalled();
		await session.send('Hi', 'gemma-4-31b-it');
		session.showStatus('gpt-6.1-sol');
		expect(session.getSnapshot().statusEntries[0]).toEqual(first);
		expect(session.getSnapshot().statusEntries[1]).toMatchObject({afterMessageCount: 2, status: {modelId: 'gpt-6.1-sol'}});
		expect(session.getSnapshot().statusEntries[1]!.status.usedTokens).toBeGreaterThan(0);
		await session.send('Follow up', 'gpt-6.1-sol');
		expect(transport.mock.calls[1]![0].messages.map(message => message.parts[0]?.text)).toEqual(['Hi', 'Hello world', 'Follow up']);
		expect(session.getSnapshot().messages).toHaveLength(4);
		session.clear();
		expect(session.getSnapshot().statusEntries).toEqual([]);
	});

	it('updates context status after compaction without sending status cards to the summarizer', async () => {
		const compact = vi.fn<CompactTransport>().mockImplementation(async function* () {
			yield {type: 'done', summary: 'Preserve the original objective.', durationMs: 1};
		});
		const session = new ChatSession(successfulTransport(), compact);
		await session.send('Original task and constraints. '.repeat(1_000), 'gemma-4-31b-it');
		await session.send('Recent question.', 'gemma-4-31b-it');
		await session.send('Latest question.', 'gemma-4-31b-it');
		session.showStatus('gemma-4-31b-it');
		const before = structuredClone(session.getSnapshot().statusEntries[0]!);
		expect(await session.compact('gemma-4-31b-it')).toEqual({type: 'success'});
		expect(compact.mock.calls[0]![0].messages).toHaveLength(2);
		session.showStatus('gemma-4-31b-it');
		const entries = session.getSnapshot().statusEntries;
		expect(entries[0]).toEqual(before);
		expect(entries[1]!.status.usedTokens).toBeLessThan(before.status.usedTokens);
		expect(entries[1]!.status.remainingPercent).toBeGreaterThan(before.status.remainingPercent);
	});

	it('updates partial text and sends history without usage on follow-up turns', async () => {
		const transport = successfulTransport();
		const session = new ChatSession(transport);
		const updates: string[] = [];
		const unsubscribe = session.subscribe(() => {
			updates.push(session.getSnapshot().messages.at(-1)?.parts.map(part => part.text).join('') ?? '');
		});
		await session.send('  Hi  ', 'gpt-6.1-sol', 'high');
		expect(updates).toContain('Hello');
		expect(session.getSnapshot().messages).toMatchObject([
			{role: 'user', parts: [{type: 'text', text: 'Hi'}]},
			{id: 'assistant-1', role: 'assistant', parts: [{type: 'text', text: 'Hello world'}], usage: done.usage},
		]);
		await session.send('Follow up', 'claude-sonnet-5-5', 'medium');
		expect(transport.mock.calls[1]![0]).toEqual({
			model: 'claude-sonnet-5-5', effort: 'medium', messages: [
				{...session.getSnapshot().messages[0]},
				{id: 'assistant-1', role: 'assistant', parts: [{type: 'text', text: 'Hello world'}]},
				{...session.getSnapshot().messages[2]},
			],
		});
		unsubscribe();
		expect(session.getSnapshot().isStreaming).toBe(false);
	});

	it('ignores empty submissions and concurrent sends', async () => {
		let finish!: () => void;
		const transport = vi.fn<ChatTransport>().mockImplementation(async function* () {
			await new Promise<void>(resolve => {finish = resolve;});
			yield done;
		});
		const session = new ChatSession(transport);
		await session.send(' ', 'gpt-6.1-sol');
		expect(transport).not.toHaveBeenCalled();
		const sending = session.send('First', 'gpt-6.1-sol');
		await session.send('Duplicate', 'gpt-6.1-sol');
		expect(transport).toHaveBeenCalledOnce();
		finish();
		await sending;
	});

	it('shows missing-credentials guidance and excludes empty assistant placeholders from history', async () => {
		const transport = vi.fn<ChatTransport>().mockImplementation(async function* () {
			yield {type: 'error', code: 'missing_credentials', message: 'No API key is configured for openai.'};
		});
		const session = new ChatSession(transport);
		await session.send('Hi', 'gpt-6.1-sol');
		expect(session.getSnapshot().error).toContain('/connect');
		await session.send('Retry', 'gpt-6.1-sol');
		expect(transport.mock.calls[1]![0].messages.map(message => message.role)).toEqual(['user', 'user']);
	});

	it('keeps partial output after cancellation and allows another turn', async () => {
		const transport = vi.fn<ChatTransport>().mockImplementation(async function* (_request, signal) {
			yield {type: 'text-delta', text: 'Partial answer'};
			await new Promise<void>(resolve => {signal.addEventListener('abort', () => resolve(), {once: true});});
			signal.throwIfAborted();
		});
		const session = new ChatSession(transport);
		const sending = session.send('Hi', 'gpt-6.1-sol');
		await vi.waitFor(() => expect(session.getSnapshot().messages.at(-1)?.parts[0]?.text).toBe('Partial answer'));
		session.cancel();
		await sending;
		expect(session.getSnapshot()).toMatchObject({isStreaming: false, notice: expect.stringContaining('cancelled')});
		expect(session.getSnapshot().error).toBeUndefined();
		transport.mockImplementation(successfulTransport());
		await session.send('Continue', 'gpt-6.1-sol');
		expect(transport.mock.calls[1]![0].messages[1]?.parts[0]?.text).toBe('Partial answer');
	});

	it('clears a pending turn without allowing its late cleanup to replace a new conversation', async () => {
		let finish!: () => void;
		const transport = vi.fn<ChatTransport>().mockImplementationOnce(async function* () {
			await new Promise<void>(resolve => {finish = resolve;});
			yield {type: 'text-delta', text: 'Old answer'};
		}).mockImplementation(successfulTransport());
		const session = new ChatSession(transport);
		const sending = session.send('Old question', 'gpt-6.1-sol');
		session.clear();
		await session.send('New question', 'gpt-6.1-sol');
		finish();
		await sending;
		expect(session.getSnapshot().messages).toHaveLength(2);
		expect(session.getSnapshot().messages[0]?.parts[0]?.text).toBe('New question');
		expect(session.getSnapshot().messages[1]?.parts[0]?.text).toBe('Hello world');
		expect(session.getSnapshot().error).toBeUndefined();
	});

	it('reports incomplete streams while keeping partial text', async () => {
		const session = new ChatSession(async function* () {yield {type: 'text-delta', text: 'Partial'};});
		await session.send('Hi', 'gpt-6.1-sol');
		expect(session.getSnapshot().error).toContain('interrupted');
		expect(session.getSnapshot().isStreaming).toBe(false);
	});

	it('releases a cancelled chat immediately and ignores its late answer after another send', async () => {
		let finish!: () => void;
		const transport = vi.fn<ChatTransport>().mockImplementationOnce(async function* () {
			await new Promise<void>(resolve => {finish = resolve;});
			yield {type: 'text-delta', text: 'Stale answer'};
		}).mockImplementation(successfulTransport());
		const session = new ChatSession(transport);
		const sending = session.send('Cancelled question', 'gpt-6.1-sol');
		session.cancel();
		expect(session.getSnapshot().messages[1]).toMatchObject({status: 'cancelled'});
		expect(session.getSnapshot().operation).toBe('idle');
		await session.send('Next question', 'gpt-6.1-sol');
		const current = session.getSnapshot();
		finish();
		await sending;
		expect(session.getSnapshot()).toBe(current);
		expect(current.messages).toHaveLength(4);
		expect(current.messages[3]).toMatchObject({status: 'complete', parts: [{text: 'Hello world'}]});
	});
});
