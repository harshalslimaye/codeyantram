import {toolCallSchema, toolResultSchema, type ChatStreamEvent} from '@codeyantram/shared';
import type {ConversationMessage} from './context.js';

type AssistantMessage = Extract<ConversationMessage, {role: 'assistant'}>;

export function createChatEventHandler(context: {
	getMessages: () => ConversationMessage[];
	updateAssistant: (change: (message: AssistantMessage) => AssistantMessage) => void;
	setAssistantId: (id: string) => void;
	updateError: (error: string) => void;
}) {
	const pendingTools = new Map<string, string>();
	return (event: ChatStreamEvent): boolean => {
		if (event.type === 'start') {
			context.updateAssistant(message => ({...message, id: event.messageId}));
			context.setAssistantId(event.messageId);
		} else if (event.type === 'text-delta') {
			context.updateAssistant(message => appendText(message, event.text));
		} else if (event.type === 'tool-call') {
			const call = toolCallSchema.parse(event.call);
			if (isDuplicateCall(call.toolCallId, pendingTools, context.getMessages())) throw new Error('Duplicate tool call ID.');
			pendingTools.set(call.toolCallId, call.toolName);
			context.updateAssistant(message => ({...message, parts: [...message.parts, {type: 'tool-call', call}]}));
		} else if (event.type === 'tool-result') {
			const result = toolResultSchema.parse(event.result);
			if (pendingTools.get(result.toolCallId) !== result.toolName) throw new Error('Tool result did not match a pending call.');
			pendingTools.delete(result.toolCallId);
			context.updateAssistant(message => ({...message, parts: [...message.parts, {type: 'tool-result', result}]}));
		} else if (event.type === 'done') {
			if (pendingTools.size) throw new Error('The chat completed with unresolved tool calls.');
			context.updateAssistant(message => ({...message, status: 'complete', usage: event.usage}));
			return true;
		} else if (event.type === 'error') {
			context.updateAssistant(message => ({...message, status: 'failed'}));
			context.updateError(chatErrorMessage(event));
			return true;
		}
		return false;
	};
}

function isDuplicateCall(id: string, pendingTools: Map<string, string>, messages: ConversationMessage[]) {
	return pendingTools.has(id) || messages.some(message => message.parts.some(part => part.type === 'tool-call' && part.call.toolCallId === id));
}

function appendText(message: AssistantMessage, text: string): AssistantMessage {
	const parts = [...message.parts];
	const last = parts.at(-1);
	if (last?.type === 'text') parts[parts.length - 1] = {...last, text: last.text + text};
	else parts.push({type: 'text', text});
	return {...message, parts};
}

function chatErrorMessage(event: Extract<ChatStreamEvent, {type: 'error'}>): string {
	const hint = event.code === 'missing_credentials' ? ' Use /connect to configure an API key.' : '';
	return event.message + hint;
}
