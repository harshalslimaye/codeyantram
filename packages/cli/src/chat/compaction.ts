import {toRequestMessage, type CompactMessage} from '@codeyantram/shared';
import {
	estimateContextTokens,
	getContextStartIndex,
	type CompactedContext,
	type ConversationMessage,
} from './context.js';

export const KEEP_RECENT_TURNS = 2;
export const MIN_PREFIX_ESTIMATED_TOKENS = 1_500;

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

	const coveredMessageCount = turnStarts[turnStarts.length - KEEP_RECENT_TURNS]!;
	const messages: CompactMessage[] = transcript.slice(start, coveredMessageCount)
		.filter(message => message.parts.some(part => part.text.trim().length > 0))
		.map((message): CompactMessage => {
			const request = {...toRequestMessage(message), parts: message.parts.map(part => ({...part}))};
			return message.role === 'assistant'
				? {...request, role: 'assistant', status: message.status === 'cancelled' || message.status === 'failed'
					? message.status : 'complete'}
				: {...request, role: 'user'};
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
