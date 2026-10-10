import {requireValue} from '../../../shared/tests/helpers.js';
import {requireTextPart} from '../helpers/message-parts.js';
import {describe, expect, it} from 'vitest';
import {Buffer} from 'node:buffer';
import {chatRequestSchema, formatContextSummary, toRequestMessage} from '@codeyantram/shared';
import {buildChatContext, estimateContextTokens, getContextStatus, measureContextBytes, type ConversationMessage} from '../../src/chat/context.js';

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
	it('allows a zero boundary without accessing a preceding message', () => {
		const context = buildChatContext(transcript, {summary: 'Existing objective.', coveredMessageCount: 0});
		expect(context).toEqual({...buildChatContext(transcript), contextSummary: 'Existing objective.'});
	});
	it('preserves full-history behavior before compaction without replaying metadata', () => {
		const context = buildChatContext(transcript);
		expect(context).toEqual({messages: transcript.filter(turn => turn.parts.length).map(toRequestMessage)});
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
		expect(context.messages[1]?.parts.map(requireTextPart)[0]?.text).toBe('Partial answer');
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
		requireValue(requireValue(context.messages[0]).parts.map(requireTextPart)[0]).text = 'Changed request';
		requireValue(context.messages[0]).parts.push({type: 'text', text: 'More text'});
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
		expect(() => buildChatContext(transcript, {summary: ' \n ', coveredMessageCount: 4})).toThrow(Error);
	});
});

describe('context token estimates', () => {
	it('rejects an unsupported model instead of estimating against an arbitrary capacity', () => {
		expect(() => getContextStatus('unsupported', transcript)).toThrow('Model "unsupported" is not supported.');
	});
	it('reports empty context and changes capacity when switching models', () => {
		expect(getContextStatus('gemma-4-31b-it', [])).toMatchObject({usedTokens: 0, usedPercent: 0, remainingPercent: 100, contextWindow: 262_144});
		const gemma = getContextStatus('gemma-4-31b-it', transcript);
		const openai = getContextStatus('gpt-6.1-sol', transcript);
		expect(gemma.usedTokens).toBe(openai.usedTokens);
		expect(gemma.usedPercent).toBeGreaterThan(openai.usedPercent);
	});

	it('counts the summary and retained messages while excluding archived text and usage metadata', () => {
		const compacted = {summary: 'Preserve constraints.', coveredMessageCount: 4};
		const status = getContextStatus('gemma-4-31b-it', transcript, compacted);
		const changedArchive = structuredClone(transcript);
		requireValue(requireValue(changedArchive[0]).parts.map(requireTextPart)[0]).text = 'Archived log.'.repeat(10_000);
		expect(getContextStatus('gemma-4-31b-it', changedArchive, compacted)).toEqual(status);
		expect(status.usedTokens).toBeGreaterThan(getContextStatus('gemma-4-31b-it', transcript.slice(4)).usedTokens);
	});

	it('shows zero remaining capacity when estimated context exceeds the window', () => {
		const messages = [{id: 'large', role: 'user' as const, parts: [{type: 'text' as const, text: 'x'.repeat(262_144 * 4)}]}];
		const status = getContextStatus('gemma-4-31b-it', messages);
		expect(status.usedPercent).toBeGreaterThan(100);
		expect(status.remainingPercent).toBe(0);
	});

	it('reports zero for empty context and increases when text or a summary is added', () => {
		expect(estimateContextTokens({messages: []})).toBe(0);
		const messages = buildChatContext(transcript).messages;
		const baseline = estimateContextTokens({messages});
		expect(baseline).toBeGreaterThan(0);
		expect(estimateContextTokens({messages, contextSummary: 'Prior decisions.'})).toBeGreaterThan(baseline);
		const longer = structuredClone(messages);
		requireValue(requireValue(longer[0]).parts.map(requireTextPart)[0]).text += '\n' + 'Additional source code.\n'.repeat(100);
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
		const joined = [{...requireValue(split[0]), parts: [{type: 'text' as const, text: 'const answer = 42;'}]}];
		expect(estimateContextTokens({messages: split})).toBe(estimateContextTokens({messages: joined}));
		expect(estimateContextTokens({messages: buildChatContext(transcript).messages}))
			.toBe(estimateContextTokens({messages: transcript.filter(message => message.parts.length).map(toRequestMessage)}));
	});
});

describe('serialized context size', () => {
	it('includes the replay wrapper, UTF-8 and JSON escaping while excluding response metadata and IDs', () => {
		const message = {id: 'u1', role: 'user' as const, parts: [{type: 'text' as const, text: '你好 👋\n"quoted"'}]};
		const summary = 'Exact prior state.\n';
		const content = [
			{role: 'user', content: [{type: 'text', text: formatContextSummary(summary)}]},
			{role: message.role, content: message.parts},
		];
		expect(measureContextBytes({messages: [message], contextSummary: summary})).toBe(Buffer.byteLength(JSON.stringify(content), 'utf8'));
		expect(measureContextBytes({messages: [{...message, id: 'a very long unrelated identifier'.repeat(20)}], contextSummary: summary}))
			.toBe(measureContextBytes({messages: [message], contextSummary: summary}));
		expect(measureContextBytes(buildChatContext(transcript)))
			.toBe(measureContextBytes({messages: transcript.filter(turn => turn.parts.length).map(toRequestMessage)}));
	});
});
