import {describe, expect, it} from 'vitest';
import {compactRequestSchema} from '@codeyantram/shared';
import {planCompaction, MIN_PREFIX_ESTIMATED_TOKENS} from '../../src/chat/compaction.js';
import {buildChatContext, estimateContextTokens, type ConversationMessage} from '../../src/chat/context.js';

function user(id: string, text = 'A short question'): Extract<ConversationMessage, {role: 'user'}> {
	return {id, role: 'user', parts: [{type: 'text', text}]};
}
function assistant(id: string, text = 'An answer', status?: 'complete' | 'failed' | 'cancelled' | 'streaming'): Extract<ConversationMessage, {role: 'assistant'}> {
	return {id, role: 'assistant', parts: [{type: 'text', text}], ...(status ? {status} : {})};
}
const longText = 'Original objective and exact constraints.\n'.repeat(200);

describe('compaction planning', () => {
	it('selects older whole turns while keeping the last two user-led groups verbatim', () => {
		const transcript = [
			user('u1', longText), assistant('a1'), user('u2'), assistant('a2'),
			user('u3'), assistant('a3'), user('u4'), assistant('a4'),
		];
		const plan = planCompaction(transcript);
		expect(plan.type).toBe('ready');
		if (plan.type !== 'ready') throw new Error('Expected eligible history');
		expect(plan.coveredMessageCount).toBe(4);
		expect(plan.retainedTurnCount).toBe(2);
		expect(plan.messages.map(message => message.id)).toEqual(['u1', 'a1', 'u2', 'a2']);
		expect(plan).not.toHaveProperty('previousSummary');
		expect(compactRequestSchema.safeParse({model: 'gpt-6.1-sol', messages: plan.messages}).success).toBe(true);
		expect(buildChatContext(transcript, {summary: 'The task and decisions.', coveredMessageCount: plan.coveredMessageCount}))
			.toEqual({contextSummary: 'The task and decisions.', messages: transcript.slice(4)});
	});

	it('uses absolute transcript positions despite empty placeholders and an unanswered latest turn', () => {
		const transcript: ConversationMessage[] = [
			user('u1', longText), {id: 'a1', role: 'assistant', parts: [], status: 'failed'},
			user('u2'), assistant('a2', 'Partial work', 'cancelled'),
			user('u3'), assistant('a3'), user('u4'),
		];
		const plan = planCompaction(transcript);
		if (plan.type !== 'ready') throw new Error('Expected eligible history');
		expect(plan.coveredMessageCount).toBe(4);
		expect(plan.messages.map(message => message.id)).toEqual(['u1', 'u2', 'a2']);
		expect(plan.messages[2]).toMatchObject({status: 'cancelled', parts: [{text: 'Partial work'}]});
		expect(transcript.slice(plan.coveredMessageCount).map(message => message.id)).toEqual(['u3', 'a3', 'u4']);
	});

	it('handles consecutive user messages and multiple answers within one turn', () => {
		const transcript = [
			user('u1', longText), user('u2'), assistant('a2'), assistant('a2-more'),
			user('u3'), user('u4'),
		];
		const plan = planCompaction(transcript);
		if (plan.type !== 'ready') throw new Error('Expected eligible history');
		expect(plan.coveredMessageCount).toBe(4);
		expect(plan.messages.map(message => message.id)).toEqual(['u1', 'u2', 'a2', 'a2-more']);
	});

	it.each(['complete', 'failed', 'cancelled', undefined] as const)(
		'preserves assistant status and defaults older statusless messages to complete (case %#)', status => {
			const transcript = [user('u1', longText), assistant('a1', 'Some work', status), user('u2'), user('u3')];
			const plan = planCompaction(transcript);
			if (plan.type !== 'ready') throw new Error('Expected eligible history');
			expect(plan.messages[1]).toMatchObject({status: status ?? 'complete'});
			expect(plan.messages[0]).not.toHaveProperty('status');
		},
	);

	it('refreshes the previous summary using only newly eligible messages', () => {
		const transcript = [
			user('u1', longText), assistant('a1'), user('u2', longText), assistant('a2'),
			user('u3', longText), assistant('a3'), user('u4'), assistant('a4'),
		];
		const first = planCompaction(transcript);
		if (first.type !== 'ready') throw new Error('Expected first compaction');
		const compacted = {summary: 'Initial objective and decisions.', coveredMessageCount: first.coveredMessageCount};
		expect(planCompaction(transcript, compacted)).toEqual({type: 'noop', reason: 'no-eligible-messages'});
		const extended = [...transcript, user('u5'), assistant('a5')];
		const second = planCompaction(extended, compacted);
		if (second.type !== 'ready') throw new Error('Expected second compaction');
		expect(second.previousSummary).toBe(compacted.summary);
		expect(second.coveredMessageCount).toBe(6);
		expect(second.messages.map(message => message.id)).toEqual(['u3', 'a3']);
		expect(compactRequestSchema.safeParse({model: 'gemini-3.8-flash',
			previousSummary: second.previousSummary, messages: second.messages}).success).toBe(true);
	});

	it.each([
		{transcript: []}, {transcript: [user('u1')]},
		{transcript: [user('u1'), assistant('a1')]}, {transcript: [user('u1', longText), user('u2')]},
	])(
		'returns a no-op when fewer than three user-led groups are available (case %#)', ({transcript}) => {
			expect(planCompaction(transcript)).toEqual({type: 'noop', reason: 'no-eligible-messages'});
		},
	);

	it('does not refresh a large previous summary for a small newly eligible prefix', () => {
		const transcript = [user('u1', longText), user('u2'), user('u3'), user('u4')];
		expect(planCompaction(transcript, {summary: 'x'.repeat(10_000), coveredMessageCount: 1}))
			.toEqual({type: 'noop', reason: 'prefix-too-small'});
	});

	it('accepts the eligibility threshold and declines a prefix just below it', () => {
		const eligible = user('u1', 'x'.repeat((MIN_PREFIX_ESTIMATED_TOKENS - 6) * 4));
		expect(estimateContextTokens({messages: [eligible]})).toBe(MIN_PREFIX_ESTIMATED_TOKENS);
		expect(planCompaction([eligible, user('u2'), user('u3')]).type).toBe('ready');
		const small = user('u1', 'x'.repeat((MIN_PREFIX_ESTIMATED_TOKENS - 7) * 4));
		expect(planCompaction([small, user('u2'), user('u3')]))
			.toEqual({type: 'noop', reason: 'prefix-too-small'});
	});

	it('excludes blank prefix messages without moving the boundary or trimming meaningful text', () => {
		const transcript = [
			user('u1', ' \n '), assistant('a1', ''), user('u2', `  ${longText}  `),
			assistant('a2', '\t'), user('u3'), user('u4'),
		];
		const plan = planCompaction(transcript);
		if (plan.type !== 'ready') throw new Error('Expected eligible history');
		expect(plan.coveredMessageCount).toBe(4);
		expect(plan.messages.map(message => message.id)).toEqual(['u2']);
		expect(plan.messages[0]?.parts[0]?.text).toBe(`  ${longText}  `);
		expect(planCompaction([user('u1', ''), user('u2'), user('u3')]))
			.toEqual({type: 'noop', reason: 'no-eligible-messages'});
	});

	it.each([1, 5])('declines active streaming whether the answer is older or retained (index %i)', index => {
		const transcript = [user('u1', longText), assistant('a1'), user('u2'), assistant('a2'), user('u3'), assistant('a3')];
		transcript[index] = assistant('stream', 'Still writing', 'streaming');
		expect(planCompaction(transcript)).toEqual({type: 'noop', reason: 'streaming'});
	});

	it('rejects invalid boundaries and orphaned active answers instead of losing context', () => {
		const transcript = [user('u1', longText), assistant('a1'), user('u2'), user('u3')];
		expect(() => planCompaction(transcript, {summary: 'Old state.', coveredMessageCount: 1})).toThrow('splits');
		expect(() => planCompaction(transcript, {summary: 'Old state.', coveredMessageCount: 10})).toThrow('outside');
		expect(() => planCompaction([assistant('orphan'), ...transcript])).toThrow('user-led turn');
	});

	it('strips response metadata and isolates selected text parts from the original transcript', () => {
		const transcript: ConversationMessage[] = [
			user('u1', longText), {...assistant('a1'), usage: {inputTokens: 12}}, user('u2'), user('u3'),
		];
		const original = structuredClone(transcript);
		const plan = planCompaction(transcript);
		if (plan.type !== 'ready') throw new Error('Expected eligible history');
		expect(plan.messages[1]).not.toHaveProperty('usage');
		plan.messages[0]!.parts[0]!.text = 'Changed request';
		plan.messages[1]!.parts.push({type: 'text', text: 'Extra'});
		expect(transcript).toEqual(original);
	});
});
