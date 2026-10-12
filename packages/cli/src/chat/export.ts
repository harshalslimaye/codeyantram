import {writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import type {ConversationMessage} from './context.js';

const JSON_INDENT = 2;
const MIN_FENCE_LENGTH = 3;

export function chatMarkdown(messages: readonly ConversationMessage[]): string {
	const sections = messages.map(message => {
		const heading = message.role === 'user' ? 'User' : 'Assistant';
		const status = message.role === 'assistant' && message.status && message.status !== 'complete' ? ` (${message.status})` : '';
		const parts = message.parts.map(part => {
			if (part.type === 'text') return part.text;
			const payload = part.type === 'tool-call' ? part.call : part.result;
			const json = JSON.stringify(payload, null, JSON_INDENT);
			const fence = '`'.repeat(Math.max(MIN_FENCE_LENGTH, ...Array.from(json.matchAll(/`+/g), match => match[0].length + 1)));
			return `### Tool ${part.type === 'tool-call' ? 'call' : 'result'}: ${payload.toolName}\n\n${fence}json\n${json}\n${fence}`;
		}).join('\n\n');
		return `## ${heading}${status}\n\n${parts}`;
	});
	return `# Codeyantram chat\n\n${sections.join('\n\n---\n\n')}\n`;
}

export function chatExportPath(filePath?: string): string {
	const target = resolve(filePath ?? `codeyantram-chat-${new Date().toISOString().replace(/[:.]/g, '-')}.md`);
	if (!target.toLowerCase().endsWith('.md')) throw new Error('Use a .md file path, for example /export chat.md.');
	return target;
}

export async function exportChat(messages: readonly ConversationMessage[], filePath?: string): Promise<string> {
	if (messages.length === 0) throw new Error('There is no chat to export.');
	const target = chatExportPath(filePath);
	// oxlint-disable-next-line security/detect-non-literal-fs-filename -- The destination is explicitly chosen by the user; exclusive creation prevents overwrites.
	await writeFile(target, chatMarkdown(messages), {encoding: 'utf8', flag: 'wx', mode: 0o600});
	return target;
}
