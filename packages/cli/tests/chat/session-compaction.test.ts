import {describe, expect, it, vi} from 'vitest';
import {toRequestMessage, type CompactStreamEvent} from '@codeyantram/shared';
import {ChatSession, type ChatSnapshot, type ChatTransport, type CompactTransport} from '../../src/chat/session.js';

const model = 'gpt-6.1-sol';
const longText = 'Objective: update /src/chat.ts, preserve port 43187 and the API; validation pending.\n'.repeat(100);
const done: CompactStreamEvent = {type: 'done', summary: 'Update /src/chat.ts; preserve the API. Validation pending.', durationMs: 12, usage: {inputTokens: 40, outputTokens: 12}};

function deferred() {
	let resolve!: () => void;
	const promise = new Promise<void>(res => {resolve = res;});
	return {promise, resolve};
}

function setup() {
	let turn = 0;
	const chat = vi.fn<ChatTransport>().mockImplementation(async function* () {
		yield {type: 'start', messageId: `assistant-${++turn}`};
		yield {type: 'text-delta', text: 'Reported answer'};
		yield {type: 'done', durationMs: 1, usage: {inputTokens: 2, outputTokens: 1}};
	});
	const compact = vi.fn<CompactTransport>().mockImplementation(async function* () {yield {type: 'start'}; yield done;});
	const session = new ChatSession(chat, compact);
	return {session, chat, compact};
}

async function seed(session: ChatSession, texts = [longText, longText, longText, 'Latest question']) {
	for (const text of texts) await session.send(text, model, 'high');
}

describe('session compaction', () => {
	it('commits summary and boundary together, preserves the complete transcript, and replays only summary + tail + next user', async () => {
		const {session, chat, compact} = setup();
		await seed(session);
		const transcript = session.getSnapshot().messages;
		const original = structuredClone(transcript);
		const updates: ChatSnapshot[] = [];
		const unsubscribe = session.subscribe(() => {updates.push(session.getSnapshot());});
		expect(await session.compact(model)).toEqual({type: 'success'});
		unsubscribe();
		expect(session.getSnapshot()).toMatchObject({operation: 'idle', isStreaming: false, compaction: {
			summary: done.summary, coveredMessageCount: 4, generation: 1, model, durationMs: 12, usage: done.usage,
		}});
		expect(session.getSnapshot().messages).toBe(transcript);
		expect(transcript).toEqual(original);
		expect(updates.some(update => update.operation === 'compact' && !update.isStreaming)).toBe(true);
		for (const update of updates) {
			expect(update.messages).toBe(transcript);
			if (update.compaction) expect(update.compaction).toMatchObject({summary: done.summary, coveredMessageCount: 4});
		}
		expect(session.getSnapshot().notice).toContain('Estimated context: ~');
		expect(compact.mock.calls[0]![0]).toEqual({model, messages: transcript.slice(0, 4).map(message => ({
			...toRequestMessage(message), ...(message.role === 'assistant' ? {status: 'complete'} : {}),
		}))});
		await session.send('Continue with the next task', 'gemini-3.8-flash', 'low');
		const request = chat.mock.calls.at(-1)![0];
		expect(request).toEqual({
			model: 'gemini-3.8-flash', effort: 'low', contextSummary: done.summary,
			messages: [...transcript.slice(4), session.getSnapshot().messages[8]!].map(toRequestMessage),
		});
		expect(request.messages.every(message => !('status' in message) && !('usage' in message))).toBe(true);
	});

	it('refreshes one summary using only newly eligible history and the previous summary', async () => {
		const {session, compact} = setup();
		await seed(session);
		await session.compact(model);
		expect(await session.compact(model)).toEqual({type: 'noop', reason: 'no-eligible-messages'});
		expect(compact).toHaveBeenCalledOnce();
		await session.send('Next user turn', model);
		compact.mockImplementationOnce(async function* () {yield {...done, summary: 'Refreshed working summary.', usage: {inputTokens: 10, totalTokens: 15}};});
		expect(await session.compact('claude-sonnet-5-5')).toEqual({type: 'success'});
		expect(compact.mock.calls[1]![0]).toEqual({
			model: 'claude-sonnet-5-5', previousSummary: done.summary,
			messages: session.getSnapshot().messages.slice(4, 6).map(message => ({
				...toRequestMessage(message), ...(message.role === 'assistant' ? {status: 'complete'} : {}),
			})),
		});
		expect(session.getSnapshot().compaction).toMatchObject({summary: 'Refreshed working summary.', coveredMessageCount: 6, generation: 2, model: 'claude-sonnet-5-5'});
		expect(session.getSnapshot().compactionUsage).toEqual({completedCalls: 2, callsWithUsage: 2, tokens: {inputTokens: 50, outputTokens: 12, totalTokens: 15}});
	});

	it.each([[], [longText], [longText, longText], ['Short first', 'Second', 'Third']].map(texts => ({texts})))('avoids model calls for ineligible history (case %#)', async ({texts}) => {
		const {session, compact} = setup();
		await seed(session, texts);
		expect((await session.compact(model)).type).toBe('noop');
		expect(compact).not.toHaveBeenCalled();
		expect(session.getSnapshot().operation).toBe('idle');
		expect(session.getSnapshot().compactionUsage).toBeUndefined();
	});

	it('requires reduction of the replaced prefix without counting large retained turns', async () => {
		const {session} = setup();
		await seed(session, [longText, 'Recent '.repeat(40_000), 'Latest '.repeat(40_000)]);
		expect(await session.compact(model)).toEqual({type: 'success'});
		expect(session.getSnapshot().compaction?.coveredMessageCount).toBe(2);
	});

	it('keeps previous context for a non-shrinking summary and records its paid usage', async () => {
		const {session, chat, compact} = setup();
		await seed(session);
		await session.compact(model);
		await session.send('Another turn', model);
		const previous = session.getSnapshot().compaction;
		const transcript = session.getSnapshot().messages;
		compact.mockImplementationOnce(async function* () {yield {...done, summary: longText};});
		expect(await session.compact(model)).toEqual({type: 'noop', reason: 'insufficient-reduction'});
		expect(session.getSnapshot().compaction).toBe(previous);
		expect(session.getSnapshot().messages).toBe(transcript);
		expect(session.getSnapshot().compactionUsage).toEqual({completedCalls: 2, callsWithUsage: 2, tokens: {inputTokens: 80, outputTokens: 24}});
		expect(session.getSnapshot().notice).toContain('at least 20%');
		await session.send('Still continue', model);
		expect(chat.mock.calls.at(-1)![0].contextSummary).toBe(previous?.summary);
		expect(chat.mock.calls.at(-1)![0].messages[0]?.id).toBe(transcript[4]?.id);
	});

	it.each([undefined, {}, {inputTokens: 0}])('preserves missing usage separately from measured zero (case %#)', async usage => {
		const {session, compact} = setup();
		await seed(session);
		compact.mockImplementationOnce(async function* () {yield {...done, usage};});
		await session.compact(model);
		expect(session.getSnapshot().compactionUsage).toEqual({completedCalls: 1, callsWithUsage: usage?.inputTokens === 0 ? 1 : 0, tokens: usage ?? {}});
		expect(session.getSnapshot().compactionUsage?.tokens.outputTokens).toBeUndefined();
	});

	it.each([
		{...done, summary: ''}, {...done, summary: ' '}, {...done, summary: 'x'.repeat(12_001)},
		{...done, durationMs: -1}, {...done, usage: {inputTokens: -1}}, {type: 'text-delta', text: 'partial'},
	])('rejects malformed injected results and preserves working context (case %#)', async event => {
		const {session, compact} = setup();
		await seed(session);
		await session.compact(model);
		await session.send('Another turn', model);
		const previous = session.getSnapshot();
		compact.mockImplementationOnce(async function* () {yield event as CompactStreamEvent;});
		expect((await session.compact(model)).type).toBe('failed');
		expect(session.getSnapshot().compaction).toBe(previous.compaction);
		expect(session.getSnapshot().messages).toBe(previous.messages);
		expect(session.getSnapshot().compactionUsage).toBe(previous.compactionUsage);
		expect(session.getSnapshot()).toMatchObject({operation: 'idle', error: expect.stringContaining('invalid response')});
	});

	it.each(['compaction_failed', 'provider_error', 'missing_credentials'] as const)('keeps working context on a %s error', async code => {
		const {session, compact} = setup();
		await seed(session);
		const transcript = session.getSnapshot().messages;
		compact.mockImplementationOnce(async function* () {yield {type: 'start'}; yield {type: 'error', code, message: 'Summary failed.'};});
		expect((await session.compact(model)).type).toBe('failed');
		expect(session.getSnapshot().messages).toBe(transcript);
		expect(session.getSnapshot().compaction).toBeUndefined();
		expect(session.getSnapshot().compactionUsage).toBeUndefined();
		expect(session.getSnapshot().error).toContain(code === 'missing_credentials' ? '/connect' : 'Summary failed.');
	});

	it('reports unexpected EOF and allows a retry without changing context', async () => {
		const {session, compact} = setup();
		await seed(session);
		compact.mockImplementationOnce(async function* () {yield {type: 'start'};});
		expect((await session.compact(model)).type).toBe('failed');
		expect(session.getSnapshot().error).toContain('interrupted');
		expect(session.getSnapshot().compaction).toBeUndefined();
		expect(await session.compact(model)).toEqual({type: 'success'});
	});

	it('preserves context if transport cleanup fails after a done event', async () => {
		const {session, compact} = setup();
		await seed(session);
		compact.mockImplementationOnce(async function* () {
			try {yield done;} finally {throw new Error('Transport cleanup failed.');}
		});
		expect((await session.compact(model)).type).toBe('failed');
		expect(session.getSnapshot().compaction).toBeUndefined();
		expect(session.getSnapshot().operation).toBe('idle');
	});

	it('keeps a usable session when the requested summarization model is unsupported', async () => {
		const {session, compact} = setup();
		await seed(session);
		expect((await session.compact('unsupported')).type).toBe('failed');
		expect(compact).not.toHaveBeenCalled();
		expect(session.getSnapshot().operation).toBe('idle');
		expect(await session.compact(model)).toEqual({type: 'success'});
	});

	it('avoids transport if the session is cleared as compaction begins', async () => {
		const {session, compact} = setup();
		await seed(session);
		const unsubscribe = session.subscribe(() => {
			if (session.getSnapshot().operation === 'compact') session.clear();
		});
		expect(await session.compact(model)).toEqual({type: 'cancelled'});
		unsubscribe();
		expect(compact).not.toHaveBeenCalled();
		expect(session.getSnapshot().messages).toEqual([]);
	});

	it('returns busy while chat is active without cancelling generation', async () => {
		const {session, chat, compact} = setup();
		const finish = deferred();
		chat.mockImplementationOnce(async function* () {await finish.promise; yield {type: 'done', durationMs: 1};});
		const sending = session.send(longText, model);
		const pending = session.getSnapshot();
		expect(await session.compact(model)).toEqual({type: 'busy'});
		expect(session.getSnapshot()).toBe(pending);
		expect(chat.mock.calls[0]![1].aborted).toBe(false);
		expect(compact).not.toHaveBeenCalled();
		finish.resolve();
		await sending;
	});

	it('permits only one operation during compaction', async () => {
		const {session, chat, compact} = setup();
		await seed(session);
		const finish = deferred();
		compact.mockImplementationOnce(async function* () {await finish.promise; yield done;});
		const compacting = session.compact(model);
		const pending = session.getSnapshot();
		expect(await session.compact(model)).toEqual({type: 'busy'});
		await session.send('Do not add a concurrent turn', model);
		expect(session.getSnapshot()).toBe(pending);
		expect(chat).toHaveBeenCalledTimes(4);
		expect(compact).toHaveBeenCalledOnce();
		finish.resolve();
		expect(await compacting).toEqual({type: 'success'});
	});

	it('releases a cancelled compaction immediately and ignores a late success after another send', async () => {
		const {session, compact} = setup();
		await seed(session);
		await session.compact(model);
		await session.send('Another turn', model);
		const previous = session.getSnapshot().compaction;
		const usage = session.getSnapshot().compactionUsage;
		const finish = deferred();
		compact.mockImplementationOnce(async function* () {await finish.promise; yield done;});
		const compacting = session.compact(model);
		session.cancel();
		expect(session.getSnapshot()).toMatchObject({operation: 'idle', notice: expect.stringContaining('cancelled')});
		expect(compact.mock.calls[1]![1].aborted).toBe(true);
		await session.send('Continue immediately', model);
		const current = session.getSnapshot();
		finish.resolve();
		expect(await compacting).toEqual({type: 'cancelled'});
		expect(session.getSnapshot()).toBe(current);
		expect(current.compaction).toBe(previous);
		expect(current.compactionUsage).toBe(usage);
	});

	it.each(['done', 'error', 'throw'] as const)('ignores late %s after clear without unlocking a new compaction', async kind => {
		const {session, compact} = setup();
		await seed(session);
		const oldFinish = deferred();
		const newFinish = deferred();
		compact.mockImplementationOnce(async function* () {
			await oldFinish.promise;
			if (kind === 'throw') throw new Error('Stale failure');
			yield kind === 'done' ? done : {type: 'error', code: 'provider_error', message: 'Stale failure'};
		}).mockImplementationOnce(async function* () {await newFinish.promise; yield {...done, summary: 'New session summary.'};});
		const oldCompacting = session.compact(model);
		session.clear();
		await seed(session);
		const newCompacting = session.compact('claude-sonnet-5-5');
		const current = session.getSnapshot();
		oldFinish.resolve();
		expect(await oldCompacting).toEqual({type: 'cancelled'});
		expect(session.getSnapshot()).toBe(current);
		expect(await session.compact(model)).toEqual({type: 'busy'});
		newFinish.resolve();
		expect(await newCompacting).toEqual({type: 'success'});
		expect(session.getSnapshot().compaction).toMatchObject({summary: 'New session summary.', generation: 1, model: 'claude-sonnet-5-5'});
		expect(session.getSnapshot().compactionUsage?.completedCalls).toBe(1);
	});

	it('invalidates a result when clear happens during asynchronous transport cleanup', async () => {
		const {session, compact} = setup();
		await seed(session);
		const cleaningUp = deferred();
		const finish = deferred();
		compact.mockImplementationOnce(async function* () {
			try {yield done;} finally {cleaningUp.resolve(); await finish.promise;}
		});
		const compacting = session.compact(model);
		await cleaningUp.promise;
		expect(session.getSnapshot().compaction).toBeUndefined();
		session.clear();
		finish.resolve();
		expect(await compacting).toEqual({type: 'cancelled'});
		expect(session.getSnapshot()).toMatchObject({messages: [], operation: 'idle'});
		expect(session.getSnapshot().compactionUsage).toBeUndefined();
	});

	it('clear resets transcript, context, usage, and operation state', async () => {
		const {session, chat} = setup();
		await seed(session);
		await session.compact(model);
		session.clear();
		expect(session.getSnapshot()).toMatchObject({messages: [], operation: 'idle', isStreaming: false});
		expect(session.getSnapshot().compaction).toBeUndefined();
		expect(session.getSnapshot().compactionUsage).toBeUndefined();
		await session.send('New session', model);
		expect(chat.mock.calls.at(-1)![0]).not.toHaveProperty('contextSummary');
		expect(chat.mock.calls.at(-1)![0].messages).toHaveLength(1);
	});

	it.each(['failed', 'cancelled'] as const)('tracks %s assistant text for the summarizer without changing normal history', async status => {
		const {session, chat, compact} = setup();
		chat.mockImplementationOnce(async function* (_request, signal) {
			yield {type: 'text-delta', text: 'Partial work'};
			if (status === 'failed') yield {type: 'error', code: 'provider_error', message: 'Failure'};
			else await new Promise<void>(resolve => {
				if (signal.aborted) resolve();
				else signal.addEventListener('abort', () => resolve(), {once: true});
			});
		});
		const sending = session.send(longText, model);
		if (status === 'cancelled') {
			await vi.waitFor(() => expect(session.getSnapshot().messages.at(-1)?.parts[0]?.text).toBe('Partial work'));
			session.cancel();
		}
		await sending;
		await seed(session, ['Recent question', 'Latest question']);
		expect(session.getSnapshot().messages[1]).toMatchObject({status, parts: [{text: 'Partial work'}]});
		await session.compact(model);
		expect(compact.mock.calls[0]![0].messages[1]).toMatchObject({status, parts: [{text: 'Partial work'}]});
		expect(chat.mock.calls[1]![0].messages[1]).not.toHaveProperty('status');
	});

	it.each([
		['gpt-6.1-sol', 'x'.repeat(4 * 1024 * 1024), '4 MB'],
		['claude-haiku-4-5-20251001', 'x'.repeat(800_000), 'context window'],
	])('blocks an obviously oversized request for %s before transport', async (selected, text, message) => {
		const {session, compact} = setup();
		await seed(session, [text, 'Recent', 'Latest']);
		expect((await session.compact(selected)).type).toBe('failed');
		expect(session.getSnapshot().error).toContain(message);
		expect(compact).not.toHaveBeenCalled();
		expect(session.getSnapshot().operation).toBe('idle');
	});
});
