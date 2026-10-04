import {Buffer} from 'node:buffer';
import {
	contextSummarySchema,
	formatContextSummary,
	findSupportedChatModel,
	toRequestMessage,
	type AssistantMessage,
	type ChatMessage,
	type ChatRequest,
	type CompactAssistantStatus,
	type RequestMessage,
	type UserMessage,
} from '@codeyantram/shared';

export type ConversationMessage = UserMessage | (AssistantMessage & {
	status?: CompactAssistantStatus | 'streaming';
});

/** The exclusive boundary counts every transcript entry, including empty placeholders. */
export interface CompactedContext {
	summary: string;
	coveredMessageCount: number;
}

export type ChatContext = Pick<ChatRequest, 'messages' | 'contextSummary'>;

export interface ContextStatus {
	modelId: string;
	usedTokens: number;
	contextWindow: number;
	usedPercent: number;
	remainingPercent: number;
}

/** Estimates active input against catalog capacity, before response headroom. */
export function getContextStatus(modelId: string, messages: readonly ChatMessage[], compacted?: CompactedContext): ContextStatus {
	const model = findSupportedChatModel(modelId);
	if (!model) throw new Error(`Model "${modelId}" is not supported.`);
	const usedTokens = estimateContextTokens(buildChatContext(messages, compacted));
	const usedPercent = usedTokens / model.contextWindow * 100;
	return {modelId, usedTokens, contextWindow: model.contextWindow, usedPercent, remainingPercent: Math.max(0, 100 - usedPercent)};
}

/** Reject stale/out-of-range boundaries and boundaries that split a user-led turn. */
export function getContextStartIndex(messages: readonly ChatMessage[], compacted?: CompactedContext): number {
	if (!compacted) return 0;
	contextSummarySchema.parse(compacted.summary);
	const index = compacted.coveredMessageCount;
	if (!Number.isInteger(index) || index < 0 || index > messages.length) {
		throw new Error('The compacted context boundary is outside the transcript.');
	}
	if (index > 0 && index < messages.length && messages[index]!.role !== 'user') {
		throw new Error('The compacted context boundary splits a conversation turn.');
	}
	return index;
}

/** Builds model context without modifying the transcript or replaying response metadata. */
export function buildChatContext(messages: readonly ChatMessage[], compacted?: CompactedContext): ChatContext {
	const start = getContextStartIndex(messages, compacted);
	const context: ChatContext = {
		messages: messages.slice(start)
			.filter(message => message.parts.length > 0)
			.map(message => ({...toRequestMessage(message), parts: message.parts.map(part => ({...part}))})),
	};
	if (compacted) context.contextSummary = compacted.summary;
	return context;
}

/**
 * UI/eligibility heuristic: ceil(UTF-8 text bytes / 4) + 6 tokens per message,
 * plus 32 tokens for a summary wrapper. This is not a provider token count or
 * a guarantee that input fits a model window, particularly for non-English text.
 */
export function estimateContextTokens(context: {
	messages: readonly RequestMessage[];
	contextSummary?: string;
}): number {
	const textEstimate = (text: string) => Math.ceil(Buffer.byteLength(text, 'utf8') / 4);
	const messages = context.messages.reduce((total, message) =>
		total + textEstimate(message.parts.map(part => part.text).join('')) + 6, 0);
	return messages + (context.contextSummary === undefined ? 0 : textEstimate(context.contextSummary) + 32);
}

/** Canonical serialized model content; includes the real summary wrapper, excludes IDs/status/usage.
 * Provider wire formats and measured token counts may differ from this byte comparison.
 */
export function measureContextBytes(context: ChatContext): number {
	const content = context.messages.map(message => ({role: message.role, content: message.parts}));
	if (context.contextSummary !== undefined) {
		content.unshift({role: 'user', content: [{type: 'text', text: formatContextSummary(context.contextSummary)}]});
	}
	return Buffer.byteLength(JSON.stringify(content), 'utf8');
}
