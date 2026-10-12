import {mkdtemp, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach, describe, expect, it} from 'vitest';
import {chatMarkdown, exportChat} from '../../src/chat/export.js';
import {ChatSession} from '../../src/chat/session.js';
import type {ConversationMessage} from '../../src/chat/context.js';

const messages: ConversationMessage[] = [
	{id: 'u', role: 'user', parts: [{type: 'text', text: 'Explain **this**'}]},
	{id: 'a', role: 'assistant', status: 'cancelled', parts: [{type: 'text', text: '```ts\nconst x = 1;\n```'}]},
];
let directory: string | undefined;
afterEach(async () => {if (directory !== undefined) await rm(directory, {recursive: true, force: true});});

describe('Markdown chat export', () => {
	it('preserves Markdown, message order, partial status, and tool payloads', () => {
		const transcript: ConversationMessage[] = [...messages, {id: 'tool', role: 'assistant', parts: [
			{type: 'tool-call', call: {toolCallId: 'call', toolName: 'read', input: {filePath: 'source.ts'}}},
			{type: 'tool-result', result: {toolCallId: 'call', toolName: 'read', status: 'success', output: {text: '```'}}},
		]}];
		const markdown = chatMarkdown(transcript);
		expect(markdown).toContain('## User\n\nExplain **this**');
		expect(markdown).toContain('## Assistant (cancelled)\n\n```ts\nconst x = 1;\n```');
		expect(markdown).toContain('### Tool call: read');
		expect(markdown).toContain('### Tool result: read\n\n````json');
	});

	it('writes UTF-8 at paths containing spaces and refuses overwrites or invalid exports', async () => {
		directory = await mkdtemp(join(tmpdir(), 'codeyantram-export-'));
		const target = join(directory, 'my chat.md');
		expect(await exportChat(messages, target)).toBe(target);
		expect(await readFile(target, 'utf8')).toBe(chatMarkdown(messages));
		await expect(exportChat(messages, target)).rejects.toMatchObject({code: 'EEXIST'});
		await expect(exportChat([], target)).rejects.toThrow('no chat');
		await expect(exportChat(messages, join(directory, 'chat.txt'))).rejects.toThrow('.md');
	});

	it('exports session messages without sending another model request and reports failures', async () => {
		directory = await mkdtemp(join(tmpdir(), 'codeyantram-export-'));
		const session = new ChatSession(async function* () {yield {type: 'text-delta', text: 'Answer'}; yield {type: 'done', durationMs: 1};});
		await session.exportMarkdown();
		expect(session.getSnapshot().error).toContain('no chat');
		await session.send('Question', 'gpt-6.1-sol');
		const target = join(directory, 'session.md');
		await session.exportMarkdown(target);
		expect(session.getSnapshot().notice).toBe(`Chat exported to ${target}`);
		expect(await readFile(target, 'utf8')).toContain('Answer');
		expect(session.getSnapshot().messages).toHaveLength(2);
		await session.exportMarkdown(target);
		expect(session.getSnapshot().error).toContain('EEXIST');
	});
});
