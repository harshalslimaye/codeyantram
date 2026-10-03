import {describe, expect, it} from 'vitest';
import {chatRequestSchema, toRequestMessage} from '@codeyantram/shared';
import {buildChatContext, estimateContextTokens, type ConversationMessage} from '../../src/chat/context.js';

const transcript: ConversationMessage[] = [
	{id: 'u1', role: 'user', parts: [{type: 'text', text: 'Original task'}]},
	{
		id: 'a1', role: 'assistant', status: 'complete',
		parts: [{type: 'text', text: 'First answer'}], usage: {inputTokens: 20},
	},
	{id: 'u2', role: 'user', parts: [{type: 'text', text: 'A failed request'}]},
	{id: 'a2', role: 'assistant', status: 'failed', parts: []},
	{id: 'u3', role: 'user', parts: [{type: 'text', text: 'Continue'}, {type: 'text', text: ' with this constraint'}]},
	{id: 'a3', role: 'assistant', status: 'cancelled', parts: [{type: 'text', text: 'Partial answer'}]},
];

describe('chat context builder', () => {
	it('preserves full-history behavior before compaction without replaying metadata', () => {
		const context = buildChatContext(transcript);
		expect(context).toEqual({messages: transcript.filter(message => message.parts.length).map(toRequestMessage)});
		expect(context).not.toHaveProperty('contextSummary');
		expect(context.messages[1]).not.toHaveProperty('usage');
		expect(context.messages[1]).not.toHaveProperty('status');
		expect(chatRequestSchema.safeParse({model: 'gpt-6.1-sol', ...context}).success).toBe(true);
	});

	it('slices the original transcript before filtering placeholders and preserves summary and partial text', () => {
		const context = buildChatContext(transcript, {summary: '  Prior working state.\n ', coveredMessageCount: 4});
		expect(context).toEqual({
			contextSummary: '  Prior working state.\n ',
			messages: transcript.slice(4).map(toRequestMessage),
		});
		expect(context.messages[1]?.parts[0]?.text).toBe('Partial answer');
	});

	it('includes a newly appended user message after a fully covered transcript', () => {
		const compacted = {summary: 'Previous objective.', coveredMessageCount: transcript.length};
		const next: ConversationMessage = {id: 'u4', role: 'user', parts: [{type: 'text', text: 'Next question'}]};
		expect(buildChatContext([...transcript, next], compacted)).toEqual({
			contextSummary: compacted.summary, messages: [next],
		});
	});

	it('keeps the summary independent of the next selected model', () => {
		const context = buildChatContext(transcript, {summary: 'Preserve constraints.', coveredMessageCount: 4});
		for (const model of ['gpt-6.1-sol', 'claude-sonnet-5-5', 'gemini-3.8-flash']) {
			expect(chatRequestSchema.parse({model, ...context}).contextSummary).toBe(context.contextSummary);
		}
	});

	it('does not mutate history and isolates outgoing text parts from display history', () => {
		const original = structuredClone(transcript);
		const context = buildChatContext(transcript);
		context.messages[0]!.parts[0]!.text = 'Changed request';
		context.messages[0]!.parts.push({type: 'text', text: 'More text'});
		expect(transcript).toEqual(original);
	});

	it.each([-1, 1.5, NaN, Infinity, transcript.length + 1])('rejects invalid boundaries (case %#)', coveredMessageCount => {
		expect(() => buildChatContext(transcript, {summary: 'Working state.', coveredMessageCount}))
			.toThrow('outside the transcript');
	});

	it('rejects a boundary that separates an answer from its user message', () => {
		expect(() => buildChatContext(transcript, {summary: 'Working state.', coveredMessageCount: 1}))
			.toThrow('splits a conversation turn');
	});

	it('rejects invalid summary state instead of silently replaying archived history', () => {
		expect(() => buildChatContext(transcript, {summary: ' \n ', coveredMessageCount: 4})).toThrow();
	});
});

describe('context token estimates', () => {
	it('reports zero for empty context and increases when text or a summary is added', () => {
		expect(estimateContextTokens({messages: []})).toBe(0);
		const messages = buildChatContext(transcript).messages;
		const baseline = estimateContextTokens({messages});
		expect(baseline).toBeGreaterThan(0);
		expect(estimateContextTokens({messages, contextSummary: 'Prior decisions.'})).toBeGreaterThan(baseline);
		const longer = structuredClone(messages);
		longer[0]!.parts[0]!.text += '\n' + 'Additional source code.\n'.repeat(100);
		expect(estimateContextTokens({messages: longer})).toBeGreaterThan(baseline);
	});

	it('accounts for UTF-8 text rather than counting only JavaScript characters', () => {
		const estimate = (text: string) => estimateContextTokens({messages: [
			{id: 'u1', role: 'user', parts: [{type: 'text', text}]},
		]});
		expect(estimate('你好世界')).toBeGreaterThan(estimate('abcd'));
		expect(estimate('👋👋👋👋')).toBeGreaterThan(estimate('abcdefgh'));
	});

	it('counts multipart text consistently and excludes response metadata', () => {
		const split = [{id: 'u1', role: 'user' as const, parts: [
			{type: 'text' as const, text: 'const answer = '}, {type: 'text' as const, text: '42;'},
		]}];
		const joined = [{...split[0]!, parts: [{type: 'text' as const, text: 'const answer = 42;'}]}];
		expect(estimateContextTokens({messages: split})).toBe(estimateContextTokens({messages: joined}));
		expect(estimateContextTokens({messages: buildChatContext(transcript).messages}))
			.toBe(estimateContextTokens({messages: transcript.filter(message => message.parts.length).map(toRequestMessage)}));
	});
});
