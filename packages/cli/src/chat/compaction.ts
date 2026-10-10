import {Buffer} from 'node:buffer';
import {findSupportedChatModel, type CompactMessage, type CompactRequest} from '@codeyantram/shared';
import {
	estimateContextTokens,
	getContextStartIndex,
	measureContextBytes,
	type ChatContext,
	type CompactedContext,
	type ConversationMessage,
} from './context.js';

const PERCENT_SCALE = 100;
const ESTIMATED_BYTES_PER_TOKEN = 4;

export const KEEP_RECENT_TURNS = 2;
export const MIN_PREFIX_ESTIMATED_TOKENS = 1_500;
export const MIN_CONTEXT_REDUCTION_PERCENT = 20;
export const MAX_COMPACT_REQUEST_BYTES = 4_194_304;
// Reserve 4,096 output tokens plus 4,096 for instructions and estimation error.
export const COMPACTION_CONTEXT_MARGIN_TOKENS = 8_192;

/** Compare only the replaced prefix plus previous summary, excluding the retained tail. */
export function assessCompactionReduction(previous: ChatContext, summary: string) {
	const beforeBytes = measureContextBytes(previous);
	const afterBytes = measureContextBytes({messages: [], contextSummary: summary});
	return {
		beforeBytes, afterBytes,
		sufficient: afterBytes * PERCENT_SCALE <= beforeBytes * (PERCENT_SCALE - MIN_CONTEXT_REDUCTION_PERCENT),
	};
}

/** An early heuristic guard, not proof that the request fits a provider context window. */
export function getCompactionSizeError(request: CompactRequest): string | undefined {
	const bytes = Buffer.byteLength(JSON.stringify(request), 'utf8');
	if (bytes > MAX_COMPACT_REQUEST_BYTES) return 'The compaction request exceeds the 4 MB limit. Previous context has been kept.';
	const model = findSupportedChatModel(request.model);
	if (model && Math.ceil(bytes / ESTIMATED_BYTES_PER_TOKEN) + COMPACTION_CONTEXT_MARGIN_TOKENS > model.contextWindow) {
		return 'The compaction request is estimated to exceed this model’s context window. Try a larger-context model. Previous context has been kept.';
	}
	return undefined;
}

export type CompactionPlan = {
	type: 'ready';
	messages: CompactMessage[];
	previousSummary?: string;
	coveredMessageCount: number;
	retainedTurnCount: number;
	prefixEstimatedTokens: number;
} | {
	type: 'noop';
	reason: 'no-eligible-messages' | 'prefix-too-small' | 'streaming';
};

/** Selects whole older turns; previously summarized transcript entries are never replayed. */
export function planCompaction(
	transcript: readonly ConversationMessage[],
	compacted?: CompactedContext,
): CompactionPlan {
	const start = getContextStartIndex(transcript, compacted);
	const turnStarts: number[] = [];
	for (let index = start; index < transcript.length; index++) {
		const message = transcript[index]!;
		if (message.role === 'assistant' && message.status === 'streaming') {
			return {type: 'noop', reason: 'streaming'};
		}
		if (message.role === 'user') turnStarts.push(index);
	}
	if (turnStarts.length <= KEEP_RECENT_TURNS) {
		return {type: 'noop', reason: 'no-eligible-messages'};
	}
	if (turnStarts[0] !== start) {
		throw new Error('The active transcript must start with a user-led turn.');
	}

	const coveredMessageCount = turnStarts[turnStarts.length - KEEP_RECENT_TURNS];
	const messages: CompactMessage[] = transcript.slice(start, coveredMessageCount)
		.filter(message => message.parts.some(part => part.type !== 'text' || part.text.trim().length > 0))
		.map((message): CompactMessage => {
			if (message.role === 'user') return {id: message.id, role: 'user', parts: message.parts.map(part => ({...part}))};
			return {id: message.id, role: 'assistant', parts: message.parts.map(part => structuredClone(part)),
				status: message.status === 'cancelled' || message.status === 'failed' ? message.status : 'complete'};
		});
	if (messages.length === 0) return {type: 'noop', reason: 'no-eligible-messages'};

	// Only newly eligible history counts toward the threshold, avoiding expensive
	// summary refreshes prompted by a few small messages and a large existing summary.
	const prefixEstimatedTokens = estimateContextTokens({messages});
	if (prefixEstimatedTokens < MIN_PREFIX_ESTIMATED_TOKENS) {
		return {type: 'noop', reason: 'prefix-too-small'};
	}
	return {
		type: 'ready', messages, coveredMessageCount,
		retainedTurnCount: KEEP_RECENT_TURNS,
		prefixEstimatedTokens,
		...(compacted ? {previousSummary: compacted.summary} : {}),
	};
}
