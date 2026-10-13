import {Buffer} from 'node:buffer';
import {
	contextSummarySchema,
	formatContextSummary,
	findSupportedChatModel,
	isOpenAIModelSlug,
	toRequestMessage,
	projectRequestToolResults,
	type MessagePart,
	type AssistantMessage,
	type AgentId,
	type ChatMessage,
	type ChatRequest,
	type CompactAssistantStatus,
	type RequestMessage,
	type UserMessage,
} from '@codeyantram/shared';

const PERCENT_SCALE = 100;
const ESTIMATED_BYTES_PER_TOKEN = 4;
const ESTIMATED_MESSAGE_OVERHEAD_TOKENS = 6;
const ESTIMATED_SUMMARY_OVERHEAD_TOKENS = 32;

export type ConversationMessage = UserMessage | (AssistantMessage & {
	status?: CompactAssistantStatus | 'streaming';
	agentId?: AgentId;
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
	rawContextBytes?: number;
	projectedContextBytes?: number;
	trimmedToolResults?: number;
}

type ContextStatusOptions = {contextWindow?: number; toolResultTrimming?: boolean};

function contextStatusOptions(options?: number | ContextStatusOptions): ContextStatusOptions {
	return typeof options === 'number' ? {contextWindow: options} : options ?? {};
}

/** Estimates active input against catalog capacity, before response headroom. */
export function getContextStatus(modelId: string, messages: readonly ChatMessage[], compacted?: CompactedContext, options?: number | ContextStatusOptions): ContextStatus {
	const policy = contextStatusOptions(options);
	const model = findSupportedChatModel(modelId);
	if (!model && !isOpenAIModelSlug(modelId)) throw new Error(`Model "${modelId}" is not supported.`);
	const context = buildChatContext(messages, compacted);
	const projection = projectRequestToolResults(context.messages, policy.toolResultTrimming !== false);
	const projected = {...context, messages: projection.messages};
	const usedTokens = estimateContextTokens(projected);
	const contextWindow = model?.contextWindow ?? policy.contextWindow ?? 0;
	const usedPercent = contextWindow > 0 ? usedTokens / contextWindow * PERCENT_SCALE : 0;
	return {modelId, usedTokens, contextWindow, usedPercent, remainingPercent: Math.max(0, PERCENT_SCALE - usedPercent),
		...(projection.stats.trimmedResults > 0 ? {rawContextBytes: measureContextBytes(context),
			projectedContextBytes: measureContextBytes(projected), trimmedToolResults: projection.stats.trimmedResults} : {})};
}

/** Reject stale/out-of-range boundaries and boundaries that split a user-led turn. */
export function getContextStartIndex(messages: readonly ChatMessage[], compacted?: CompactedContext): number {
	if (!compacted) return 0;
	contextSummarySchema.parse(compacted.summary);
	const index = compacted.coveredMessageCount;
	if (!Number.isInteger(index) || index < 0 || index > messages.length) {
		throw new Error('The compacted context boundary is outside the transcript.');
	}
	if (index > 0 && index < messages.length && messages[index].role !== 'user') { // oxlint-disable-line security/detect-object-injection -- The index is bounded by the conversation length.
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
			.map(message => {
				const request = toRequestMessage(message);
				if (request.role === 'user') return {...request, parts: request.parts.map(part => ({...part}))};
				// Interrupted turns retain pending calls for display. Close those
				// calls explicitly in replay without claiming that a tool succeeded.
				const parts: MessagePart[] = [];
				const pending = new Map<string, string>();
				for (const part of request.parts) {
					parts.push(structuredClone(part));
					if (part.type === 'tool-call') pending.set(part.call.toolCallId, part.call.toolName);
					else if (part.type === 'tool-result') pending.delete(part.result.toolCallId);
				}
				for (const [toolCallId, toolName] of pending) parts.push({type: 'tool-result', result: {
					toolCallId, toolName, status: 'error', error: {code: 'cancelled', message: 'The turn ended before this tool result was received. Execution outcome is unknown.'},
				}});
				return {...request, parts};
			}),
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
	const textEstimate = (text: string) => Math.ceil(Buffer.byteLength(text, 'utf8') / ESTIMATED_BYTES_PER_TOKEN);
	const messages = context.messages.reduce((total, message) =>
		total + textEstimate(message.parts.map(part => part.type === 'text' ? part.text : JSON.stringify(part)).join('')) + ESTIMATED_MESSAGE_OVERHEAD_TOKENS, 0);
	return messages + (context.contextSummary === undefined ? 0 : textEstimate(context.contextSummary) + ESTIMATED_SUMMARY_OVERHEAD_TOKENS);
}

/** Estimates the same cross-turn projection as core, excluding provider overhead. */
export function estimateProjectedContextTokens(context: ChatContext, enabled = true): number {
	return estimateContextTokens({...context, messages: projectRequestToolResults(context.messages, enabled).messages});
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
